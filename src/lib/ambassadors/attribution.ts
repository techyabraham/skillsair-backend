import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { getAmbassadorSettings } from './settings.js'
import { withTransaction } from './ledger.js'
import { readAttribution } from './attribution-token.js'
import { logger } from '../logger.js'
import { relationId } from '../course-access.js'
import type { AmbassadorDoc } from './types.js'

export async function resolveReferral(payload: Payload, ref: string): Promise<AmbassadorDoc | null> {
  if (!/^[A-Za-z0-9]{1,16}$/.test(ref)) return null
  const found = await payload.find({ collection: 'ambassadors', where: { and: [
    { status: { equals: 'active' } }, { code: { equals: ref.toUpperCase() } },
  ] }, limit: 1, depth: 0, overrideAccess: true })
  const ambassador = found.docs[0] as unknown as AmbassadorDoc | undefined
  return ambassador && (ambassador.source !== 'self' || ambassador.emailVerifiedAt) ? ambassador : null
}

type Executor = { execute(q: ReturnType<typeof sql>): Promise<{ rows?: Array<Record<string, unknown>> }> }

async function transactionConnection(payload: Payload, transactionID: unknown): Promise<Executor> {
  const db = payload.db as unknown as { sessions: Record<string, { db: Executor }> }
  const id = await transactionID
  if (id == null) throw new Error('Attribution requires database transactions')
  return db.sessions[String(id)]!.db
}

const lifetimeEnd = (days: number | null) => (days === null ? null : new Date(Date.now() + days * 86400000).toISOString())

/** Serialise attributions per user in PostgreSQL, including across instances and Redis TTL expiry. */
export async function attributeUser(payload: Payload, args: { userId: number; value?: string; source: 'cookie_apply' | 'cookie_register' | 'cookie_checkout' }): Promise<{ attributed: boolean; reason?: string }> {
  const value = readAttribution(args.value)
  if (!value) return { attributed: false, reason: 'no_attribution' }
  const ambassador = await resolveReferral(payload, value.code)
  if (!ambassador || (value.signed && ambassador.id !== value.ambassadorId)) return { attributed: false, reason: 'inactive_or_missing' }
  if (Number(relationId(ambassador.user)) === args.userId) {
    logger.info({ userId: args.userId, ambassadorId: ambassador.id }, 'ambassador_self_referral_blocked')
    return { attributed: false, reason: 'self_referral' }
  }
  const settings = await getAmbassadorSettings(payload)
  return withTransaction(payload, async (req) => {
    const connection = await transactionConnection(payload, req.transactionID)
    await connection.execute(sql`SELECT pg_advisory_xact_lock(72491, ${args.userId})`)
    const found = await payload.find({ collection: 'referral-attributions', where: { referredUser: { equals: args.userId } }, limit: 1, depth: 0, overrideAccess: true, req })
    const existing = found.docs[0]
    if (existing && (settings.attributionModel !== 'last_click' || !existing.lockedUntil || Date.parse(String(existing.lockedUntil)) > Date.now())) return { attributed: false, reason: 'already_attributed' }
    const data = { referredUser: args.userId, ambassador: ambassador.id, firstClickAt: value.clickedAt ?? new Date().toISOString(), attributedAt: new Date().toISOString(), source: args.source,
      lockedUntil: lifetimeEnd(settings.attributionLifetimeDays) }
    if (existing) await payload.update({ collection: 'referral-attributions', id: existing.id, data, overrideAccess: true, req })
    else await payload.create({ collection: 'referral-attributions', data, overrideAccess: true, req })
    const [buyer, owner] = await Promise.all([
      payload.findByID({ collection: 'users', id: args.userId, depth: 0, overrideAccess: true, req }),
      payload.findByID({ collection: 'users', id: Number(relationId(ambassador.user)), depth: 0, overrideAccess: true, req }),
    ])
    if (buyer.phone && owner.phone && String(buyer.phone).replace(/\D/g, '') === String(owner.phone).replace(/\D/g, '')) {
      // Lock the ambassador row before reading its flags, so concurrent referrals cannot lose flags.
      await connection.execute(sql`SELECT id FROM ambassadors WHERE id = ${ambassador.id} FOR UPDATE`)
      const fresh = await payload.findByID({ collection: 'ambassadors', id: ambassador.id, depth: 0, overrideAccess: true, req }) as unknown as AmbassadorDoc
      if (!(fresh.riskFlags ?? []).some(f => f.kind === 'self_referral_suspected' && !f.resolvedAt)) await payload.update({ collection: 'ambassadors', id: ambassador.id, data: { riskFlags: [...(fresh.riskFlags ?? []), { kind: 'self_referral_suspected', note: 'Referred user shares the ambassador phone number', openedAt: new Date().toISOString() }] }, overrideAccess: true, req })
    }
    return { attributed: true }
  })
}

/**
 * Someone applied (a lead) through a referral link. If they already have an account, this is an
 * ordinary user attribution. Otherwise the application itself is attributed, and the row moves onto
 * their account when they sign up (claimLeadAttribution). Same first/last-click rules as users.
 */
export async function attributeLead(payload: Payload, args: { leadId: number; value?: string }): Promise<{ attributed: boolean; reason?: string }> {
  const value = readAttribution(args.value)
  if (!value) return { attributed: false, reason: 'no_attribution' }
  const ambassador = await resolveReferral(payload, value.code)
  if (!ambassador || (value.signed && ambassador.id !== value.ambassadorId)) return { attributed: false, reason: 'inactive_or_missing' }
  const lead = await payload.findByID({ collection: 'leads', id: args.leadId, depth: 0, overrideAccess: true }) as unknown as { id: number; email: string; user?: unknown }
  const ownerId = Number(relationId(ambassador.user))
  const owner = await payload.findByID({ collection: 'users', id: ownerId, depth: 0, overrideAccess: true }) as unknown as { email: string }
  const leadUserId = relationId(lead.user)
  if (Number(leadUserId) === ownerId || lead.email.toLowerCase() === owner.email.toLowerCase()) {
    logger.info({ leadId: lead.id, ambassadorId: ambassador.id }, 'ambassador_self_referral_blocked')
    return { attributed: false, reason: 'self_referral' }
  }
  const account = leadUserId !== undefined
    ? Number(leadUserId)
    : Number((await payload.find({ collection: 'users', where: { email: { equals: lead.email.toLowerCase() } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]?.id ?? 0)
  if (account) return attributeUser(payload, { userId: account, value: args.value, source: 'cookie_apply' })

  const settings = await getAmbassadorSettings(payload)
  return withTransaction(payload, async (req) => {
    const connection = await transactionConnection(payload, req.transactionID)
    await connection.execute(sql`SELECT pg_advisory_xact_lock(72492, ${lead.id})`)
    const found = await payload.find({ collection: 'referral-attributions', where: { lead: { equals: lead.id } }, limit: 1, depth: 0, overrideAccess: true, req })
    const existing = found.docs[0]
    if (existing && (settings.attributionModel !== 'last_click' || !existing.lockedUntil || Date.parse(String(existing.lockedUntil)) > Date.now())) return { attributed: false, reason: 'already_attributed' }
    const data = {
      lead: lead.id, ambassador: ambassador.id, firstClickAt: value.clickedAt ?? new Date().toISOString(), attributedAt: new Date().toISOString(),
      source: 'cookie_apply' as const, lockedUntil: lifetimeEnd(settings.attributionLifetimeDays),
    }
    if (existing) await payload.update({ collection: 'referral-attributions', id: existing.id, data, overrideAccess: true, req })
    else await payload.create({ collection: 'referral-attributions', data, overrideAccess: true, req })
    return { attributed: true }
  })
}

/**
 * Moves an application's attribution onto the account of the person who applied (matched by the
 * lead's user or its email), unless the account is already attributed (first touch wins) or is the
 * ambassador's own. Safe to call any number of times.
 */
export async function claimLeadAttribution(payload: Payload, userId: number): Promise<boolean> {
  const user = await payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true }).catch(() => null) as unknown as { email?: string } | null
  const email = user?.email?.toLowerCase()
  if (!email) return false
  return withTransaction(payload, async (req) => {
    const connection = await transactionConnection(payload, req.transactionID)
    await connection.execute(sql`SELECT pg_advisory_xact_lock(72491, ${userId})`)
    const owned = await payload.count({ collection: 'referral-attributions', where: { referredUser: { equals: userId } }, overrideAccess: true, req })
    if (owned.totalDocs) return false
    const result = await connection.execute(sql`
      SELECT ra."id", a."user_id" AS "ambassador_user_id"
      FROM "referral_attributions" ra
      JOIN "leads" l ON l."id" = ra."lead_id"
      JOIN "ambassadors" a ON a."id" = ra."ambassador_id"
      WHERE ra."referred_user_id" IS NULL AND (l."user_id" = ${userId} OR lower(l."email") = ${email})
      ORDER BY ra."attributed_at", ra."id"
      LIMIT 1`)
    const row = result.rows?.[0]
    if (!row || Number(row.ambassador_user_id) === userId) return false
    await payload.update({ collection: 'referral-attributions', id: Number(row.id), data: { referredUser: userId }, overrideAccess: true, req })
    return true
  })
}

export async function attributionSnapshot(payload: Payload, userId: number): Promise<{ ambassadorId?: number; attributionId?: number }> {
  let found = await payload.find({ collection: 'referral-attributions', where: { referredUser: { equals: userId } }, limit: 1, depth: 0, overrideAccess: true })
  // Applied through a link before signing up: the application's attribution comes to the account now.
  if (!found.docs[0] && await claimLeadAttribution(payload, userId)) {
    found = await payload.find({ collection: 'referral-attributions', where: { referredUser: { equals: userId } }, limit: 1, depth: 0, overrideAccess: true })
  }
  const row = found.docs[0]
  if (!row) return {}
  const id = relationId(row.ambassador)
  return id === undefined ? {} : { ambassadorId: Number(id), attributionId: Number(row.id) }
}
