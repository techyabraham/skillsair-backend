import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { sql } from '@payloadcms/db-postgres'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { AppError } from '../../types/index.js'
import { adminRateLimiter } from '../../lib/rate-limiter.js'
import { requireAdmin } from '../../lib/ambassadors/access.js'
import { ambassadorSQL } from '../../lib/ambassadors/db.js'
import { writeAudit } from '../../lib/ambassadors/audit.js'
import { getWallet, recordAdjustment, voidPayout, withTransaction } from '../../lib/ambassadors/ledger.js'
import { generateUniqueAmbassadorCode } from '../../lib/ambassadors/codes.js'
import { getNigerianBanks, resolveBankAccount } from '../../lib/ambassadors/banks.js'
import { processPayout, type PayoutDoc } from '../../lib/ambassadors/payouts.js'
import { handleOrderRefund } from '../../lib/ambassadors/refunds.js'
import { ambassadorCodeLink } from '../../lib/ambassadors/links.js'
import { toKobo } from '../../lib/money.js'
import { sendAmbassadorApprovedEmail, sendAmbassadorPayoutFailureEmail } from '../../lib/ambassadors/emails.js'
import { passwordResetEmail, sendEmail } from '../../lib/resend.js'
import { generateSecureToken, hashToken } from '../../utils/generate-code.js'
import { storePasswordResetToken } from '../../lib/redis.js'
import type { AmbassadorDoc, LedgerDoc, PayoutStatus } from '../../lib/ambassadors/types.js'

const statusSchema = z.enum(['pending', 'active', 'blocked'])
const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9._]{3,30}$/)
const bankSchema = z.object({ bankCode: z.string().min(1).max(20), accountNumber: z.string().regex(/^\d{10}$/) }).strict()
const createSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  username: usernameSchema,
  status: statusSchema.default('active'),
  reason: z.string().trim().max(500).optional(),
  bank: bankSchema.optional(),
}).strict()
const convertSchema = z.object({ userId: z.number().int().positive(), username: usernameSchema }).strict()
const statusBodySchema = z.object({ status: statusSchema, reason: z.string().trim().max(500).optional() }).strict()
const adjustmentSchema = z.object({ amountKobo: z.number().int().refine((value) => Number.isSafeInteger(value) && value !== 0), note: z.string().trim().min(10).max(500) }).strict()
const resolveFlagSchema = z.object({ note: z.string().trim().min(3).max(500) }).strict()
const reassignSchema = z.object({ userId: z.number().int().positive(), ambassadorId: z.number().int().positive(), note: z.string().trim().min(10).max(500) }).strict()
const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict()
const bulkSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(50) }).strict()
const refundSchema = z.object({ amountKobo: z.number().int().positive().optional() }).strict()

async function actor(req: PayloadRequest): Promise<{ id: number; email: string }> {
  const user = await requireAdmin(req)
  await adminRateLimiter.check(req, user.id)
  return { id: user.id, email: user.email }
}

function ip(req: PayloadRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

function relationId(value: unknown): number | undefined {
  const id = typeof value === 'object' && value !== null && 'id' in value ? (value as { id: unknown }).id : value
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : undefined
}

async function usernameExists(payload: PayloadRequest['payload'], username: string, exceptId?: number): Promise<boolean> {
  const rows = await payload.find({ collection: 'ambassadors', where: { username: { equals: username.toLowerCase() } }, limit: 2, depth: 0, overrideAccess: true })
  return rows.docs.some((row) => Number(row.id) !== exceptId)
}

async function createVerifiedBank(payload: PayloadRequest['payload'], ambassadorId: number, bankInput: z.infer<typeof bankSchema>, req: Partial<PayloadRequest>): Promise<{ id: number; accountLast4: string; bankName: string; accountName: string }> {
  const banks = await getNigerianBanks()
  const bank = banks.find((row) => row.code === bankInput.bankCode)
  if (!bank) throw new AppError('VALIDATION_ERROR', 'Choose a supported Nigerian bank.', { bankCode: 'Choose a supported Nigerian bank.' })
  const accountName = await resolveBankAccount(bank.code, bankInput.accountNumber)
  const created = await payload.create({
    collection: 'ambassador-bank-accounts',
    data: {
      ambassador: ambassadorId,
      bankCode: bank.code,
      bankName: bank.name,
      accountName,
      accountNumber: bankInput.accountNumber,
      accountLast4: bankInput.accountNumber.slice(-4),
      resolvedAt: new Date().toISOString(),
      isCurrent: true,
      holdUntil: null,
    },
    overrideAccess: true,
    req,
  }) as unknown as { id: number; accountLast4: string; bankName: string; accountName: string }
  return { id: created.id, accountLast4: created.accountLast4, bankName: created.bankName, accountName: created.accountName }
}

async function inviteAdminCreatedUser(userId: number, email: string, firstName: string): Promise<void> {
  const token = generateSecureToken()
  await storePasswordResetToken(hashToken(token), userId)
  const portalUrl = (process.env.AMBASSADOR_PORTAL_URL ?? 'https://ambassador.skillsair.com').replace(/\/$/, '')
  const link = `${portalUrl}/reset-password?token=${encodeURIComponent(token)}`
  try { await sendEmail(email, passwordResetEmail(firstName, link)) }
  catch { /* sendEmail records the failure; the administrator can resend from the user record. */ }
}

async function findAmbassador(payload: PayloadRequest['payload'], id: number, req?: Partial<PayloadRequest>): Promise<AmbassadorDoc> {
  return await payload.findByID({ collection: 'ambassadors', id, depth: 1, overrideAccess: true, ...(req ? { req } : {}) }) as unknown as AmbassadorDoc
}

async function ambassadorEmail(payload: PayloadRequest['payload'], payout: PayoutDoc): Promise<string | null> {
  const ambassadorId = relationId(payout.ambassador)
  if (!ambassadorId) return null
  const ambassador = await findAmbassador(payload, ambassadorId)
  return typeof ambassador.user === 'object' ? ambassador.user.email ?? null : null
}

async function approveOrRejectPayout(payload: PayloadRequest['payload'], id: number, adminId: number, action: 'approve' | 'reject', reason?: string): Promise<PayoutDoc> {
  const result = await withTransaction(payload, async (req) => {
    const current = await payload.findByID({ collection: 'ambassador-payouts', id, depth: 0, overrideAccess: true, req }) as unknown as PayoutDoc
    if (action === 'approve' && ['approved', 'processing', 'success'].includes(current.status)) return { payout: current, changed: false }
    if (action === 'reject' && current.status === 'rejected') return { payout: current, changed: false }
    if (current.status !== 'requested') throw new AppError('VALIDATION_ERROR', `Only requested payouts can be ${action}d.`)
    if (action === 'approve') {
      const updated = await payload.update({ collection: 'ambassador-payouts', id, data: { status: 'approved', reviewedBy: adminId, reviewedAt: new Date().toISOString() }, overrideAccess: true, req }) as unknown as PayoutDoc
      await writeAudit(payload, { actorId: adminId, action: 'ambassador_payout_approved', targetCollection: 'ambassador-payouts', targetId: id,
        before: { status: current.status }, after: { status: 'approved', amountKobo: current.amountKobo } }, req)
      return { payout: updated, changed: true }
    }
    const updated = await payload.update({ collection: 'ambassador-payouts', id, data: { status: 'rejected', failureReason: reason, reviewedBy: adminId, reviewedAt: new Date().toISOString(), processedAt: new Date().toISOString() }, overrideAccess: true, req }) as unknown as PayoutDoc
    await voidPayout(payload, id, req)
    await writeAudit(payload, { actorId: adminId, action: 'ambassador_payout_rejected', targetCollection: 'ambassador-payouts', targetId: id,
      before: { status: current.status }, after: { status: 'rejected', amountKobo: current.amountKobo, reason } }, req)
    return { payout: updated, changed: true }
  })
  if (action === 'approve' && ['approved', 'processing', 'success'].includes(result.payout.status)) {
    if (result.payout.status === 'approved') await processPayout(payload, id)
    return result.payout.status === 'approved' ? await payload.findByID({ collection: 'ambassador-payouts', id, depth: 0, overrideAccess: true }) as unknown as PayoutDoc : result.payout
  }
  if (action === 'reject' && result.changed) {
    const email = await ambassadorEmail(payload, result.payout).catch(() => null)
    if (email) await sendAmbassadorPayoutFailureEmail(email, result.payout.amountKobo, reason ?? 'Your withdrawal request was not approved. Contact SkillsAir support if you have questions.', relationId(result.payout.ambassador) ?? 0)
  }
  return result.payout
}

export const ambassadorAdminCreateEndpoint: Endpoint = {
  path: '/ambassadors/admin/ambassadors',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const admin = await actor(req)
    const body = parseBody(createSchema, await readJsonBody(req))
    if (body.status === 'blocked' && !body.reason) throw new AppError('VALIDATION_ERROR', 'A reason is required for a blocked ambassador.', { reason: 'Enter the reason for blocking this ambassador.' })
    const email = body.email.toLowerCase()
    if (await usernameExists(req.payload, body.username)) throw new AppError('ALREADY_EXISTS', 'That username is already in use.', { username: 'Choose another username.' })

    const result = await withTransaction(req.payload, async (txReq) => {
      await ambassadorSQL(req.payload, txReq, sql`SELECT pg_advisory_xact_lock(hashtextextended(${'amb-admin-user:' + email}, 0))`)
      const existing = await req.payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, depth: 0, overrideAccess: true, req: txReq })
      if (existing.docs[0]) throw new AppError('ALREADY_EXISTS', 'A SkillsAir account already uses this email. Convert that account instead.')
      const now = new Date().toISOString()
      const user = await req.payload.create({
        collection: 'users',
        data: { email, firstName: body.firstName, lastName: body.lastName, role: 'student', isStudent: false, isVerified: true, password: generateSecureToken() },
        context: { skipWelcomeEmail: true },
        overrideAccess: true,
        req: txReq,
      })
      const code = await generateUniqueAmbassadorCode(req.payload)
      const ambassador = await req.payload.create({
        collection: 'ambassadors',
        data: {
          user: Number(user.id), code, username: body.username, status: body.status, source: 'admin', emailVerifiedAt: now,
          ...(body.status === 'active' ? { approvedAt: now, approvedBy: admin.id } : {}),
          ...(body.status === 'blocked' ? { blockedAt: now, blockedReason: body.reason } : {}),
        },
        overrideAccess: true,
        req: txReq,
      }) as unknown as AmbassadorDoc
      const bank = body.bank ? await createVerifiedBank(req.payload, ambassador.id, body.bank, txReq) : null
      await writeAudit(req.payload, { actorId: admin.id, action: 'ambassador_admin_created', targetCollection: 'ambassadors', targetId: ambassador.id,
        after: { userId: Number(user.id), code, username: body.username, status: body.status, bank: bank ? { bankName: bank.bankName, accountLast4: bank.accountLast4 } : null } }, txReq)
      return { ambassador, userId: Number(user.id), email, firstName: body.firstName }
    })
    await inviteAdminCreatedUser(result.userId, result.email, result.firstName)
    return sendSuccess({ ambassadorId: result.ambassador.id, status: result.ambassador.status }, undefined, 201)
  }),
}

export const ambassadorAdminConvertEndpoint: Endpoint = {
  path: '/ambassadors/admin/ambassadors/convert',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const admin = await actor(req)
    const body = parseBody(convertSchema, await readJsonBody(req))
    if (await usernameExists(req.payload, body.username)) throw new AppError('ALREADY_EXISTS', 'That username is already in use.', { username: 'Choose another username.' })
    const result = await withTransaction(req.payload, async (txReq) => {
      const user = await req.payload.findByID({ collection: 'users', id: body.userId, depth: 0, overrideAccess: true, req: txReq })
      const existing = await req.payload.find({ collection: 'ambassadors', where: { user: { equals: body.userId } }, limit: 1, depth: 0, overrideAccess: true, req: txReq })
      if (existing.docs[0]) throw new AppError('ALREADY_EXISTS', 'This user is already an ambassador.')
      const now = new Date().toISOString()
      const ambassador = await req.payload.create({
        collection: 'ambassadors',
        data: { user: body.userId, code: await generateUniqueAmbassadorCode(req.payload), username: body.username, status: 'active', source: 'admin', emailVerifiedAt: now, approvedAt: now, approvedBy: admin.id },
        overrideAccess: true,
        req: txReq,
      }) as unknown as AmbassadorDoc
      await req.payload.update({ collection: 'users', id: body.userId, data: { isVerified: true }, overrideAccess: true, req: txReq })
      await writeAudit(req.payload, { actorId: admin.id, action: 'ambassador_admin_converted', targetCollection: 'ambassadors', targetId: ambassador.id,
        after: { userId: body.userId, username: body.username, status: 'active' } }, txReq)
      return { ambassador, email: String(user.email ?? ''), firstName: String(user.firstName ?? '') }
    })
    await sendAmbassadorApprovedEmail(result.email, result.firstName, ambassadorCodeLink(result.ambassador.code), result.ambassador.id)
    return sendSuccess({ ambassadorId: result.ambassador.id, status: result.ambassador.status }, undefined, 201)
  }),
}

export const ambassadorAdminStatusEndpoint: Endpoint = {
  path: '/ambassadors/admin/ambassadors/:id/status',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const admin = await actor(req)
    const id = Number(getParam(req, 'id'))
    if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('VALIDATION_ERROR', 'Invalid ambassador ID.')
    const body = parseBody(statusBodySchema, await readJsonBody(req))
    if (body.status === 'blocked' && !body.reason) throw new AppError('VALIDATION_ERROR', 'A reason is required when blocking an ambassador.', { reason: 'Enter a reason.' })
    const result = await withTransaction(req.payload, async (txReq) => {
      const before = await findAmbassador(req.payload, id, txReq)
      const now = new Date().toISOString()
      const after = await req.payload.update({
        collection: 'ambassadors', id, overrideAccess: true, req: txReq,
        data: {
          status: body.status,
          ...(body.status === 'active' ? { emailVerifiedAt: before.emailVerifiedAt ?? now, approvedAt: now, approvedBy: admin.id, blockedAt: null, blockedReason: null } : {}),
          ...(body.status === 'blocked' ? { blockedAt: now, blockedReason: body.reason } : {}),
        },
      }) as unknown as AmbassadorDoc
      if (body.status === 'active') {
        const userId = relationId(before.user)
        if (userId) await req.payload.update({ collection: 'users', id: userId, data: { isVerified: true }, overrideAccess: true, req: txReq })
      }
      await writeAudit(req.payload, { actorId: admin.id, action: `ambassador_status_${body.status}`, targetCollection: 'ambassadors', targetId: id,
        before: { status: before.status, blockedReason: before.blockedReason }, after: { status: after.status, blockedReason: after.blockedReason } }, txReq)
      return { before, after }
    })
    if (result.after.status === 'active') {
      const email = typeof result.before.user === 'object' ? result.before.user.email : null
      const firstName = typeof result.before.user === 'object' ? result.before.user.firstName ?? '' : ''
      if (email) await sendAmbassadorApprovedEmail(email, firstName, ambassadorCodeLink(result.after.code), id)
    }
    return sendSuccess({ id, status: result.after.status })
  }),
}

export const ambassadorAdminAdjustmentEndpoint: Endpoint = {
  path: '/ambassadors/admin/ambassadors/:id/adjust',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const admin = await actor(req)
    const id = Number(getParam(req, 'id'))
    const requestId = req.headers.get('idempotency-key')
    if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new AppError('VALIDATION_ERROR', 'Send a UUID v4 Idempotency-Key header.')
    const body = parseBody(adjustmentSchema, await readJsonBody(req))
    const result = await withTransaction(req.payload, async (txReq) => {
      const prior = await req.payload.find({ collection: 'ambassador-ledger', where: { idempotencyKey: { equals: `adjustment:${requestId}` } }, limit: 1, depth: 0, overrideAccess: true, req: txReq })
      if (prior.docs[0]) return prior.docs[0] as unknown as LedgerDoc
      const entry = await recordAdjustment(req.payload, { ambassadorId: id, amountKobo: body.amountKobo, note: body.note, createdBy: admin.id, idempotencyKey: `adjustment:${requestId}` }, txReq)
      await writeAudit(req.payload, { actorId: admin.id, action: 'ambassador_wallet_adjusted', targetCollection: 'ambassador-ledger', targetId: entry.id,
        before: null, after: { ambassadorId: id, amountKobo: body.amountKobo, note: body.note, idempotencyKey: entry.idempotencyKey } }, txReq)
      return entry
    })
    return sendSuccess({ id: result.id, type: result.type, status: result.status, amountKobo: result.amountKobo })
  }),
}

export const ambassadorAdminResolveFlagEndpoint: Endpoint = {
  path: '/ambassadors/admin/ambassadors/:id/flags/:flagIndex/resolve',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const admin = await actor(req)
    const id = Number(getParam(req, 'id'))
    const index = Number(getParam(req, 'flagIndex'))
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(index) || index < 0) throw new AppError('VALIDATION_ERROR', 'Invalid ambassador or risk flag.')
    const body = parseBody(resolveFlagSchema, await readJsonBody(req))
    const result = await withTransaction(req.payload, async (txReq) => {
      const before = await findAmbassador(req.payload, id, txReq)
      const flags = [...(before.riskFlags ?? [])]
      const flag = flags[index]
      if (!flag) throw new AppError('VALIDATION_ERROR', 'Risk flag not found.')
      if (flag.resolvedAt) return { before, flags, changed: false }
      flags[index] = { ...flag, note: `${flag.note ?? ''} | Resolution: ${body.note}`.slice(0, 500), resolvedAt: new Date().toISOString(), resolvedBy: admin.id }
      await req.payload.update({ collection: 'ambassadors', id, data: { riskFlags: flags }, overrideAccess: true, req: txReq })
      await writeAudit(req.payload, { actorId: admin.id, action: 'ambassador_risk_flag_resolved', targetCollection: 'ambassadors', targetId: id,
        before: { riskFlag: flag }, after: { riskFlag: flags[index] } }, txReq)
      return { before, flags, changed: true }
    })
    return sendSuccess({ id, resolved: true, changed: result.changed })
  }),
}

export const ambassadorAdminRevealBankEndpoint: Endpoint = {
  path: '/ambassadors/admin/ambassadors/:id/bank/reveal',
  method: 'get',
  handler: asyncHandler(async (req) => {
    const admin = await actor(req)
    const id = Number(getParam(req, 'id'))
    const found = await req.payload.find({ collection: 'ambassador-bank-accounts', where: { and: [{ ambassador: { equals: id } }, { isCurrent: { equals: true } }] }, limit: 1, depth: 0, overrideAccess: true })
    const bank = found.docs[0] as { id: number; accountNumber: string; accountLast4: string; bankName: string; accountName: string } | undefined
    if (!bank) throw new AppError('VALIDATION_ERROR', 'No current bank account is on file.')
    await writeAudit(req.payload, { actorId: admin.id, action: 'ambassador_bank_account_revealed', targetCollection: 'ambassador-bank-accounts', targetId: bank.id,
      before: null, after: { bankName: bank.bankName, accountLast4: bank.accountLast4 }, ip: ip(req) })
    return sendSuccess({ bankName: bank.bankName, accountName: bank.accountName, accountNumber: bank.accountNumber })
  }),
}

export const ambassadorAdminReassignEndpoint: Endpoint = {
  path: '/ambassadors/admin/attributions/reassign',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const admin = await actor(req)
    const body = parseBody(reassignSchema, await readJsonBody(req))
    const result = await withTransaction(req.payload, async (txReq) => {
      await ambassadorSQL(req.payload, txReq, sql`SELECT pg_advisory_xact_lock(hashtextextended(${'amb-reassign:' + body.userId}, 0))`)
      const ambassador = await findAmbassador(req.payload, body.ambassadorId, txReq)
      if (ambassador.status !== 'active') throw new AppError('VALIDATION_ERROR', 'Choose an active ambassador.')
      if (relationId(ambassador.user) === body.userId) throw new AppError('VALIDATION_ERROR', 'An ambassador cannot be referred to their own profile.')
      const rows = await req.payload.find({ collection: 'referral-attributions', where: { referredUser: { equals: body.userId } }, limit: 1, depth: 0, overrideAccess: true, req: txReq })
      const before = rows.docs[0] as { id: number; ambassador: number | { id: number }; source: string; attributedAt: string } | undefined
      if (!before) throw new AppError('VALIDATION_ERROR', 'This user has no referral attribution to reassign.')
      const after = await req.payload.update({ collection: 'referral-attributions', id: before.id, data: { ambassador: body.ambassadorId, source: 'admin', attributedAt: new Date().toISOString() }, overrideAccess: true, req: txReq })
      await writeAudit(req.payload, { actorId: admin.id, action: 'ambassador_attribution_reassigned', targetCollection: 'referral-attributions', targetId: before.id,
        before: { ambassadorId: relationId(before.ambassador), source: before.source }, after: { ambassadorId: body.ambassadorId, source: 'admin', note: body.note } }, txReq)
      return after
    })
    return sendSuccess({ id: result.id, ambassadorId: body.ambassadorId })
  }),
}

export const ambassadorAdminApprovePayoutEndpoint: Endpoint = {
  path: '/ambassadors/admin/payouts/:id/approve', method: 'post',
  handler: asyncHandler(async (req) => {
    const admin = await actor(req)
    const id = Number(getParam(req, 'id'))
    if (!Number.isSafeInteger(id) || id < 1) throw new AppError('VALIDATION_ERROR', 'Invalid payout ID.')
    const payout = await approveOrRejectPayout(req.payload, id, admin.id, 'approve')
    return sendSuccess({ id, status: payout.status, amountKobo: payout.amountKobo })
  }),
}

export const ambassadorAdminRejectPayoutEndpoint: Endpoint = {
  path: '/ambassadors/admin/payouts/:id/reject', method: 'post',
  handler: asyncHandler(async (req) => {
    const admin = await actor(req)
    const id = Number(getParam(req, 'id'))
    const body = parseBody(rejectSchema, await readJsonBody(req))
    if (!Number.isSafeInteger(id) || id < 1) throw new AppError('VALIDATION_ERROR', 'Invalid payout ID.')
    const payout = await approveOrRejectPayout(req.payload, id, admin.id, 'reject', body.reason)
    return sendSuccess({ id, status: payout.status })
  }),
}

export const ambassadorAdminBulkApprovePayoutsEndpoint: Endpoint = {
  path: '/ambassadors/admin/payouts/bulk-approve', method: 'post',
  handler: asyncHandler(async (req) => {
    const admin = await actor(req)
    const body = parseBody(bulkSchema, await readJsonBody(req))
    const results: Array<{ id: number; ok: boolean; status?: PayoutStatus; message?: string }> = []
    for (const id of [...new Set(body.ids)]) {
      try {
        const result = await approveOrRejectPayout(req.payload, id, admin.id, 'approve')
        results.push({ id, ok: true, status: result.status })
      } catch {
        results.push({ id, ok: false, message: 'This payout could not be approved. Refresh the queue and review its status.' })
      }
    }
    return sendSuccess(results)
  }),
}

export const ambassadorAdminRefundOrderEndpoint: Endpoint = {
  path: '/ambassadors/admin/orders/:id/refund', method: 'post',
  handler: asyncHandler(async (req) => {
    const admin = await actor(req)
    const id = Number(getParam(req, 'id'))
    if (!Number.isSafeInteger(id) || id < 1) throw new AppError('VALIDATION_ERROR', 'Invalid order ID.')
    const requestId = req.headers.get('idempotency-key')
    if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new AppError('VALIDATION_ERROR', 'Send a UUID v4 Idempotency-Key header.')
    const body = parseBody(refundSchema, await readJsonBody(req))
    const order = await req.payload.findByID({ collection: 'orders', id, depth: 0, overrideAccess: true })
    const metadata = (order.metadata ?? {}) as { ambassadorRefunds?: Array<{ key: string; kobo: number }> }
    const refundKey = `admin:${requestId}`
    const priorReceipt = (metadata.ambassadorRefunds ?? []).find((receipt) => receipt.key === refundKey)
    if (priorReceipt) return sendSuccess({ orderId: id, refundedKobo: priorReceipt.kobo, alreadyApplied: true })
    if (order.status !== 'success' && order.status !== 'refunded') throw new AppError('VALIDATION_ERROR', 'Only a paid order can be marked as refunded.')
    const alreadyRefunded = (metadata.ambassadorRefunds ?? []).reduce((sum, receipt) => sum + Number(receipt.kobo), 0)
    const saleKobo = toKobo(Number(order.amount))
    const amountKobo = body.amountKobo ?? saleKobo - alreadyRefunded
    if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0 || alreadyRefunded + amountKobo > saleKobo) throw new AppError('VALIDATION_ERROR', 'Refund amount must be a positive amount no greater than the remaining order balance.')
    const intent = await writeAudit(req.payload, { actorId: admin.id, action: 'ambassador_order_refund_requested', targetCollection: 'orders', targetId: id,
      before: { status: order.status, refundedKobo: alreadyRefunded }, after: { refundKobo: amountKobo, status: 'recording_refund' }, ip: ip(req) })
    await handleOrderRefund(req.payload, { orderId: id, refundedKobo: amountKobo, refundKey })
    await writeAudit(req.payload, { actorId: admin.id, action: 'ambassador_order_refund_recorded', targetCollection: 'orders', targetId: id,
      before: { status: order.status, refundedKobo: alreadyRefunded }, after: { refundedKobo: alreadyRefunded + amountKobo }, ip: ip(req) })
    return sendSuccess({ orderId: id, refundedKobo: amountKobo })
  }),
}

export const ambassadorAdminOverviewEndpoint: Endpoint = {
  path: '/ambassadors/admin/overview', method: 'get',
  handler: asyncHandler(async (req) => {
    await actor(req)
    const now = new Date()
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit' }).formatToParts(now)
    const year = Number(parts.find((part) => part.type === 'year')?.value)
    const month = Number(parts.find((part) => part.type === 'month')?.value)
    const monthStart = new Date(Date.UTC(year, month - 1, 1, -1))
    const weekStart = new Date(now.getTime() - 7 * 86_400_000)
    const [row] = await withTransaction(req.payload, (txReq) => ambassadorSQL(req.payload, txReq, sql`
      SELECT
        (SELECT COUNT(*) FROM "ambassadors" WHERE "status" = 'active')::bigint AS "active_ambassadors",
        (SELECT COUNT(*) FROM "ambassadors" WHERE "status" = 'pending')::bigint AS "pending_applications",
        (SELECT COALESCE(SUM("amount_kobo"), 0) FROM "ambassador_ledger" WHERE "type" = 'commission' AND "status" IN ('pending','approved') AND "created_at" >= ${monthStart.toISOString()})::numeric AS "commissions_month",
        (SELECT COUNT(*) FROM "ambassador_payouts" WHERE "status" = 'requested')::bigint AS "payouts_awaiting_review",
        (SELECT COALESCE(SUM("amount_kobo"), 0) FROM "ambassador_payouts" WHERE "status" = 'requested')::numeric AS "payouts_awaiting_review_kobo",
        (SELECT COUNT(*) FROM "ambassador_payouts" WHERE "status" = 'failed' AND "updated_at" >= ${weekStart.toISOString()})::bigint AS "failed_payouts_7d"`))
    return sendSuccess({
      activeAmbassadors: Number(row?.active_ambassadors ?? 0),
      pendingApplications: Number(row?.pending_applications ?? 0),
      commissionsThisMonthKobo: Number(row?.commissions_month ?? 0),
      payoutsAwaitingReview: Number(row?.payouts_awaiting_review ?? 0),
      payoutsAwaitingReviewKobo: Number(row?.payouts_awaiting_review_kobo ?? 0),
      failedPayouts7d: Number(row?.failed_payouts_7d ?? 0),
    })
  }),
}

export const ambassadorAdminPayoutsListEndpoint: Endpoint = {
  path: '/ambassadors/admin/payouts', method: 'get',
  handler: asyncHandler(async (req) => {
    await actor(req)
    const url = new URL(req.url ?? 'http://localhost')
    const rawStatus = url.searchParams.get('status') ?? 'requested'
    const allowed: PayoutStatus[] = ['requested', 'approved', 'processing', 'success', 'failed', 'rejected']
    if (rawStatus !== 'all' && !allowed.includes(rawStatus as PayoutStatus)) throw new AppError('VALIDATION_ERROR', 'Choose a valid payout status.')
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50))
    const result = await req.payload.find({
      collection: 'ambassador-payouts',
      where: rawStatus === 'all' ? undefined : { status: { equals: rawStatus } },
      page, limit, sort: '-createdAt', depth: 1, overrideAccess: true,
    })
    const rows = await Promise.all((result.docs as unknown as PayoutDoc[]).map(async (payout) => {
      const ambassadorId = relationId(payout.ambassador)
      const ambassador = typeof payout.ambassador === 'object' ? payout.ambassador : ambassadorId ? await findAmbassador(req.payload, ambassadorId) : null
      const flags = ambassador?.riskFlags ?? []
      const wallet = ambassadorId ? await getWallet(req.payload, ambassadorId) : { availableKobo: 0 }
      return {
        id: payout.id,
        ambassadorId,
        name: typeof ambassador?.user === 'object' ? `${ambassador.user.firstName ?? ''} ${ambassador.user.lastName ?? ''}`.trim() : 'Ambassador',
        email: typeof ambassador?.user === 'object' ? ambassador.user.email : '',
        amountKobo: payout.amountKobo,
        status: payout.status,
        bankName: payout.bankName ?? '',
        accountLast4: payout.accountLast4 ?? '',
        availableBalanceKobo: wallet.availableKobo,
        openRiskFlags: flags.filter((flag) => !flag.resolvedAt).map((flag) => ({ kind: flag.kind, note: flag.note ?? '' })),
        requestedAt: payout.createdAt,
        failureReason: payout.failureReason ?? null,
      }
    }))
    return sendSuccess(rows, { page: result.page ?? page, total: result.totalDocs })
  }),
}

export const ambassadorAdminApplicantsEndpoint: Endpoint = {
  path: '/ambassadors/admin/ambassadors', method: 'get',
  handler: asyncHandler(async (req) => {
    await actor(req)
    const url = new URL(req.url ?? 'http://localhost')
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20))
    const status = url.searchParams.get('status')
    const search = url.searchParams.get('search')?.trim().slice(0, 100)
    const and: import('payload').Where[] = []
    if (status && status !== 'all') {
      if (!statusSchema.safeParse(status).success) throw new AppError('VALIDATION_ERROR', 'Choose a valid ambassador status.')
      and.push({ status: { equals: status } })
    }
    if (search) and.push({ or: [
      { username: { like: search } }, { code: { like: search.toUpperCase() } },
      { 'user.firstName': { like: search } }, { 'user.lastName': { like: search } }, { 'user.email': { like: search.toLowerCase() } },
    ] })
    const result = await req.payload.find({ collection: 'ambassadors', where: and.length ? { and } : undefined, page, limit, sort: '-createdAt', depth: 1, overrideAccess: true })
    const ids = result.docs.map((row) => Number(row.id)).filter((value) => Number.isSafeInteger(value) && value > 0)
    const customerCounts: Record<number, number> = {}
    if (ids.length) {
      const idList = sql.join(ids.map((value) => sql`${value}`), sql`, `)
      const counts = await withTransaction(req.payload, (txReq) => ambassadorSQL(req.payload, txReq, sql`
        SELECT ra.ambassador_id, COUNT(DISTINCT ra.referred_user_id) FILTER (WHERE EXISTS (
          SELECT 1 FROM orders o WHERE o.user_id = ra.referred_user_id AND o.status = 'success'
        ))::int AS customers
        FROM referral_attributions ra
        WHERE ra.ambassador_id IN (${idList})
        GROUP BY ra.ambassador_id`))
      for (const row of counts) customerCounts[Number(row.ambassador_id)] = Number(row.customers ?? 0)
    }
    const rows = await Promise.all((result.docs as unknown as AmbassadorDoc[]).map(async (ambassador) => {
      const user = typeof ambassador.user === 'object' ? ambassador.user : null
      const wallet = await getWallet(req.payload, ambassador.id)
      return {
        id: ambassador.id,
        firstName: user?.firstName ?? '',
        lastName: user?.lastName ?? '',
        email: user?.email ?? '',
        username: ambassador.username,
        code: ambassador.code,
        status: ambassador.status,
        emailVerified: Boolean(ambassador.emailVerifiedAt),
        promotionPlan: ambassador.promotionPlan ?? '',
        about: ambassador.about ?? '',
        heardAbout: ambassador.heardAbout ?? '',
        createdAt: ambassador.createdAt,
        blockedReason: ambassador.blockedReason ?? null,
        wallet,
        customers: customerCounts[ambassador.id] ?? 0,
      }
    }))
    return sendSuccess(rows, { page: result.page ?? page, total: result.totalDocs })
  }),
}

export const ambassadorAdminWalletEndpoint: Endpoint = {
  path: '/ambassadors/admin/ambassadors/:id/wallet',
  method: 'get',
  handler: asyncHandler(async (req) => {
    await actor(req)
    const id = Number(getParam(req, 'id'))
    if (!Number.isSafeInteger(id) || id < 1) throw new AppError('VALIDATION_ERROR', 'Invalid ambassador ID.')
    const ambassador = await findAmbassador(req.payload, id)
    const url = new URL(req.url ?? 'http://localhost')
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const [wallet, ledger, payouts, referrals] = await Promise.all([
      getWallet(req.payload, id),
      req.payload.find({ collection: 'ambassador-ledger', where: { ambassador: { equals: id } }, page, limit: 20, sort: '-createdAt', depth: 1, overrideAccess: true }),
      req.payload.find({ collection: 'ambassador-payouts', where: { ambassador: { equals: id } }, page: 1, limit: 20, sort: '-createdAt', depth: 0, overrideAccess: true }),
      req.payload.find({ collection: 'referral-attributions', where: { ambassador: { equals: id } }, page: 1, limit: 20, sort: '-attributedAt', depth: 1, overrideAccess: true }),
    ])
    return sendSuccess({
      ambassador: {
        id, code: ambassador.code, username: ambassador.username, status: ambassador.status,
        firstName: typeof ambassador.user === 'object' ? ambassador.user.firstName ?? '' : '',
        lastName: typeof ambassador.user === 'object' ? ambassador.user.lastName ?? '' : '',
        email: typeof ambassador.user === 'object' ? ambassador.user.email ?? '' : '',
        riskFlags: (ambassador.riskFlags ?? []).map((flag, index) => ({ ...flag, index })),
      },
      wallet,
      ledger: ledger.docs.map((row) => {
        const entry = row as unknown as LedgerDoc
        const referred = typeof entry.referredUser === 'object' && entry.referredUser ? entry.referredUser as { firstName?: string; lastName?: string; email?: string } : null
        return { id: entry.id, type: entry.type, status: entry.status, amountKobo: entry.amountKobo, productTitle: entry.productTitle ?? '', createdAt: entry.createdAt, availableAt: entry.availableAt ?? null, note: entry.note ?? '', customer: referred ? `${referred.firstName ?? ''} ${referred.lastName?.slice(0, 1) ?? ''}.`.trim() : '' }
      }),
      ledgerMeta: { page: ledger.page ?? page, total: ledger.totalDocs },
      payouts: payouts.docs.map((row) => {
        const payout = row as unknown as PayoutDoc
        return { id: payout.id, amountKobo: payout.amountKobo, status: payout.status, bankName: payout.bankName ?? '', accountLast4: payout.accountLast4 ?? '', createdAt: payout.createdAt, processedAt: payout.processedAt ?? null, failureReason: payout.failureReason ?? null }
      }),
      referrals: referrals.docs.map((row) => {
        const attribution = row as { id: number; attributedAt: string; referredUser?: number | { firstName?: string; lastName?: string; email?: string } }
        const referred = typeof attribution.referredUser === 'object' ? attribution.referredUser : null
        return { id: attribution.id, attributedAt: attribution.attributedAt, name: referred ? `${referred.firstName ?? ''} ${referred.lastName?.slice(0, 1) ?? ''}.`.trim() : '', email: referred?.email ?? '' }
      }),
    })
  }),
}

export const ambassadorAdminFindUsersEndpoint: Endpoint = {
  path: '/ambassadors/admin/users',
  method: 'get',
  handler: asyncHandler(async (req) => {
    await actor(req)
    const email = new URL(req.url ?? 'http://localhost').searchParams.get('email')?.trim().toLowerCase() ?? ''
    if (!email || email.length > 254) throw new AppError('VALIDATION_ERROR', 'Enter the email address of the existing SkillsAir user.')
    const result = await req.payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, depth: 0, overrideAccess: true })
    const docs = result.docs as unknown as Array<{ id: number | string; email?: string; firstName?: string; lastName?: string }>
    return sendSuccess(docs.map((doc) => ({ id: Number(doc.id), email: String(doc.email ?? ''), firstName: String(doc.firstName ?? ''), lastName: String(doc.lastName ?? '') })))
  }),
}

export const ambassadorAdminPayoutDetailEndpoint: Endpoint = {
  path: '/ambassadors/admin/payouts/:id',
  method: 'get',
  handler: asyncHandler(async (req) => {
    await actor(req)
    const id = Number(getParam(req, 'id'))
    if (!Number.isSafeInteger(id) || id < 1) throw new AppError('VALIDATION_ERROR', 'Invalid payout ID.')
    const payout = await req.payload.findByID({ collection: 'ambassador-payouts', id, depth: 0, overrideAccess: true }) as unknown as PayoutDoc
    return sendSuccess({ id: payout.id, amountKobo: payout.amountKobo, status: payout.status, reference: payout.reference, transferCode: payout.paystackTransferCode ?? null, bankName: payout.bankName ?? '', accountLast4: payout.accountLast4 ?? '' })
  }),
}

export const ambassadorAdminEndpoints: Endpoint[] = [
  ambassadorAdminCreateEndpoint,
  ambassadorAdminConvertEndpoint,
  ambassadorAdminStatusEndpoint,
  ambassadorAdminAdjustmentEndpoint,
  ambassadorAdminResolveFlagEndpoint,
  ambassadorAdminRevealBankEndpoint,
  ambassadorAdminReassignEndpoint,
  ambassadorAdminApprovePayoutEndpoint,
  ambassadorAdminRejectPayoutEndpoint,
  ambassadorAdminBulkApprovePayoutsEndpoint,
  ambassadorAdminRefundOrderEndpoint,
  ambassadorAdminOverviewEndpoint,
  ambassadorAdminPayoutsListEndpoint,
  ambassadorAdminApplicantsEndpoint,
  ambassadorAdminWalletEndpoint,
  ambassadorAdminFindUsersEndpoint,
  ambassadorAdminPayoutDetailEndpoint,
]
