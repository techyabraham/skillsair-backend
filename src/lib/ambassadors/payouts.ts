import { randomBytes } from 'node:crypto'
import type { Payload, PayloadRequest } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { AppError } from '../../types/index.js'
import { formatNaira } from '../money.js'
import { relationId } from '../course-access.js'
import { withLock } from '../locks.js'
import { logger } from '../logger.js'
import { createTransferRecipient, initiateTransfer, PaystackTransferError, verifyTransfer } from '../paystack.js'
import { getAmbassadorSettings } from './settings.js'
import { ambassadorSQL } from './db.js'
import { getWallet, markPayoutPaid, recordPayoutReversal, reservePayout, voidPayout, withTransaction } from './ledger.js'
import { writeAudit } from './audit.js'
import { sendAmbassadorPayoutAdminEmail, sendAmbassadorPayoutFailureEmail, sendAmbassadorPayoutPaidEmail, sendAmbassadorPayoutRequestedEmail } from './emails.js'
import type { AmbassadorDoc, AmbassadorSettings, PayoutStatus } from './types.js'

interface BankDoc {
  id: number
  ambassador: number | { id: number }
  bankCode: string
  bankName: string
  accountName: string
  accountNumber: string
  accountLast4: string
  resolvedAt: string
  paystackRecipientCode?: string | null
  isCurrent: boolean
  holdUntil?: string | null
}

export interface PayoutDoc {
  id: number
  ambassador: number | AmbassadorDoc
  amountKobo: number
  status: PayoutStatus
  bankAccount?: number | BankDoc | null
  bankName?: string | null
  accountName?: string | null
  accountLast4?: string | null
  recipientCode?: string | null
  reference: string
  requestId?: string | null
  paystackTransferCode?: string | null
  failureReason?: string | null
  reviewedBy?: number | { id: number } | null
  reviewedAt?: string | null
  processedAt?: string | null
  providerPayload?: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface PayoutView {
  id: number
  amountKobo: number
  status: PayoutStatus
  bankName: string
  accountLast4: string
  createdAt: string
  processedAt: string | null
  failureReason: string | null
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_PROVIDER_STATUS = /^[a-z_]{1,24}$/

function asId(value: unknown): number | undefined {
  const id = typeof value === 'object' && value !== null && 'id' in value ? (value as { id: unknown }).id : value
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : undefined
}

function safeProviderPayload(value: { status?: unknown; transferCode?: unknown; amount?: unknown; currency?: unknown; stage?: unknown; checkedAt?: unknown; adminAlertedAt?: unknown }): Record<string, unknown> {
  const status = typeof value.status === 'string' && SAFE_PROVIDER_STATUS.test(value.status) ? value.status : undefined
  const transferCode = typeof value.transferCode === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.transferCode) ? value.transferCode : undefined
  const amount = typeof value.amount === 'number' && Number.isSafeInteger(value.amount) ? value.amount : undefined
  const currency = value.currency === 'NGN' ? 'NGN' : undefined
  const stage = value.stage === 'recipient_setup' || value.stage === 'transfer_initiation_started' ? value.stage : undefined
  const checkedAt = typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt)) ? value.checkedAt : undefined
  const adminAlertedAt = typeof value.adminAlertedAt === 'string' && Number.isFinite(Date.parse(value.adminAlertedAt)) ? value.adminAlertedAt : undefined
  return Object.fromEntries(Object.entries({ status, transferCode, amount, currency, stage, checkedAt, adminAlertedAt }).filter(([, item]) => item !== undefined))
}

function payoutView(payout: PayoutDoc): PayoutView {
  return {
    id: payout.id,
    amountKobo: payout.amountKobo,
    status: payout.status,
    bankName: payout.bankName ?? 'Bank account',
    accountLast4: payout.accountLast4 ?? '',
    createdAt: payout.createdAt,
    processedAt: payout.processedAt ?? null,
    failureReason: payout.failureReason ?? null,
  }
}

function lagosDayBounds(now: Date): { key: string; start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
  const year = Number(part('year'))
  const month = Number(part('month'))
  const day = Number(part('day'))
  const start = new Date(Date.UTC(year, month - 1, day, -1)) // Lagos is UTC+1 with no DST.
  return { key: `${year}${part('month')}${part('day')}`, start, end: new Date(start.getTime() + 86_400_000) }
}

function failAmount(message: string): never {
  throw new AppError('VALIDATION_ERROR', message, { amountKobo: message })
}

async function currentBank(payload: Payload, ambassadorId: number): Promise<BankDoc | null> {
  const rows = await payload.find({
    collection: 'ambassador-bank-accounts',
    where: { and: [{ ambassador: { equals: ambassadorId } }, { isCurrent: { equals: true } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (rows.docs[0] as unknown as BankDoc | undefined) ?? null
}

async function findPayout(payload: Payload, id: number, req?: Partial<PayloadRequest>): Promise<PayoutDoc> {
  return await payload.findByID({ collection: 'ambassador-payouts', id, depth: 0, overrideAccess: true, ...(req ? { req } : {}) }) as unknown as PayoutDoc
}

async function updatePayout(payload: Payload, payoutId: number, data: Partial<PayoutDoc>, req?: Partial<PayloadRequest>): Promise<PayoutDoc> {
  return await payload.update({ collection: 'ambassador-payouts', id: payoutId, data, overrideAccess: true, ...(req ? { req } : {}) }) as unknown as PayoutDoc
}

async function payoutAmbassadorEmail(payload: Payload, payout: PayoutDoc): Promise<string | null> {
  const ambassadorId = asId(payout.ambassador)
  if (!ambassadorId) return null
  const ambassador = await payload.findByID({ collection: 'ambassadors', id: ambassadorId, depth: 1, overrideAccess: true }) as unknown as AmbassadorDoc
  const user = typeof ambassador.user === 'object' ? ambassador.user : null
  return user?.email ?? null
}

async function checkDailyAutomaticCap(payload: Payload, settings: AmbassadorSettings, amountKobo: number, now: Date): Promise<boolean> {
  const day = lagosDayBounds(now)
  const [sum] = await withTransaction(payload, (req) => ambassadorSQL(payload, req, sql`
    SELECT COALESCE(SUM("amount_kobo"), 0)::numeric AS "total"
    FROM "ambassador_payouts"
    WHERE "status" IN ('approved', 'processing', 'success')
      AND "created_at" >= ${day.start.toISOString()} AND "created_at" < ${day.end.toISOString()}`))
  const already = Number(sum?.total ?? 0)
  return Number.isSafeInteger(already) && already + amountKobo <= settings.dailyCapKobo
}

async function openRiskFlags(payload: Payload, ambassadorId: number): Promise<boolean> {
  const ambassador = await payload.findByID({ collection: 'ambassadors', id: ambassadorId, depth: 0, overrideAccess: true }) as unknown as AmbassadorDoc
  return (ambassador.riskFlags ?? []).some((flag) => !flag.resolvedAt)
}

/** Creates and reserves a withdrawal. The Idempotency-Key is scoped to one ambassador. */
export async function requestPayout(payload: Payload, args: { ambassadorId: number; amountKobo: number; requestId: string }): Promise<{ payout: PayoutDoc; created: boolean }> {
  if (!UUID_V4.test(args.requestId)) throw new AppError('VALIDATION_ERROR', 'Idempotency-Key must be a UUID v4')
  if (!Number.isSafeInteger(args.amountKobo) || args.amountKobo <= 0) failAmount('Enter a valid whole-kobo withdrawal amount.')

  const locked = await withLock(`amb:payout:${args.ambassadorId}`, 30, async () => {
    const prior = await payload.find({
      collection: 'ambassador-payouts',
      where: { and: [{ ambassador: { equals: args.ambassadorId } }, { requestId: { equals: args.requestId } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (prior.docs[0]) return { payout: prior.docs[0] as unknown as PayoutDoc, created: false, automatic: false }

    const settings = await getAmbassadorSettings(payload)
    if (!settings.payoutsEnabled) throw new AppError('INSUFFICIENT_PERMISSION', 'Withdrawals are paused.', { reason: 'payouts_paused' })
    const bank = await currentBank(payload, args.ambassadorId)
    if (!bank || !bank.resolvedAt) throw new AppError('VALIDATION_ERROR', 'Add and verify a payout bank account before requesting a withdrawal.', { bankAccount: 'No verified bank account is set.' })
    if (bank.holdUntil && Date.parse(bank.holdUntil) > Date.now()) {
      const message = `This bank account is on hold until ${new Date(bank.holdUntil).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}.`
      throw new AppError('VALIDATION_ERROR', message, { bankAccount: message })
    }

    if (args.amountKobo < settings.minPayoutKobo) failAmount(`The minimum withdrawal is ${formatNaira(settings.minPayoutKobo)}.`)
    const wallet = await getWallet(payload, args.ambassadorId)
    if (args.amountKobo > wallet.availableKobo) failAmount(`You can withdraw up to ${formatNaira(Math.max(0, wallet.availableKobo))}.`)

    const now = new Date()
    let automatic = false
    const create = async (allowAutomatic: boolean) => withTransaction(payload, async (req) => {
      const currentWallet = await getWallet(payload, args.ambassadorId, req)
      if (args.amountKobo > currentWallet.availableKobo) failAmount(`You can withdraw up to ${formatNaira(Math.max(0, currentWallet.availableKobo))}.`)
      const reference = `amb_${randomBytes(16).toString('hex')}`
      const payout = await payload.create({
        collection: 'ambassador-payouts',
        data: {
          ambassador: args.ambassadorId,
          amountKobo: args.amountKobo,
          status: allowAutomatic ? 'approved' : 'requested',
          bankAccount: bank.id,
          bankName: bank.bankName,
          accountName: bank.accountName,
          accountLast4: bank.accountLast4,
          recipientCode: bank.paystackRecipientCode ?? null,
          reference,
          requestId: args.requestId,
          ...(allowAutomatic ? { reviewedAt: now.toISOString() } : {}),
        },
        overrideAccess: true,
        req,
      }) as unknown as PayoutDoc
      await reservePayout(payload, { ambassadorId: args.ambassadorId, payoutId: payout.id, amountKobo: args.amountKobo }, req)
      return payout
    })

    if (settings.payoutMode === 'automatic' && args.amountKobo <= settings.perTransferCapKobo && !(await openRiskFlags(payload, args.ambassadorId))) {
      const day = lagosDayBounds(now)
      const dayLock = await withLock(`amb:payout-daily:${day.key}`, 30, async () => {
        if (!(await checkDailyAutomaticCap(payload, settings, args.amountKobo, now))) return null
        automatic = true
        return create(true)
      })
      if (dayLock !== null) return { payout: dayLock, created: true, automatic }
    }

    return { payout: await create(false), created: true, automatic: false }
  })

  if (!locked) throw new AppError('SERVICE_BUSY', 'A withdrawal request is already being processed. Please try again shortly.')
  if (!locked.created) return { payout: locked.payout, created: false }

  const email = await payoutAmbassadorEmail(payload, locked.payout).catch(() => null)
  if (email) await sendAmbassadorPayoutRequestedEmail(email, locked.payout.amountKobo, args.ambassadorId)
  if (locked.automatic) {
    try { await processPayout(payload, locked.payout.id) }
    catch (error) { logger.error({ payoutId: locked.payout.id, error: error instanceof Error ? error.name : 'unknown' }, 'ambassador_automatic_payout_processing_failed') }
  }
  return { payout: await findPayout(payload, locked.payout.id), created: true }
}

async function failPayout(payload: Payload, payoutId: number, reason: string, notifyAdmin: boolean): Promise<void> {
  const before: { payout?: PayoutDoc } = {}
  await withTransaction(payload, async (req) => {
    const payout = await findPayout(payload, payoutId, req)
    if (payout.status !== 'processing') return
    before.payout = payout
    await updatePayout(payload, payoutId, { status: 'failed', failureReason: reason, processedAt: new Date().toISOString() }, req)
    const ledger = await payload.find({ collection: 'ambassador-ledger', where: { idempotencyKey: { equals: `payout:${payoutId}` } }, limit: 1, depth: 0, overrideAccess: true, req })
    const row = ledger.docs[0] as { id: number; status: string } | undefined
    if (row?.status === 'reserved') await voidPayout(payload, payoutId, req)
    await writeAudit(payload, { actorId: null, action: 'ambassador_payout_failed', targetCollection: 'ambassador-payouts', targetId: payoutId,
      before: { status: payout.status }, after: { status: 'failed', failureReason: reason } }, req)
  })
  if (!before.payout) return
  const email = await payoutAmbassadorEmail(payload, before.payout).catch(() => null)
  if (email) await sendAmbassadorPayoutFailureEmail(email, before.payout.amountKobo, reason, asId(before.payout.ambassador) ?? 0)
  if (notifyAdmin) await sendAmbassadorPayoutAdminEmail(`Payout ${payoutId} could not start because Paystack transfer OTP approval is enabled.`)
}

async function continuePayout(payload: Payload, payoutId: number): Promise<void> {
  const payout = await findPayout(payload, payoutId)
  if (payout.status !== 'processing') return
  const provider = safeProviderPayload(payout.providerPayload ?? {})
  if (provider.stage === 'transfer_initiation_started') return

  const bankId = asId(payout.bankAccount)
  const bank = bankId ? await payload.findByID({ collection: 'ambassador-bank-accounts', id: bankId, depth: 0, overrideAccess: true }) as unknown as BankDoc : null
  if (!bank || !bank.resolvedAt || !/^\d{10}$/.test(bank.accountNumber)) {
    await failPayout(payload, payoutId, 'Your payout bank details could not be verified. Update them in Settings and try again.', false)
    return
  }

  let recipientCode = payout.recipientCode ?? bank.paystackRecipientCode ?? null
  if (!recipientCode) {
    try {
      recipientCode = await createTransferRecipient({ name: payout.accountName ?? bank.accountName, accountNumber: bank.accountNumber, bankCode: bank.bankCode })
      await payload.update({ collection: 'ambassador-bank-accounts', id: bank.id, data: { paystackRecipientCode: recipientCode }, overrideAccess: true })
      await updatePayout(payload, payout.id, { recipientCode })
    } catch (error) {
      const ambiguous = error instanceof PaystackTransferError && error.code === 'ambiguous'
      if (!ambiguous) await failPayout(payload, payoutId, 'Paystack could not set up this bank account. Contact support before requesting another withdrawal.', false)
      else {
        await updatePayout(payload, payoutId, { providerPayload: safeProviderPayload({ ...provider, status: 'recipient_setup_unconfirmed', stage: 'recipient_setup' }) })
        logger.warn({ payoutId }, 'ambassador_payout_recipient_setup_ambiguous')
      }
      return
    }
  }

  // This durable marker is written before the network call. If the process stops after this point,
  // reconciliation verifies the same reference and never submits another transfer.
  await updatePayout(payload, payoutId, { providerPayload: safeProviderPayload({ ...provider, status: 'initiating', stage: 'transfer_initiation_started' }) })
  try {
    const transfer = await initiateTransfer({ amountKobo: payout.amountKobo, recipientCode, reference: payout.reference, reason: 'SkillsAir ambassador payout' })
    await updatePayout(payload, payoutId, {
      paystackTransferCode: transfer.transfer_code ?? null,
      providerPayload: safeProviderPayload({ status: transfer.status, transferCode: transfer.transfer_code, amount: transfer.amount, currency: transfer.currency, stage: 'transfer_initiation_started' }),
    })
  } catch (error) {
    if (error instanceof PaystackTransferError && error.code === 'ambiguous') {
      await updatePayout(payload, payoutId, { providerPayload: safeProviderPayload({ status: 'initiation_ambiguous', stage: 'transfer_initiation_started' }) })
      logger.warn({ payoutId }, 'ambassador_payout_initiation_ambiguous')
      return
    }
    const otp = error instanceof PaystackTransferError && error.code === 'paystack_otp_enabled'
    await failPayout(payload, payoutId, otp ? 'Transfers need OTP disabled in Paystack.' : 'Paystack could not complete this transfer. Check your bank details, then try again.', otp)
  }
}

/** Processes one approved payout exactly once. Ambiguous requests are reconciled by the same reference. */
export async function processPayout(payload: Payload, payoutId: number): Promise<PayoutDoc | null> {
  const result = await withLock(`amb:payout-process:${payoutId}`, 120, async () => {
    let payout = await findPayout(payload, payoutId)
    if (payout.status !== 'approved') return payout
    await withTransaction(payload, async (req) => {
      payout = await findPayout(payload, payoutId, req)
      if (payout.status !== 'approved') return
      await updatePayout(payload, payoutId, {
        status: 'processing',
        providerPayload: safeProviderPayload({ stage: 'recipient_setup', status: 'preparing_recipient' }),
      }, req)
      await writeAudit(payload, { actorId: asId(payout.reviewedBy) ?? null, action: 'ambassador_payout_processing_started', targetCollection: 'ambassador-payouts', targetId: payoutId,
        before: { status: 'approved' }, after: { status: 'processing', amountKobo: payout.amountKobo } }, req)
    })
    await continuePayout(payload, payoutId)
    return findPayout(payload, payoutId)
  })
  return result
}

type TransferEvent = 'transfer.success' | 'transfer.failed' | 'transfer.reversed'

/** Applies a signed Paystack webhook or authenticated verification result under the per-payout lock. */
export async function applyPayoutTransferEvent(payload: Payload, args: {
  event: TransferEvent
  reference: string
  amount: number
  currency: string
  status: string
  transferCode?: string | null
}): Promise<void> {
  if (!args.reference.startsWith('amb_')) return
  if (!Number.isSafeInteger(args.amount) || args.amount <= 0 || args.currency !== 'NGN') {
    logger.warn({ reference: args.reference }, 'ambassador_payout_webhook_amount_invalid')
    return
  }
  const found = await payload.find({ collection: 'ambassador-payouts', where: { reference: { equals: args.reference } }, limit: 1, depth: 0, overrideAccess: true })
  const payout = found.docs[0] as unknown as PayoutDoc | undefined
  if (!payout) return
  if (args.amount !== payout.amountKobo) {
    logger.error({ payoutId: payout.id, reference: args.reference }, 'ambassador_payout_webhook_amount_mismatch')
    return
  }

  const didLock = await withLock(`amb:payout-process:${payout.id}`, 120, async () => {
    const current = await findPayout(payload, payout.id)
    if (current.reference !== args.reference) return false
    const before = current.status
    let finalReason: string | null = null
    let emailKind: 'paid' | 'failed' | null = null
    await withTransaction(payload, async (req) => {
      const latest = await findPayout(payload, payout.id, req)
      const ledgerRows = await payload.find({ collection: 'ambassador-ledger', where: { idempotencyKey: { equals: `payout:${payout.id}` } }, limit: 1, depth: 0, overrideAccess: true, req })
      const ledger = ledgerRows.docs[0] as { id: number; status: string } | undefined
      const base = { providerPayload: safeProviderPayload({ status: args.status, transferCode: args.transferCode, amount: args.amount, currency: args.currency, checkedAt: new Date().toISOString() }) }

      if (args.event === 'transfer.success') {
        if (latest.status !== 'processing' || ledger?.status !== 'reserved') return
        await updatePayout(payload, payout.id, { ...base, status: 'success', paystackTransferCode: args.transferCode ?? latest.paystackTransferCode ?? null, processedAt: new Date().toISOString(), failureReason: null }, req)
        await markPayoutPaid(payload, payout.id, req)
        await writeAudit(payload, { actorId: null, action: 'ambassador_payout_succeeded', targetCollection: 'ambassador-payouts', targetId: payout.id,
          before: { status: latest.status }, after: { status: 'success', amountKobo: latest.amountKobo } }, req)
        emailKind = 'paid'
        return
      }

      if (args.event === 'transfer.failed' && latest.status === 'processing' && ledger?.status === 'reserved') {
        finalReason = 'Paystack could not complete the transfer. Check your bank details, then try again.'
        await updatePayout(payload, payout.id, { ...base, status: 'failed', failureReason: finalReason, processedAt: new Date().toISOString() }, req)
        await voidPayout(payload, payout.id, req)
        await writeAudit(payload, { actorId: null, action: 'ambassador_payout_failed', targetCollection: 'ambassador-payouts', targetId: payout.id,
          before: { status: latest.status }, after: { status: 'failed', failureReason: finalReason } }, req)
        emailKind = 'failed'
        return
      }

      if (args.event === 'transfer.reversed') {
        if (latest.status === 'processing' && ledger?.status === 'reserved') {
          finalReason = 'The bank returned this transfer. Your balance is available again.'
          await updatePayout(payload, payout.id, { ...base, status: 'failed', failureReason: finalReason, processedAt: new Date().toISOString() }, req)
          await voidPayout(payload, payout.id, req)
          await writeAudit(payload, { actorId: null, action: 'ambassador_payout_transfer_reversed_before_success', targetCollection: 'ambassador-payouts', targetId: payout.id,
            before: { status: latest.status }, after: { status: 'failed', ledger: 'reserved payout voided' } }, req)
          emailKind = 'failed'
          return
        }
        if (latest.status === 'success' && ledger?.status === 'paid') {
          finalReason = 'The bank returned this transfer. Your balance has been restored.'
          await recordPayoutReversal(payload, { ambassadorId: asId(latest.ambassador)!, payoutId: payout.id, amountKobo: latest.amountKobo, note: 'Paystack reversed a completed payout' }, req)
          await updatePayout(payload, payout.id, { ...base, status: 'failed', failureReason: finalReason, processedAt: new Date().toISOString() }, req)
          await writeAudit(payload, { actorId: null, action: 'ambassador_payout_transfer_reversed_after_success', targetCollection: 'ambassador-payouts', targetId: payout.id,
            before: { status: latest.status }, after: { status: 'failed', amountKobo: latest.amountKobo, ledger: 'payout_reversal appended' } }, req)
          emailKind = 'failed'
        }
      }
    })

    if (emailKind) {
      const address = await payoutAmbassadorEmail(payload, current).catch(() => null)
      if (address && emailKind === 'paid') await sendAmbassadorPayoutPaidEmail(address, current.amountKobo, current.bankName ?? 'your bank', current.accountLast4 ?? '', asId(current.ambassador) ?? 0)
      if (address && emailKind === 'failed' && finalReason) await sendAmbassadorPayoutFailureEmail(address, current.amountKobo, finalReason, asId(current.ambassador) ?? 0)
    }
    if (before !== 'success' && emailKind === 'paid') logger.info({ payoutId: current.id }, 'ambassador_payout_paid')
    return true
  })
  if (!didLock) logger.info({ payoutId: payout.id }, 'ambassador_payout_event_lock_busy')
}

export async function reconcilePayout(payload: Payload, payout: PayoutDoc, now = new Date()): Promise<void> {
  const current = await findPayout(payload, payout.id)
  if (current.status !== 'processing') return
  const provider = safeProviderPayload(current.providerPayload ?? {})
  if (provider.stage === 'recipient_setup') {
    // Recipient creation is safe to retry: Paystack returns the existing recipient for the same account.
    await withLock(`amb:payout-process:${current.id}`, 120, () => continuePayout(payload, current.id))
    const afterRetry = await findPayout(payload, current.id)
    if (afterRetry.status !== 'processing') return
    const retryProvider = safeProviderPayload(afterRetry.providerPayload ?? {})
    const age = now.getTime() - Date.parse(afterRetry.createdAt)
    const alertedAt = retryProvider.adminAlertedAt ? Date.parse(String(retryProvider.adminAlertedAt)) : 0
    if (age >= 24 * 60 * 60 * 1000 && (!alertedAt || now.getTime() - alertedAt >= 24 * 60 * 60 * 1000)) {
      const alertAt = now.toISOString()
      await updatePayout(payload, current.id, { providerPayload: safeProviderPayload({ ...retryProvider, adminAlertedAt: alertAt, checkedAt: alertAt }) })
      await sendAmbassadorPayoutAdminEmail(`Payout ${current.id} has been unresolved for more than 24 hours during Paystack recipient setup. Review the bank details and Paystack recipient status in SkillsAir Studio.`)
    }
    return
  }
  try {
    const transfer = await verifyTransfer(current.reference)
    if (transfer.status === 'success' || transfer.status === 'failed' || transfer.status === 'reversed') {
      await applyPayoutTransferEvent(payload, {
        event: transfer.status === 'success' ? 'transfer.success' : transfer.status === 'reversed' ? 'transfer.reversed' : 'transfer.failed',
        reference: transfer.reference,
        amount: transfer.amount,
        currency: transfer.currency,
        status: transfer.status,
        transferCode: transfer.transfer_code,
      })
      return
    }
  } catch (error) {
    if (error instanceof PaystackTransferError && error.code === 'paystack_otp_enabled') {
      await withLock(`amb:payout-process:${current.id}`, 120, () => failPayout(payload, current.id, 'Transfers need OTP disabled in Paystack.', true))
      return
    }
    logger.warn({ payoutId: current.id, error: error instanceof PaystackTransferError ? error.code : 'unknown' }, 'ambassador_payout_verify_unavailable')
  }

  const age = now.getTime() - Date.parse(current.createdAt)
  const alertedAt = provider.adminAlertedAt ? Date.parse(String(provider.adminAlertedAt)) : 0
  const shouldAlert = age >= 24 * 60 * 60 * 1000 && (!alertedAt || now.getTime() - alertedAt >= 24 * 60 * 60 * 1000)
  const shouldUpdate = shouldAlert || age >= 60 * 60 * 1000
  if (!shouldUpdate) return
  const saved = await withLock(`amb:payout-process:${current.id}`, 120, async () => {
    const latest = await findPayout(payload, current.id)
    if (latest.status !== 'processing') return false
    const latestProvider = safeProviderPayload(latest.providerPayload ?? {})
    const latestAlertedAt = latestProvider.adminAlertedAt ? Date.parse(String(latestProvider.adminAlertedAt)) : 0
    const alert = age >= 24 * 60 * 60 * 1000 && (!latestAlertedAt || now.getTime() - latestAlertedAt >= 24 * 60 * 60 * 1000)
    await updatePayout(payload, current.id, { providerPayload: safeProviderPayload({ ...latestProvider, ...(alert ? { adminAlertedAt: now.toISOString() } : {}), checkedAt: now.toISOString() }) })
    return alert
  })
  if (saved) await sendAmbassadorPayoutAdminEmail(`Payout ${current.id} has been unresolved for more than 24 hours. Review its Paystack transfer reference in SkillsAir Studio.`)
}

export async function listAmbassadorPayouts(payload: Payload, ambassadorId: number, page: number, limit: number): Promise<{ rows: PayoutView[]; total: number; page: number }> {
  const result = await payload.find({
    collection: 'ambassador-payouts',
    where: { ambassador: { equals: ambassadorId } },
    page,
    limit,
    sort: '-createdAt',
    depth: 0,
    overrideAccess: true,
  })
  return {
    rows: (result.docs as unknown as PayoutDoc[]).map(payoutView),
    total: result.totalDocs,
    page: result.page ?? page,
  }
}

export async function approvedPayoutAudit(payload: Payload, args: { payout: PayoutDoc; actorId: number; req?: Partial<PayloadRequest> }): Promise<void> {
  await writeAudit(payload, { actorId: args.actorId, action: 'ambassador_payout_approved', targetCollection: 'ambassador-payouts', targetId: args.payout.id,
    before: { status: args.payout.status }, after: { status: 'approved', amountKobo: args.payout.amountKobo } }, args.req)
}
