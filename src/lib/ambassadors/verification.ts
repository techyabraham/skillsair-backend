import { randomInt } from 'node:crypto'
import type { Payload } from 'payload'
import { AppError } from '../../types/index.js'
import { logger } from '../logger.js'
import { sendEmail } from '../resend.js'
import { redis } from '../redis.js'
import { generateSecureToken, hashToken } from '../../utils/generate-code.js'
import { withTransaction } from './ledger.js'
import { getAmbassadorSettings } from './settings.js'
import { ambassadorApplicationReceivedEmail, ambassadorVerificationEmail } from './emails.js'
import type { AmbassadorDoc } from './types.js'

const OTP_TTL_SECONDS = 30 * 60
const RESEND_COOLDOWN_SECONDS = 60
const PORTAL_URL = (process.env.AMBASSADOR_PORTAL_URL ?? 'https://ambassador.skillsair.com').replace(/\/$/, '')
const ADMIN_EMAIL = process.env.AMBASSADOR_ADMIN_EMAIL

interface VerificationRecord {
  otpHash: string
  tokenHash: string
  attempts: number
}

interface UserSummary {
  id: number
  email: string
  firstName?: string | null
  lastName?: string | null
  isVerified?: boolean | null
}

function idOf(value: number | { id: number }): number {
  return typeof value === 'number' ? value : value.id
}

function otpKey(ambassadorId: number): string {
  return `amb:otp:${ambassadorId}`
}

function tokenKey(tokenHash: string): string {
  return `amb:vtok:${tokenHash}`
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}•••@${domain}`
}

/** Stores only hashes and emails the one-time code plus its single-use verification link. */
export async function issueVerification(payload: Payload, ambassador: AmbassadorDoc): Promise<{ email: string; firstName: string; resendAfterSeconds: number }> {
  const user = await payload.findByID({ collection: 'users', id: idOf(ambassador.user), depth: 0, overrideAccess: true }) as unknown as UserSummary
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const token = generateSecureToken()
  const otpHash = hashToken(otp)
  const linkHash = hashToken(token)
  const key = otpKey(ambassador.id)
  const oldValue = await redis.get(key)
  if (oldValue) {
    try {
      const old = JSON.parse(oldValue) as VerificationRecord
      await redis.del(tokenKey(old.tokenHash))
    } catch {
      // Replace malformed or expired state with a fresh verification record.
    }
  }
  await redis.set(key, JSON.stringify({ otpHash, tokenHash: linkHash, attempts: 0 } satisfies VerificationRecord), 'EX', OTP_TTL_SECONDS)
  await redis.set(tokenKey(linkHash), String(ambassador.id), 'EX', OTP_TTL_SECONDS)

  const link = `${PORTAL_URL}/verify?token=${encodeURIComponent(token)}`
  try {
    await sendEmail(user.email, ambassadorVerificationEmail(user.firstName ?? '', otp, link))
  } catch {
    logger.error({ ambassadorId: ambassador.id }, 'ambassador_verification_email_failed')
  }
  return { email: user.email, firstName: user.firstName ?? '', resendAfterSeconds: RESEND_COOLDOWN_SECONDS }
}

/** Emits the internal review notification after a self-applicant has verified their address. */
export async function notifyAdminOfApplication(payload: Payload, ambassador: AmbassadorDoc): Promise<void> {
  if (!ADMIN_EMAIL) {
    logger.warn({ ambassadorId: ambassador.id }, 'ambassador_admin_email_not_configured')
    return
  }
  const user = await payload.findByID({ collection: 'users', id: idOf(ambassador.user), depth: 0, overrideAccess: true }) as unknown as UserSummary
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  try {
    await sendEmail(ADMIN_EMAIL, ambassadorApplicationReceivedEmail(name, user.email, ambassador.username))
  } catch {
    logger.error({ ambassadorId: ambassador.id }, 'ambassador_application_notification_failed')
  }
}

const consumeOtpScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local row = cjson.decode(raw)
if row.otpHash == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  return 1
end
row.attempts = (tonumber(row.attempts) or 0) + 1
if row.attempts >= 5 then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  return -1
end
local ttl = redis.call('TTL', KEYS[1])
if ttl > 0 then redis.call('SET', KEYS[1], cjson.encode(row), 'EX', ttl) end
return 2
`

const consumeTokenScript = `
local ambassadorId = redis.call('GET', KEYS[1])
if not ambassadorId or ambassadorId ~= ARGV[1] then return 0 end
local raw = redis.call('GET', KEYS[2])
if not raw then return 0 end
local row = cjson.decode(raw)
if row.tokenHash ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
return 1
`

export async function findAmbassadorByEmail(payload: Payload, email: string): Promise<{ ambassador: AmbassadorDoc; user: UserSummary } | null> {
  const userResult = await payload.find({
    collection: 'users',
    where: { email: { equals: email.trim().toLowerCase() } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const user = userResult.docs[0] as unknown as UserSummary | undefined
  if (!user) return null
  const ambassadorResult = await payload.find({
    collection: 'ambassadors',
    where: { user: { equals: user.id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const ambassador = ambassadorResult.docs[0] as unknown as AmbassadorDoc | undefined
  return ambassador ? { ambassador, user } : null
}

export async function findAmbassadorById(payload: Payload, ambassadorId: number): Promise<{ ambassador: AmbassadorDoc; user: UserSummary } | null> {
  const ambassador = await payload.findByID({ collection: 'ambassadors', id: ambassadorId, depth: 0, overrideAccess: true }).catch(() => null) as unknown as AmbassadorDoc | null
  if (!ambassador) return null
  const user = await payload.findByID({ collection: 'users', id: idOf(ambassador.user), depth: 0, overrideAccess: true }).catch(() => null) as unknown as UserSummary | null
  return user ? { ambassador, user } : null
}

export async function verifyAmbassadorEmail(payload: Payload, args: { email?: string; code?: string; token?: string }): Promise<'active' | 'pending' | 'blocked'> {
  let record: { ambassador: AmbassadorDoc; user: UserSummary } | null
  let consumed = 0
  if (args.token) {
    const tokenHash = hashToken(args.token)
    const attemptKey = `amb:vtok-attempts:${tokenHash}`
    const attempts = await redis.incr(attemptKey)
    if (attempts === 1) await redis.expire(attemptKey, OTP_TTL_SECONDS)
    if (attempts > 5) throw new AppError('RATE_LIMITED', 'Too many verification attempts. Request a new email and try again.')
    const idValue = await redis.get(tokenKey(tokenHash))
    if (!idValue || !/^\d+$/.test(idValue)) throw new AppError('VALIDATION_ERROR', 'This verification link is invalid or has expired.')
    const ambassadorId = Number(idValue)
    record = await findAmbassadorById(payload, ambassadorId)
    if (!record) throw new AppError('VALIDATION_ERROR', 'This verification link is invalid or has expired.')
    consumed = Number(await redis.eval(consumeTokenScript, 2, tokenKey(tokenHash), otpKey(ambassadorId), String(ambassadorId), tokenHash))
    if (consumed === 1) await redis.del(attemptKey)
  } else {
    record = args.email ? await findAmbassadorByEmail(payload, args.email) : null
    if (!record || !args.code) throw new AppError('VALIDATION_ERROR', 'The verification code is invalid or has expired.')
    const key = otpKey(record.ambassador.id)
    const stored = await redis.get(key)
    if (!stored) throw new AppError('VALIDATION_ERROR', 'The verification code is invalid or has expired.')
    let data: VerificationRecord
    try { data = JSON.parse(stored) as VerificationRecord } catch { throw new AppError('VALIDATION_ERROR', 'The verification code is invalid or has expired.') }
    consumed = Number(await redis.eval(consumeOtpScript, 2, key, tokenKey(data.tokenHash), hashToken(args.code)))
  }
  if (consumed !== 1) throw new AppError('VALIDATION_ERROR', 'The verification code is invalid or has expired.')

  const settings = await getAmbassadorSettings(payload)
  const now = new Date().toISOString()
  const updated = await withTransaction(payload, async (req) => {
    const current = await payload.findByID({ collection: 'ambassadors', id: record!.ambassador.id, depth: 0, overrideAccess: true, req }) as unknown as AmbassadorDoc
    const status = current.status === 'blocked'
      ? 'blocked'
      : current.status === 'pending' && settings.defaultApplicationStatus === 'active' ? 'active' : current.status
    const ambassador = await payload.update({
      collection: 'ambassadors',
      id: current.id,
      data: { emailVerifiedAt: current.emailVerifiedAt ?? now, ...(status === 'active' && current.status !== 'active' ? { status, approvedAt: now } : {}) },
      overrideAccess: true,
      req,
    }) as unknown as AmbassadorDoc
    await payload.update({ collection: 'users', id: record!.user.id, data: { isVerified: true }, overrideAccess: true, req })
    return ambassador
  })

  if (updated.status === 'pending') await notifyAdminOfApplication(payload, updated)
  logger.info({ ambassadorId: updated.id, status: updated.status }, 'ambassador_email_verified')
  return updated.status
}

export async function resendAmbassadorVerification(payload: Payload, email: string): Promise<void> {
  const record = await findAmbassadorByEmail(payload, email)
  if (!record || record.ambassador.emailVerifiedAt) return
  const cooldownKey = `amb:resend:${record.ambassador.id}`
  const accepted = await redis.set(cooldownKey, '1', 'EX', RESEND_COOLDOWN_SECONDS, 'NX')
  if (accepted !== 'OK') return
  await issueVerification(payload, record.ambassador)
}
