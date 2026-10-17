import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, jsonResponse, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { emailPrefsRateLimiter } from '../../lib/rate-limiter.js'
import { verifyEmailToken, type EmailTokenClaims } from '../../lib/email-tokens.js'
import { changeForCategory, loadEmailPreferences, saveEmailPreferences } from '../../lib/email-preferences.js'
import { logger } from '../../lib/logger.js'
import { AppError } from '../../types/index.js'

function tokenFromUrl(req: PayloadRequest): string {
  return new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? ''
}

function claimsOrThrow(token: string): EmailTokenClaims {
  const claims = verifyEmailToken(token)
  if (!claims) throw new AppError('NOT_FOUND', 'This link has expired or is not valid. Use the link in a more recent email, or reply to any of our emails.')
  return claims
}

/** GET /api/email/preferences?token=…: what the preference centre shows. */
async function getPreferences(req: PayloadRequest): Promise<Response> {
  const claims = claimsOrThrow(tokenFromUrl(req))
  await emailPrefsRateLimiter.check(req, `${claims.type}-${claims.id}`)
  const preferences = await loadEmailPreferences(req.payload, claims)
  if (!preferences) throw new AppError('NOT_FOUND', 'This link has expired or is not valid.')
  return sendSuccess(preferences)
}

const saveSchema = z.object({
  token: z.string().min(3).max(400),
  offers: z.boolean().optional(),
  learningReminders: z.boolean().optional(),
  unsubscribeAll: z.boolean().optional(),
})

/** POST /api/email/preferences: saves the switches (or "unsubscribe from all marketing"). */
async function savePreferences(req: PayloadRequest): Promise<Response> {
  const body = parseBody(saveSchema, await readJsonBody(req))
  const claims = claimsOrThrow(body.token)
  await emailPrefsRateLimiter.check(req, `${claims.type}-${claims.id}`)
  const preferences = await saveEmailPreferences(
    req.payload,
    claims,
    { offers: body.offers, learningReminders: body.learningReminders, unsubscribeAll: body.unsubscribeAll },
    'preference_centre',
  )
  if (!preferences) throw new AppError('NOT_FOUND', 'This link has expired or is not valid.')
  logger.info({ audience: claims.type, id: claims.id, offers: preferences.offers, learningReminders: preferences.learningReminders }, 'email_preferences_saved')
  return sendSuccess(preferences)
}

/**
 * POST /api/email/unsubscribe?token=…: RFC 8058 one-click unsubscribe, sent by Gmail, Yahoo
 * and others when someone taps their "Unsubscribe" link. No login, no page, effective at once.
 * Not rate-limited per IP, because mailbox providers send these from shared servers.
 */
async function oneClickUnsubscribe(req: PayloadRequest): Promise<Response> {
  const claims = verifyEmailToken(tokenFromUrl(req))
  if (!claims) return jsonResponse({ success: false, error: { code: 'NOT_FOUND', message: 'Invalid unsubscribe link' } }, 404)
  await saveEmailPreferences(req.payload, claims, changeForCategory(claims.category), 'one_click_unsubscribe')
  logger.info({ audience: claims.type, id: claims.id, category: claims.category }, 'email_one_click_unsubscribe')
  return sendSuccess({ unsubscribed: true, category: claims.category })
}

/** GET on the same URL (someone opened it in a browser): never unsubscribes; shows the preference centre. */
async function unsubscribeLanding(req: PayloadRequest): Promise<Response> {
  const frontend = (process.env.FRONTEND_URL ?? 'https://skillsair.com').replace(/\/+$/, '')
  const token = tokenFromUrl(req)
  return new Response(null, { status: 302, headers: { Location: `${frontend}/email-preferences?token=${encodeURIComponent(token)}` } })
}

export const getEmailPreferencesEndpoint: Endpoint = { path: '/email/preferences', method: 'get', handler: asyncHandler(getPreferences) }
export const saveEmailPreferencesEndpoint: Endpoint = { path: '/email/preferences', method: 'post', handler: asyncHandler(savePreferences) }
export const oneClickUnsubscribeEndpoint: Endpoint = { path: '/email/unsubscribe', method: 'post', handler: asyncHandler(oneClickUnsubscribe) }
export const unsubscribeLandingEndpoint: Endpoint = { path: '/email/unsubscribe', method: 'get', handler: asyncHandler(unsubscribeLanding) }
