import { createHash } from 'node:crypto'
import type { Endpoint, PayloadRequest } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { AppError } from '../../types/index.js'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { createPayloadRateLimiterFor } from '../../lib/rate-limiter.js'
import { logger } from '../../lib/logger.js'
import { sendEmail } from '../../lib/resend.js'
import { getNigerianBanks, resolveBankAccount } from '../../lib/ambassadors/banks.js'
import { getWallet, withTransaction } from '../../lib/ambassadors/ledger.js'
import { requireAmbassador, loadAmbassadorForUser } from '../../lib/ambassadors/access.js'
import { getAmbassadorSettings } from '../../lib/ambassadors/settings.js'
import { ambassadorSQL } from '../../lib/ambassadors/db.js'
import { writeAudit } from '../../lib/ambassadors/audit.js'
import { ambassadorBankChangedEmail } from '../../lib/ambassadors/emails.js'
import type { AmbassadorDoc, LedgerDoc } from '../../lib/ambassadors/types.js'

const bankChangeLimiter = createPayloadRateLimiterFor('ambassador-bank-change', 20, 60 * 60)
const bankSchema = z.object({ bankCode: z.string().trim().min(1).max(20), accountNumber: z.string().regex(/^\d{10}$/) })
const relation = (value: unknown): number | null => typeof value === 'number' ? value : value && typeof value === 'object' && 'id' in value ? Number((value as { id: unknown }).id) : null
const numberFrom = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

function lagosToday(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10)
}

function requestUrl(req: PayloadRequest): URL {
  return new URL(req.url ?? 'http://localhost')
}

function lagosDays(count: number): string[] {
  const today = lagosToday()
  const base = new Date(`${today}T00:00:00.000Z`)
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(base)
    day.setUTCDate(base.getUTCDate() - (count - 1 - index))
    return day.toISOString().slice(0, 10)
  })
}

function dateRangeStartLagos(date: string): Date {
  return new Date(`${date}T00:00:00+01:00`)
}

function dayMap(days: string[], rows: Array<Record<string, unknown>>, key: string): Array<{ date: string; value: number }> {
  const values = new Map(rows.map((row) => [String(row.date), numberFrom(row[key])]))
  return days.map((date) => ({ date, value: values.get(date) ?? 0 }))
}

function safeUserName(user: { firstName?: string | null; lastName?: string | null }): string {
  const first = user.firstName?.trim() ?? ''
  const initial = user.lastName?.trim().charAt(0) ?? ''
  return `${first}${initial ? ` ${initial}.` : ''}`.trim()
}

export const ambassadorMeEndpoint: Endpoint = {
  path: '/ambassadors/me',
  method: 'get',
  handler: asyncHandler(async (req) => {
    const { user, ambassador } = await loadAmbassadorForUser(req)
    if (!ambassador) throw new AppError('INSUFFICIENT_PERMISSION', 'You are not a SkillsAir ambassador.', { reason: 'not_ambassador' })
    const [userDoc, banks] = await Promise.all([
      req.payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true }),
      req.payload.find({ collection: 'ambassador-bank-accounts', where: { and: [{ ambassador: { equals: ambassador.id } }, { isCurrent: { equals: true } }] }, limit: 1, depth: 0, overrideAccess: true }),
    ])
    const current = banks.docs[0] as unknown as { bankName: string; accountName: string; accountLast4: string; holdUntil?: string | null } | undefined
    return sendSuccess({
      user: { firstName: userDoc.firstName, lastName: userDoc.lastName, email: userDoc.email },
      ambassador: {
        id: ambassador.id,
        code: ambassador.code,
        username: ambassador.username,
        status: ambassador.status,
        emailVerified: Boolean(ambassador.emailVerifiedAt),
        createdAt: ambassador.createdAt,
        ...(ambassador.status === 'blocked' && ambassador.blockedReason ? { blockedReason: ambassador.blockedReason } : {}),
      },
      link: `${process.env.MAIN_SITE_URL ?? 'https://skillsair.com'}/?ref=${ambassador.code}`,
      bank: current ? { bankName: current.bankName, accountName: current.accountName, accountLast4: current.accountLast4, holdUntil: current.holdUntil ?? null } : null,
    })
  }),
}

export const ambassadorSummaryEndpoint: Endpoint = {
  path: '/ambassadors/me/summary',
  method: 'get',
  handler: asyncHandler(async (req) => {
    const { ambassador } = await requireAmbassador(req)
    const days = lagosDays(30)
    const from = dateRangeStartLagos(days[0]!)
    const data = await withTransaction(req.payload, async (txReq) => {
      const wallet = await getWallet(req.payload, ambassador.id, txReq)
      const clickRows = await ambassadorSQL(req.payload, txReq, sql`
        SELECT to_char(("created_at" AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS "date",
          COUNT(*)::bigint AS "clicks",
          COUNT(*) FILTER (WHERE "is_unique" = true)::bigint AS "unique_visitors"
        FROM "referral_clicks"
        WHERE "ambassador_id" = ${ambassador.id} AND "created_at" >= ${from.toISOString()}
        GROUP BY 1`)
      const earningRows = await ambassadorSQL(req.payload, txReq, sql`
        SELECT to_char(("created_at" AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS "date",
          COALESCE(SUM("amount_kobo"), 0)::bigint AS "kobo"
        FROM "ambassador_ledger"
        WHERE "ambassador_id" = ${ambassador.id} AND "created_at" >= ${from.toISOString()}
          AND "status" <> 'void' AND "type" IN ('commission', 'reversal', 'adjustment')
        GROUP BY 1`)
      const totalsRows = await ambassadorSQL(req.payload, txReq, sql`
        WITH "customers" AS (
          SELECT ra."referred_user_id", COUNT(o."id") FILTER (WHERE o."status" = 'success')::bigint AS "paid_orders"
          FROM "referral_attributions" ra
          LEFT JOIN "orders" o ON o."user_id" = ra."referred_user_id"
          WHERE ra."ambassador_id" = ${ambassador.id}
          GROUP BY ra."referred_user_id"
        )
        SELECT COUNT(*) FILTER (WHERE "paid_orders" = 0)::bigint AS "prospects",
          COUNT(*) FILTER (WHERE "paid_orders" > 0)::bigint AS "customers",
          (SELECT COUNT(*)::bigint FROM "ambassador_ledger" l WHERE l."ambassador_id" = ${ambassador.id} AND l."type" = 'commission' AND l."product_type" = 'renewal' AND l."status" <> 'void') AS "renewals"
        FROM "customers"`)
      const clickTotals = clickRows.reduce<{ clicks: number; uniqueVisitors: number }>((total, row) => ({
        clicks: total.clicks + numberFrom(row.clicks),
        uniqueVisitors: total.uniqueVisitors + numberFrom(row.unique_visitors),
      }), { clicks: 0, uniqueVisitors: 0 })
      const total = totalsRows[0] ?? {}
      return {
        wallet,
        last30Days: {
          clicks: clickTotals.clicks,
          uniqueVisitors: clickTotals.uniqueVisitors,
          earningsKobo: earningRows.reduce((sum, row) => sum + numberFrom(row.kobo), 0),
          series: dayMap(days, earningRows, 'kobo').map(({ date, value }) => ({ date, kobo: value })),
        },
        totals: { prospects: numberFrom(total.prospects), customers: numberFrom(total.customers), renewals: numberFrom(total.renewals) },
      }
    })
    return sendSuccess(data)
  }),
}

export const ambassadorEarningsEndpoint: Endpoint = {
  path: '/ambassadors/me/earnings',
  method: 'get',
  handler: asyncHandler(async (req) => {
    const { ambassador } = await requireAmbassador(req)
    const url = requestUrl(req)
    const rawStatus = url.searchParams.get('status') ?? 'all'
    if (!['pending', 'approved', 'void', 'all'].includes(rawStatus)) throw new AppError('VALIDATION_ERROR', 'Choose a valid earnings status.', { status: 'Choose a valid earnings status.' })
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20))
    const and: import('payload').Where[] = [
      { ambassador: { equals: ambassador.id } },
      { type: { in: ['commission', 'reversal', 'adjustment'] } },
    ]
    if (rawStatus !== 'all') and.push({ status: { equals: rawStatus } })
    const result = await req.payload.find({
      collection: 'ambassador-ledger',
      where: { and },
      page,
      limit,
      sort: '-createdAt',
      depth: 1,
      overrideAccess: true,
    })
    const rows = result.docs.map((doc) => {
      const row = doc as unknown as LedgerDoc
      const referred = row.referredUser && typeof row.referredUser === 'object' ? row.referredUser as { firstName?: string; lastName?: string; email?: string } : null
      return {
        id: row.id,
        type: row.type,
        status: row.status,
        amountKobo: row.amountKobo,
        productType: row.productType ?? 'none',
        productTitle: row.productTitle ?? '',
        customer: referred ? safeUserName(referred) : 'SkillsAir customer',
        createdAt: row.createdAt,
        availableAt: row.availableAt ?? null,
      }
    })
    return sendSuccess(rows, { page: result.page ?? page, total: result.totalDocs })
  }),
}

const referralSegmentSchema = z.enum(['customers', 'prospects'])

export const ambassadorReferralsEndpoint: Endpoint = {
  path: '/ambassadors/me/referrals',
  method: 'get',
  handler: asyncHandler(async (req) => {
    const { ambassador } = await requireAmbassador(req)
    const url = requestUrl(req)
    const segment = referralSegmentSchema.safeParse(url.searchParams.get('segment') ?? 'customers')
    if (!segment.success) throw new AppError('VALIDATION_ERROR', 'Choose customers or prospects.', { segment: 'Choose customers or prospects.' })
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20))
    const offset = (page - 1) * limit
    const settings = await getAmbassadorSettings(req.payload)
    const data = await withTransaction(req.payload, async (txReq) => {
      const rows = await ambassadorSQL(req.payload, txReq, sql`
        WITH "referral_summary" AS (
          SELECT u."id" AS "user_id", u."first_name", u."last_name",
            CASE WHEN ${settings.showReferredEmails} THEN u."email" ELSE NULL END AS "email",
            u."created_at" AS "joined_at", COUNT(o."id") FILTER (WHERE o."status" = 'success')::bigint AS "paid_orders",
            MAX(o."paid_at") FILTER (WHERE o."status" = 'success') AS "last_purchase_at",
            MAX(ra."attributed_at") AS "attributed_at"
          FROM "referral_attributions" ra
          JOIN "users" u ON u."id" = ra."referred_user_id"
          LEFT JOIN "orders" o ON o."user_id" = u."id"
          WHERE ra."ambassador_id" = ${ambassador.id}
          GROUP BY u."id", u."first_name", u."last_name", u."email", u."created_at"
        )
        SELECT * FROM "referral_summary"
        WHERE ${segment.data === 'customers' ? sql`"paid_orders" > 0` : sql`"paid_orders" = 0`}
        ORDER BY "attributed_at" DESC, "user_id" DESC
        LIMIT ${limit} OFFSET ${offset}`)
      const totals = await ambassadorSQL(req.payload, txReq, sql`
        WITH "referral_summary" AS (
          SELECT ra."referred_user_id", COUNT(o."id") FILTER (WHERE o."status" = 'success')::bigint AS "paid_orders"
          FROM "referral_attributions" ra
          LEFT JOIN "orders" o ON o."user_id" = ra."referred_user_id"
          WHERE ra."ambassador_id" = ${ambassador.id}
          GROUP BY ra."referred_user_id"
        )
        SELECT COUNT(*)::bigint AS "total" FROM "referral_summary"
        WHERE ${segment.data === 'customers' ? sql`"paid_orders" > 0` : sql`"paid_orders" = 0`}`)
      const total = numberFrom(totals[0]?.total)
      return {
        rows: rows.map((row) => ({
          name: safeUserName({ firstName: String(row.first_name ?? ''), lastName: String(row.last_name ?? '') }),
          ...(settings.showReferredEmails && typeof row.email === 'string' ? { email: row.email } : {}),
          joinedAt: row.joined_at,
          paidOrders: numberFrom(row.paid_orders),
          lastPurchaseAt: row.last_purchase_at ?? null,
        })),
        total,
      }
    })
    return sendSuccess(data.rows, { page, total: data.total })
  }),
}

function normalizedNameParts(value: string): string[] {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function hasNameMatch(firstName: string, lastName: string, resolvedName: string): boolean {
  const resolved = new Set(normalizedNameParts(resolvedName))
  return [firstName, lastName].some((name) => {
    const parts = normalizedNameParts(name)
    return parts.length > 0 && parts.some((part) => resolved.has(part))
  })
}

async function addRiskFlag(payload: Parameters<typeof writeAudit>[0], ambassadorId: number, kind: 'manual' | 'shared_bank', note: string, req: Partial<PayloadRequest>): Promise<void> {
  const current = await payload.findByID({ collection: 'ambassadors', id: ambassadorId, depth: 0, overrideAccess: true, req }) as unknown as AmbassadorDoc
  const flags = current.riskFlags ?? []
  if (flags.some((flag) => flag.kind === kind && !flag.resolvedAt && flag.note === note)) return
  await payload.update({
    collection: 'ambassadors',
    id: ambassadorId,
    data: { riskFlags: [...flags, { kind, note, openedAt: new Date().toISOString() }] },
    overrideAccess: true,
    req,
  })
}

export const ambassadorBankAccountEndpoint: Endpoint = {
  path: '/ambassadors/me/bank-account',
  method: 'put',
  handler: asyncHandler(async (req) => {
    const { user, ambassador } = await requireAmbassador(req)
    await bankChangeLimiter.check(req)
    const body = parseBody(bankSchema, await readJsonBody(req))
    const banks = await getNigerianBanks()
    const bank = banks.find((row) => row.code === body.bankCode)
    if (!bank) throw new AppError('VALIDATION_ERROR', 'Choose a supported Nigerian bank.', { bankCode: 'Choose a supported Nigerian bank.' })
    let accountName: string
    try {
      accountName = await resolveBankAccount(body.bankCode, body.accountNumber)
    } catch (error) {
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') throw new AppError('VALIDATION_ERROR', "We couldn't find this account. Check the number and bank.", { accountNumber: "We couldn't find this account. Check the number and bank." })
      throw error
    }
    const userDoc = await req.payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })
    const settings = await getAmbassadorSettings(req.payload)
    const accountLast4 = body.accountNumber.slice(-4)
    const flaggedForName = !hasNameMatch(String(userDoc.firstName ?? ''), String(userDoc.lastName ?? ''), accountName)
    const accountHash = createHash('sha256').update(body.accountNumber).digest('hex')
    const result = await withTransaction(req.payload, async (txReq) => {
      const txId = await txReq.transactionID
      if (txId != null) {
        await ambassadorSQL(req.payload, txReq, sql`SELECT pg_advisory_xact_lock(hashtext(${accountHash}), 1537001)`)
        await ambassadorSQL(req.payload, txReq, sql`SELECT pg_advisory_xact_lock(hashtext(${`amb_bank:${ambassador.id}`}), 1537002)`)
      }
      const existing = await req.payload.find({ collection: 'ambassador-bank-accounts', where: { and: [{ ambassador: { equals: ambassador.id } }, { isCurrent: { equals: true } }] }, limit: 1, depth: 0, overrideAccess: true, req: txReq })
      const previous = existing.docs[0] as unknown as { id: number; accountLast4: string; accountNumber: string; bankCode: string; bankName: string; accountName: string; holdUntil?: string | null } | undefined
      if (previous && previous.bankCode === body.bankCode && previous.accountNumber === body.accountNumber) {
        return { id: previous.id, bankName: previous.bankName, accountName: previous.accountName, accountLast4: previous.accountLast4, holdUntil: previous.holdUntil ?? null, changed: false }
      }
      const holdUntil = previous ? new Date(Date.now() + settings.newBankHoldHours * 60 * 60 * 1000).toISOString() : null
      if (previous) await req.payload.update({ collection: 'ambassador-bank-accounts', id: previous.id, data: { isCurrent: false }, overrideAccess: true, req: txReq })
      const account = await req.payload.create({
        collection: 'ambassador-bank-accounts',
        data: {
          ambassador: ambassador.id,
          bankCode: bank.code,
          bankName: bank.name,
          accountName,
          accountNumber: body.accountNumber,
          accountLast4,
          resolvedAt: new Date().toISOString(),
          isCurrent: true,
          holdUntil,
        },
        overrideAccess: true,
        req: txReq,
      })
      if (flaggedForName) await addRiskFlag(req.payload, ambassador.id, 'manual', 'name mismatch', txReq)

      const candidates = await req.payload.find({
        collection: 'ambassador-bank-accounts',
        where: { and: [{ ambassador: { not_equals: ambassador.id } }, { isCurrent: { equals: true } }, { accountLast4: { equals: accountLast4 } }] },
        limit: 100,
        depth: 0,
        overrideAccess: true,
        req: txReq,
      })
      const shared = candidates.docs.filter((candidate) => {
        const row = candidate as unknown as { accountNumber?: string }
        return row.accountNumber === body.accountNumber
      })
      const otherIds = [...new Set(shared.map((candidate) => relation((candidate as unknown as { ambassador: unknown }).ambassador)).filter((id): id is number => id !== null))]
      if (otherIds.length) {
        await addRiskFlag(req.payload, ambassador.id, 'shared_bank', 'Payout account is shared with another ambassador', txReq)
        for (const otherId of otherIds) await addRiskFlag(req.payload, otherId, 'shared_bank', 'Payout account is shared with another ambassador', txReq)
      }
      await writeAudit(req.payload, {
        actorId: user.id,
        action: 'bank_account_changed',
        targetCollection: 'ambassador-bank-accounts',
        targetId: account.id,
        before: previous ? { bankName: previous.bankName, accountLast4: previous.accountLast4 } : null,
        after: { bankName: bank.name, accountLast4, holdUntil },
        ip: req.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      }, txReq)
      return { id: Number(account.id), bankName: bank.name, accountName, accountLast4, holdUntil, changed: true }
    })
    if (result.changed) {
      try {
        await sendEmail(user.email, ambassadorBankChangedEmail(String(userDoc.firstName ?? '')))
      } catch {
        logger.error({ ambassadorId: ambassador.id, bankAccountId: result.id }, 'ambassador_bank_change_email_failed')
      }
    }
    return sendSuccess({ bankName: result.bankName, accountName: result.accountName, accountLast4: result.accountLast4, holdUntil: result.holdUntil })
  }),
}
