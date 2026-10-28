import type { Payload, PayloadRequest } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { commissionFor, toKobo } from '../money.js'
import { relationId } from '../course-access.js'
import { logger } from '../logger.js'
import { insertLedgerEntry, withTransaction } from './ledger.js'
import { getAmbassadorSettings } from './settings.js'
import { ambassadorSQL } from './db.js'
import type { CommissionableType, AmbassadorDoc } from './types.js'

interface Sale {
  userId: number; saleKobo: number; paidAt: string; type: CommissionableType; title: string
  orderId?: number; subscriptionId?: number; invoiceCode?: string; ambassadorId?: number; transactionReference?: string
}
async function record(payload: Payload, sale: Sale, req: Partial<PayloadRequest>): Promise<void> {
  if (!Number.isSafeInteger(sale.saleKobo) || sale.saleKobo <= 0 || !Number.isFinite(Date.parse(sale.paidAt))) throw new Error('Invalid commission sale')
  const settings = await getAmbassadorSettings(payload)
  if (!settings.commissionableTypes.includes(sale.type)) return
  let ambassadorId = sale.ambassadorId
  if (ambassadorId === undefined) {
    const attributions = await payload.find({ collection: 'referral-attributions', where: { referredUser: { equals: sale.userId } }, limit: 1, depth: 0, overrideAccess: true, req })
    const attribution = attributions.docs[0]
    if (!attribution || (attribution.lockedUntil && Date.parse(String(attribution.lockedUntil)) <= Date.parse(sale.paidAt))) return
    ambassadorId = Number(relationId(attribution.ambassador))
  }
  if (!Number.isSafeInteger(ambassadorId) || ambassadorId <= 0) return
  const ambassador = await payload.findByID({ collection: 'ambassadors', id: ambassadorId, depth: 0, overrideAccess: true, req }).catch(() => null) as unknown as AmbassadorDoc | null
  if (!ambassador || ambassador.status !== 'active' || (ambassador.source === 'self' && !ambassador.emailVerifiedAt)) return
  if (Number(relationId(ambassador.user)) === sale.userId) {
    logger.info({ ambassadorId, userId: sale.userId }, 'ambassador_self_referral_blocked')
    return
  }
  const amountKobo = commissionFor(sale.saleKobo, settings.commissionRateBps)
  if (amountKobo <= 0) { logger.info({ ambassadorId, orderId: sale.orderId }, 'ambassador_zero_commission_skipped'); return }
  const key = sale.invoiceCode ? 'commission:invoice:' + sale.invoiceCode : 'commission:order:' + sale.orderId
  const result = await insertLedgerEntry(payload, { ambassadorId, type: 'commission', status: 'pending', amountKobo,
    saleKobo: sale.saleKobo, rateBps: settings.commissionRateBps, idempotencyKey: key, orderId: sale.orderId,
    subscriptionId: sale.subscriptionId, invoiceCode: sale.invoiceCode, referredUserId: sale.userId,
    productType: sale.type, productTitle: sale.title, availableAt: new Date(Date.parse(sale.paidAt) + settings.approvalDelayDays * 86400000),
    // A safe provider reference links future renewal refunds to this immutable invoice row.
    note: sale.transactionReference ? 'transaction:' + sale.transactionReference : undefined }, req)
  if (result.created) logger.info({ ambassadorId, orderId: sale.orderId, invoiceCode: sale.invoiceCode, amountKobo }, 'ambassador_commission_created')
}
export async function recordCommissionForOrder(payload: Payload, orderId: number): Promise<void> {
  await withTransaction(payload, async req => {
    await ambassadorSQL(payload, req, sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`)
    const order = await payload.findByID({ collection: 'orders', id: orderId, depth: 0, overrideAccess: true, req })
    if (order.status !== 'success') return
    const existing = await payload.count({ collection: 'ambassador-ledger', where: { idempotencyKey: { equals: 'commission:order:' + orderId } }, overrideAccess: true, req })
    if (existing.totalDocs) return
    const userId = relationId(order.user)
    if (userId === undefined) throw new Error('Commission order has no user')
    const metadata = (order.metadata ?? {}) as { ambassadorId?: number; ambassadorRefunds?: unknown[] }
    if (metadata.ambassadorRefunds?.length) {
      logger.warn({ orderId }, 'ambassador_refunded_order_missing_commission_review_required')
      return
    }
    let title = String(order.type)
    const planId = relationId(order.plan)
    const courseId = relationId(order.course)
    if (order.type === 'subscription' && planId !== undefined) {
      const plan = await payload.findByID({ collection: 'plans', id: planId, depth: 0, overrideAccess: true, req })
      title = String(plan.name)
    } else if (courseId !== undefined) {
      const course = await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true, req })
      title = String(course.title)
    }
    await record(payload, { userId: Number(userId), saleKobo: toKobo(Number(order.amount)), paidAt: String(order.paidAt ?? order.updatedAt),
      type: order.type as CommissionableType, title, orderId, ambassadorId: metadata.ambassadorId }, req)
  })
}
export interface InvoiceCommission { subscriptionId: number; invoiceCode: string; amountKobo: number; paidAt: string; transactionReference: string }
export async function recordCommissionForInvoice(payload: Payload, invoice: InvoiceCommission): Promise<void> {
  await withTransaction(payload, async req => {
    await ambassadorSQL(payload, req, sql`SELECT pg_advisory_xact_lock(hashtextextended(${'amb-invoice:' + invoice.invoiceCode}, 0))`)
    const subscription = await payload.findByID({ collection: 'subscriptions', id: invoice.subscriptionId, depth: 0, overrideAccess: true, req })
    if (invoice.transactionReference === subscription.initialOrderReference) return
    const planId = relationId(subscription.plan)
    const plan = planId === undefined ? null : await payload.findByID({ collection: 'plans', id: planId, depth: 0, overrideAccess: true, req })
    await record(payload, { userId: Number(relationId(subscription.user)), saleKobo: invoice.amountKobo, paidAt: invoice.paidAt, type: 'renewal', title: String(plan?.name ?? 'Subscription renewal'), subscriptionId: invoice.subscriptionId, invoiceCode: invoice.invoiceCode, transactionReference: invoice.transactionReference }, req)
  })
}
