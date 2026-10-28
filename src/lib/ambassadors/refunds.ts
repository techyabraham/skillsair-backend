import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { AppError } from '../../types/index.js'
import { proportionalReversal, toKobo } from '../money.js'
import { relationId } from '../course-access.js'
import { logger } from '../logger.js'
import {
  insertLedgerEntry,
  recordInvoiceReversal,
  recordReversal,
  voidPendingCommission,
  withTransaction,
} from './ledger.js'
import { ambassadorSQL } from './db.js'
import type { LedgerDoc } from './types.js'
import { writeAudit } from './audit.js'

interface Refund { orderId: number; refundedKobo: number; refundKey: string }
interface Receipt { key: string; kobo: number }
interface InvoiceReceipt { refundKey: string; refundedKobo: number }

function validate(amount: number, key: string): void {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !/^[A-Za-z0-9_:.-]{1,120}$/.test(key)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid refund amount or identifier')
  }
}

function idOf(value: unknown): number | undefined {
  const id = typeof value === 'object' && value !== null && 'id' in value
    ? (value as { id: unknown }).id
    : value
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : undefined
}

function latestActive(rows: LedgerDoc[]): LedgerDoc | undefined {
  return rows
    .filter((row) => row.status === 'pending' || row.status === 'approved')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)[0]
}

/**
 * Refunds received before commission approval replace the one pending remainder. Each replacement
 * uses the stable refund ID in its own key, so any number of partial refunds remains idempotent.
 * The order row lock serialises receipts and the refund metadata commit with the ledger changes.
 */
export async function handleOrderRefund(payload: Payload, refund: Refund): Promise<void> {
  validate(refund.refundedKobo, refund.refundKey)
  await withTransaction(payload, async (req) => {
    await ambassadorSQL(payload, req, sql`SELECT id FROM orders WHERE id = ${refund.orderId} FOR UPDATE`)
    const order = await payload.findByID({ collection: 'orders', id: refund.orderId, depth: 0, overrideAccess: true, req })
    const metadata = (order.metadata ?? {}) as Record<string, unknown>
    const receipts = (Array.isArray(metadata.ambassadorRefunds) ? metadata.ambassadorRefunds : []) as Receipt[]
    if (receipts.some((receipt) => receipt.key === refund.refundKey)) return

    const saleKobo = toKobo(Number(order.amount))
    const refundedBefore = receipts.reduce((sum, receipt) => sum + receipt.kobo, 0)
    const refundedTotal = refundedBefore + refund.refundedKobo
    if (!Number.isSafeInteger(refundedTotal) || refundedTotal > saleKobo) {
      throw new AppError('VALIDATION_ERROR', 'Refund exceeds the remaining order amount')
    }

    const result = await payload.find({
      collection: 'ambassador-ledger',
      where: { and: [{ order: { equals: refund.orderId } }, { type: { equals: 'commission' } }] },
      limit: 1000,
      pagination: false,
      sort: 'createdAt',
      depth: 0,
      overrideAccess: true,
      req,
    })
    const rows = result.docs as unknown as LedgerDoc[]
    const original = rows.find((row) => row.idempotencyKey === `commission:order:${refund.orderId}`)
    const current = latestActive(rows)

    if (original && current) {
      await ambassadorSQL(payload, req, sql`SELECT id FROM ambassador_ledger WHERE id = ${current.id} FOR UPDATE`)
      const currentRow = await payload.findByID({ collection: 'ambassador-ledger', id: current.id, depth: 0, overrideAccess: true, req }) as unknown as LedgerDoc
      if (currentRow.status === 'pending') {
        const originalSale = original.saleKobo ?? saleKobo
        const remainingSale = saleKobo - refundedTotal
        const remainingCommission = original.amountKobo - proportionalReversal(original.amountKobo, refundedTotal, originalSale)
        await voidPendingCommission(payload, currentRow.id, 'Processed order refund', req)
        if (remainingCommission > 0 && remainingSale > 0) {
          await insertLedgerEntry(payload, {
            ambassadorId: idOf(original.ambassador)!,
            type: 'commission',
            status: 'pending',
            amountKobo: remainingCommission,
            saleKobo: remainingSale,
            rateBps: original.rateBps,
            orderId: refund.orderId,
            referredUserId: idOf(original.referredUser),
            productType: original.productType,
            productTitle: original.productTitle,
            availableAt: original.availableAt,
            idempotencyKey: `commission:order:${refund.orderId}:partial:${refund.refundKey}`,
          }, req)
        }
      } else if (currentRow.status === 'approved') {
        const reversal = proportionalReversal(currentRow.amountKobo, refund.refundedKobo, currentRow.saleKobo ?? saleKobo)
        if (reversal > 0) {
          await recordReversal(payload, {
            ambassadorId: idOf(currentRow.ambassador)!,
            orderId: refund.orderId,
            amountKobo: -reversal,
            key: `reversal:order:${refund.orderId}:${refund.refundKey}`,
            note: 'Processed order refund',
          }, req)
        }
      }
    }

    await payload.update({
      collection: 'orders',
      id: refund.orderId,
      data: {
        metadata: { ...metadata, ambassadorRefunds: [...receipts, { key: refund.refundKey, kobo: refund.refundedKobo }] },
        ...(refundedTotal === saleKobo ? { status: 'refunded' as const } : {}),
      },
      overrideAccess: true,
      req,
    })
  })
}

/**
 * Renewal refunds use the append-only audit log as a durable provider-event receipt. That gives a
 * full refund (which creates no remainder row) the same retry protection as partial refunds.
 */
export async function handleInvoiceRefund(payload: Payload, args: { transactionReference: string; refundedKobo: number; refundKey: string }): Promise<void> {
  validate(args.refundedKobo, args.refundKey)
  const found = await payload.find({
    collection: 'ambassador-ledger',
    where: { and: [{ type: { equals: 'commission' } }, { note: { equals: `transaction:${args.transactionReference}` } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const seed = found.docs[0] as unknown as LedgerDoc | undefined
  if (!seed?.invoiceCode) return
  const invoiceCode = seed.invoiceCode

  await withTransaction(payload, async (req) => {
    await ambassadorSQL(payload, req, sql`SELECT pg_advisory_xact_lock(hashtextextended(${'amb-invoice-refund:' + invoiceCode}, 0))`)
    const seen = await payload.find({
      collection: 'ambassador-audit-log',
      where: { and: [{ action: { equals: 'ambassador_invoice_refund_applied' } }, { targetId: { equals: invoiceCode } }] },
      limit: 1000,
      pagination: false,
      depth: 0,
      overrideAccess: true,
      req,
    })
    const receipts = seen.docs.map((doc) => doc.after as InvoiceReceipt | null).filter((value): value is InvoiceReceipt => Boolean(value && typeof value.refundKey === 'string' && Number.isSafeInteger(value.refundedKobo)))
    if (receipts.some((receipt) => receipt.refundKey === args.refundKey)) return

    const rowsResult = await payload.find({
      collection: 'ambassador-ledger',
      where: { and: [{ invoiceCode: { equals: invoiceCode } }, { type: { equals: 'commission' } }] },
      limit: 1000,
      pagination: false,
      sort: 'createdAt',
      depth: 0,
      overrideAccess: true,
      req,
    })
    const rows = rowsResult.docs as unknown as LedgerDoc[]
    const original = rows.find((row) => row.idempotencyKey === `commission:invoice:${invoiceCode}`) ?? seed
    const current = latestActive(rows)
    const saleKobo = original.saleKobo ?? 0
    const refundedBefore = receipts.reduce((sum, receipt) => sum + receipt.refundedKobo, 0)
    const refundedTotal = refundedBefore + args.refundedKobo
    if (!saleKobo || !Number.isSafeInteger(refundedTotal) || refundedTotal > saleKobo) {
      throw new AppError('VALIDATION_ERROR', 'Refund exceeds the remaining subscription payment amount')
    }

    if (current) {
      await ambassadorSQL(payload, req, sql`SELECT id FROM ambassador_ledger WHERE id = ${current.id} FOR UPDATE`)
      const currentRow = await payload.findByID({ collection: 'ambassador-ledger', id: current.id, depth: 0, overrideAccess: true, req }) as unknown as LedgerDoc
      const ambassadorId = idOf(currentRow.ambassador)
      const subscriptionId = idOf(currentRow.subscription)
      if (!ambassadorId || !subscriptionId) throw new AppError('INTERNAL_ERROR', 'Renewal commission is missing its owner')
      if (currentRow.status === 'pending') {
        const remainingSale = saleKobo - refundedTotal
        const remainingCommission = original.amountKobo - proportionalReversal(original.amountKobo, refundedTotal, saleKobo)
        await voidPendingCommission(payload, currentRow.id, 'Processed renewal refund', req)
        if (remainingCommission > 0 && remainingSale > 0) {
          await insertLedgerEntry(payload, {
            ambassadorId,
            type: 'commission',
            status: 'pending',
            amountKobo: remainingCommission,
            saleKobo: remainingSale,
            rateBps: original.rateBps,
            subscriptionId,
            invoiceCode,
            referredUserId: idOf(original.referredUser),
            productType: original.productType,
            productTitle: original.productTitle,
            availableAt: original.availableAt,
            note: original.note,
            idempotencyKey: `commission:invoice:${invoiceCode}:partial:${args.refundKey}`,
          }, req)
        }
      } else if (currentRow.status === 'approved') {
        const amount = proportionalReversal(currentRow.amountKobo, args.refundedKobo, currentRow.saleKobo ?? saleKobo)
        if (amount > 0) {
          await recordInvoiceReversal(payload, {
            ambassadorId,
            subscriptionId,
            invoiceCode,
            amountKobo: -amount,
            key: `reversal:invoice:${invoiceCode}:${args.refundKey}`,
            note: `Refund of invoice ${invoiceCode}`,
          }, req)
        }
      }
    }

    await writeAudit(payload, {
      actorId: null,
      action: 'ambassador_invoice_refund_applied',
      targetCollection: 'ambassador-ledger',
      targetId: invoiceCode,
      before: { refundedKobo: refundedBefore },
      after: { refundKey: args.refundKey, refundedKobo: args.refundedKobo, refundedTotalKobo: refundedTotal },
    }, req)
    logger.info({ invoiceCode, refundedKobo: args.refundedKobo }, 'ambassador_invoice_refund_applied')
  })
}
