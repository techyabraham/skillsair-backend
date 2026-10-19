import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { adminRateLimiter } from '../../lib/rate-limiter.js'
import { resolveAuthUser } from '../../middleware/authenticate.js'
import { appendLog, relationId, type LeadDoc } from '../../lib/leads.js'
import { verifyEmailToken } from '../../lib/email-tokens.js'
import { saveEmailPreferences } from '../../lib/email-preferences.js'
import { sendText } from '../../lib/whatsapp.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'

const WINDOW_MS = 24 * 60 * 60 * 1000

/** Admin actions run from the Payload admin (session cookie) or with a backend admin token. */
async function requireAdmin(req: PayloadRequest): Promise<{ id: number }> {
  const sessionUser = req.user as { id?: number | string; role?: string } | null | undefined
  if (sessionUser?.role === 'admin' && sessionUser.id !== undefined) return { id: Number(sessionUser.id) }
  const user = await resolveAuthUser(req)
  if (user?.role === 'admin') return { id: user.id }
  throw new AppError('INSUFFICIENT_PERMISSION', 'Only admins can do this')
}

async function loadLead(req: PayloadRequest): Promise<LeadDoc> {
  const id = getParam(req, 'id')
  if (!isValidPayloadId(id)) throw new AppError('VALIDATION_ERROR', 'Invalid lead id')
  const lead = await req.payload.findByID({ collection: 'leads', id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!lead) throw new AppError('NOT_FOUND', 'Lead not found')
  return lead as unknown as LeadDoc
}

const replySchema = z.object({ body: z.string().trim().min(1).max(4000) })

/** Option B for Imisi's queue: a free-form WhatsApp reply, only inside the 24-hour window. */
async function reply(req: PayloadRequest): Promise<Response> {
  const admin = await requireAdmin(req)
  await adminRateLimiter.check(req, admin.id)
  const lead = await loadLead(req)
  const { body } = parseBody(replySchema, await readJsonBody(req))
  if (lead.optedOutAt) throw new AppError('VALIDATION_ERROR', 'This person replied STOP. Do not message them unless they reply START.')
  const lastInbound = lead.lastInboundAt ? new Date(lead.lastInboundAt).getTime() : 0
  if (Date.now() - lastInbound > WINDOW_MS) {
    throw new AppError('VALIDATION_ERROR', "The 24-hour WhatsApp window is closed: they haven't messaged in the last 24 hours, so only an approved template can be sent.")
  }
  const result = await sendText(lead.phone, body)
  if (!result.sent) {
    throw new AppError('VALIDATION_ERROR', result.skipped === 'disabled' ? 'WhatsApp sending is switched off (WHATSAPP_ENABLED is not "true").' : result.error ?? 'WhatsApp did not accept the message')
  }
  await req.payload.update({
    collection: 'leads',
    id: lead.id,
    data: {
      whatsappLog: appendLog(lead, { direction: 'out', type: 'text_imisi', body: body.slice(0, 1000), at: new Date().toISOString() }),
      ...(lead.status === 'new' ? { status: 'contacted' } : {}),
    },
    depth: 0,
    overrideAccess: true,
  })
  return sendSuccess({ sent: true })
}

/** "Mark done": leaves Imisi's queue. */
async function done(req: PayloadRequest): Promise<Response> {
  await requireAdmin(req)
  const lead = await loadLead(req)
  await req.payload.update({
    collection: 'leads',
    id: lead.id,
    data: {
      needsHuman: false,
      ...(lead.status === 'new' || lead.status === 'offer_viewed' ? { status: 'contacted' } : {}),
    },
    depth: 0,
    overrideAccess: true,
  })
  return sendSuccess({ done: true })
}

const unsubscribeSchema = z.object({ token: z.string().min(3).max(400) })

/** Unsubscribe from all marketing (the website's /unsubscribe page). Accepts old lead links and new email links. */
async function unsubscribe(req: PayloadRequest): Promise<Response> {
  const { token } = parseBody(unsubscribeSchema, await readJsonBody(req))
  const claims = verifyEmailToken(token)
  if (!claims) throw new AppError('NOT_FOUND', 'This unsubscribe link is not valid')
  const preferences = await saveEmailPreferences(req.payload, claims, { unsubscribeAll: true }, 'email_unsubscribe')
  if (!preferences) throw new AppError('NOT_FOUND', 'This unsubscribe link is not valid')
  return sendSuccess({ unsubscribed: true })
}

export const leadWhatsAppReplyEndpoint: Endpoint = { path: '/:id/whatsapp-reply', method: 'post', handler: asyncHandler(reply) }
export const leadDoneEndpoint: Endpoint = { path: '/:id/done', method: 'post', handler: asyncHandler(done) }
export const leadUnsubscribeEndpoint: Endpoint = { path: '/unsubscribe', method: 'post', handler: asyncHandler(unsubscribe) }
