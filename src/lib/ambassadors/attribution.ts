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
    { status: { equals: 'active' } }, /^\d+$/.test(ref) ? { legacyWpRef: { equals: ref } } : { code: { equals: ref.toUpperCase() } },
  ] }, limit: 1, depth: 0, overrideAccess: true })
  const ambassador = found.docs[0] as unknown as AmbassadorDoc | undefined
  return ambassador && (ambassador.source !== 'self' || ambassador.emailVerifiedAt) ? ambassador : null
}

/** Serialise attributions per user in PostgreSQL, including across instances and Redis TTL expiry. */
export async function attributeUser(payload: Payload, args: { userId: number; value?: string; source: 'cookie_register' | 'cookie_checkout' }): Promise<{ attributed: boolean; reason?: string }> {
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
    const db = payload.db as unknown as { drizzle: { execute(q: ReturnType<typeof sql>): Promise<unknown> }; sessions: Record<string, { db: { execute(q: ReturnType<typeof sql>): Promise<unknown> } }> }
    const transactionID = await req.transactionID
    if (transactionID == null) throw new Error('Attribution requires database transactions')
    const connection = db.sessions[String(transactionID)]!.db
    await connection.execute(sql`SELECT pg_advisory_xact_lock(72491, ${args.userId})`)
    const found = await payload.find({ collection: 'referral-attributions', where: { referredUser: { equals: args.userId } }, limit: 1, depth: 0, overrideAccess: true, req })
    const existing = found.docs[0]
    if (existing && (settings.attributionModel !== 'last_click' || !existing.lockedUntil || Date.parse(String(existing.lockedUntil)) > Date.now())) return { attributed: false, reason: 'already_attributed' }
    const data = { referredUser: args.userId, ambassador: ambassador.id, firstClickAt: value.clickedAt ?? new Date().toISOString(), attributedAt: new Date().toISOString(), source: args.source,
      lockedUntil: settings.attributionLifetimeDays === null ? null : new Date(Date.now() + settings.attributionLifetimeDays * 86400000).toISOString() }
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

export async function attributionSnapshot(payload: Payload, userId: number): Promise<{ ambassadorId?: number; attributionId?: number }> {
  const found = await payload.find({ collection: 'referral-attributions', where: { referredUser: { equals: userId } }, limit: 1, depth: 0, overrideAccess: true })
  const row = found.docs[0]
  if (!row) return {}
  const id = relationId(row.ambassador)
  return id === undefined ? {} : { ambassadorId: Number(id), attributionId: Number(row.id) }
}
