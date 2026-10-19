import crypto from 'node:crypto'
import { verifyUnsubscribeToken } from './leads.js'

/**
 * Signed links in emails: the preference centre and one-click unsubscribe. They work for
 * account holders (users) and for applicants without an account (leads), need no login,
 * and expire. Older lead unsubscribe links ("<leadId>.<signature>") stay valid.
 */
export type EmailAudienceType = 'user' | 'lead'
export interface EmailAudience {
  type: EmailAudienceType
  id: number
}

/** What a one-click unsubscribe turns off: offers (marketing), learning reminders (service) or both. */
export type EmailCategory = 'offers' | 'learning' | 'all'
export type EmailTokenPurpose = 'prefs' | 'unsub'

export interface EmailTokenClaims extends EmailAudience {
  purpose: EmailTokenPurpose
  category: EmailCategory
  /** The message (idempotency key) the link was in, if any. */
  message?: string
}

const DEFAULT_TTL_DAYS = 365

function secret(): string {
  const value = process.env.JWT_SECRET
  if (!value || value.length < 32) throw new Error('JWT_SECRET must be set and at least 32 characters long')
  return value
}

function sign(body: string): string {
  return crypto.createHmac('sha256', secret()).update(`email-token:${body}`).digest('base64url').slice(0, 43)
}

export function createEmailToken(
  audience: EmailAudience,
  purpose: EmailTokenPurpose,
  category: EmailCategory = 'all',
  ttlDays = DEFAULT_TTL_DAYS,
  now = Date.now(),
  message?: string,
): string {
  const body = Buffer.from(
    JSON.stringify({ t: audience.type === 'user' ? 'u' : 'l', i: audience.id, p: purpose, c: category, e: Math.floor(now / 1000) + ttlDays * 86400, ...(message ? { m: message.slice(0, 120) } : {}) }),
  ).toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifyEmailToken(token: string, now = Date.now()): EmailTokenClaims | null {
  if (typeof token !== 'string' || token.length < 3 || token.length > 400) return null
  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  // Older lead unsubscribe links: "<leadId>.<signature>".
  if (/^\d+$/.test(body)) {
    const leadId = verifyUnsubscribeToken(token)
    return leadId ? { type: 'lead', id: leadId, purpose: 'unsub', category: 'offers' } : null
  }

  const expected = sign(body)
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null
  let claims: { t?: unknown; i?: unknown; p?: unknown; c?: unknown; e?: unknown; m?: unknown }
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as typeof claims
  } catch {
    return null
  }
  const id = Number(claims.i)
  if (!Number.isInteger(id) || id <= 0) return null
  if (typeof claims.e !== 'number' || claims.e * 1000 < now) return null
  if (claims.t !== 'u' && claims.t !== 'l') return null
  if (claims.p !== 'prefs' && claims.p !== 'unsub') return null
  if (claims.c !== 'offers' && claims.c !== 'learning' && claims.c !== 'all') return null
  return { type: claims.t === 'u' ? 'user' : 'lead', id, purpose: claims.p, category: claims.c, ...(typeof claims.m === 'string' ? { message: claims.m } : {}) }
}

function backendOrigin(): string {
  return (process.env.BACKEND_URL ?? 'https://kiwi.skillsair.com').replace(/\/+$/, '')
}

function frontendOrigin(): string {
  return (process.env.FRONTEND_URL ?? 'https://skillsair.com').replace(/\/+$/, '')
}

/** The visible "Email preferences" footer link (website page, no login). */
export function preferencesUrl(audience: EmailAudience, message?: string): string {
  return `${frontendOrigin()}/email-preferences?token=${encodeURIComponent(createEmailToken(audience, 'prefs', 'all', DEFAULT_TTL_DAYS, Date.now(), message))}`
}

/** One-click unsubscribe URL (RFC 8058), handled by the backend directly. */
export function oneClickUnsubscribeUrl(audience: EmailAudience, category: EmailCategory, message?: string): string {
  return `${backendOrigin()}/api/email/unsubscribe?token=${encodeURIComponent(createEmailToken(audience, 'unsub', category, DEFAULT_TTL_DAYS, Date.now(), message))}`
}

/**
 * Headers for every marketing and service email, so Gmail and Yahoo show their own
 * "Unsubscribe" link. The mailto: form is only added when that inbox is actually processed.
 */
export function listUnsubscribeHeaders(audience: EmailAudience, category: Exclude<EmailCategory, 'all'>, message?: string): Record<string, string> {
  const targets = [`<${oneClickUnsubscribeUrl(audience, category, message)}>`]
  const mailto = process.env.EMAIL_UNSUBSCRIBE_MAILTO?.trim()
  if (mailto) targets.push(`<mailto:${mailto}?subject=unsubscribe>`)
  return { 'List-Unsubscribe': targets.join(', '), 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
}
