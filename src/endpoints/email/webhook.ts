import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { asyncHandler, jsonResponse } from '../../middleware/validate.js'
import { emailWebhookRateLimiter } from '../../lib/rate-limiter.js'
import { verifySvixSignature } from '../../lib/svix.js'
import { logger, logSecurityEvent } from '../../lib/logger.js'

/**
 * POST /api/email/webhook: Resend delivery events (signed with Svix).
 *
 * - email.bounced (permanent) and email.complained suppress the address on every user and
 *   lead that has it: no further email except a password reset the person asks for.
 * - email.clicked counts as engagement (lastEngagedAt) and is recorded on the message.
 * - email.opened is recorded on the message only: Apple Mail Privacy Protection opens
 *   emails automatically, so opens don't count as engagement.
 * Resend retries failed deliveries; every update here is safe to repeat.
 */
interface ResendEvent {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[] | string
    bounce?: { type?: string; subType?: string; message?: string }
  }
}

type Suppression = 'bounced' | 'complained'

function recipients(event: ResendEvent): string[] {
  const to = event.data?.to
  const list = Array.isArray(to) ? to : to ? [to] : []
  return list.map((address) => address.trim().toLowerCase()).filter((address) => address.includes('@'))
}

/** Resend marks soft bounces as "Transient"; only permanent (or unclassified) bounces suppress. */
function isHardBounce(event: ResendEvent): boolean {
  const type = event.data?.bounce?.type?.toLowerCase()
  return type !== 'transient' && type !== 'undetermined'
}

async function suppress(payload: Payload, email: string, reason: Suppression): Promise<number> {
  let updated = 0
  const users = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 5, depth: 0, overrideAccess: true })
  for (const user of users.docs) {
    await payload.update({ collection: 'users', id: user.id, data: { lifecycle: { emailSuppressed: reason } }, depth: 0, overrideAccess: true })
    updated++
  }
  const leads = await payload.find({ collection: 'leads', where: { email: { equals: email } }, limit: 5, depth: 0, overrideAccess: true })
  for (const lead of leads.docs) {
    await payload.update({ collection: 'leads', id: lead.id, data: { emailSuppressed: reason }, depth: 0, overrideAccess: true })
    updated++
  }
  return updated
}

async function markMessage(payload: Payload, providerId: string | undefined, field: 'openedAt' | 'clickedAt', at: string): Promise<string | null> {
  if (!providerId) return null
  const result = await payload.find({ collection: 'messages', where: { providerId: { equals: providerId } }, limit: 1, depth: 0, overrideAccess: true })
  const message = result.docs[0] as unknown as { id: number; personKey?: string; openedAt?: string | null; clickedAt?: string | null } | undefined
  if (!message) return null
  if (!message[field]) await payload.update({ collection: 'messages', id: message.id, data: { [field]: at }, depth: 0, overrideAccess: true })
  return message.personKey ?? null
}

async function markEngaged(payload: Payload, personKey: string | null, emails: string[], at: string): Promise<void> {
  const [type, rawId] = personKey?.split(':') ?? []
  const id = Number(rawId)
  if (type === 'user' && id) {
    await payload.update({ collection: 'users', id, data: { lifecycle: { lastEngagedAt: at } }, depth: 0, overrideAccess: true })
    return
  }
  if (type === 'lead' && id) {
    await payload.update({ collection: 'leads', id, data: { lastEngagedAt: at }, depth: 0, overrideAccess: true })
    return
  }
  // Not a logged lifecycle message (e.g. sent before the log existed): match by address.
  for (const email of emails) {
    const users = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, depth: 0, overrideAccess: true })
    for (const user of users.docs) await payload.update({ collection: 'users', id: user.id, data: { lifecycle: { lastEngagedAt: at } }, depth: 0, overrideAccess: true })
    const leads = await payload.find({ collection: 'leads', where: { email: { equals: email } }, limit: 1, depth: 0, overrideAccess: true })
    for (const lead of leads.docs) await payload.update({ collection: 'leads', id: lead.id, data: { lastEngagedAt: at }, depth: 0, overrideAccess: true })
  }
}

async function handle(req: PayloadRequest): Promise<Response> {
  await emailWebhookRateLimiter.check(req)
  const rawBody = typeof req.text === 'function' ? await req.text() : ''
  const valid = verifySvixSignature(
    rawBody,
    { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') },
    process.env.RESEND_WEBHOOK_SECRET,
  )
  if (!valid) {
    logSecurityEvent('webhook_signature_failure', { provider: 'resend' })
    return jsonResponse({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Invalid signature' } }, 401)
  }

  let event: ResendEvent
  try {
    event = JSON.parse(rawBody) as ResendEvent
  } catch {
    return jsonResponse({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400)
  }

  const at = event.created_at && !Number.isNaN(Date.parse(event.created_at)) ? new Date(event.created_at).toISOString() : new Date().toISOString()
  const emails = recipients(event)
  const providerId = event.data?.email_id

  switch (event.type) {
    case 'email.bounced': {
      if (!isHardBounce(event)) break
      let updated = 0
      for (const email of emails) updated += await suppress(req.payload, email, 'bounced')
      logger.warn({ providerId, records: updated, bounceType: event.data?.bounce?.type ?? 'unknown' }, 'email_hard_bounce_suppressed')
      break
    }
    case 'email.complained': {
      let updated = 0
      for (const email of emails) updated += await suppress(req.payload, email, 'complained')
      logger.warn({ providerId, records: updated }, 'email_complaint_suppressed')
      break
    }
    case 'email.clicked': {
      const personKey = await markMessage(req.payload, providerId, 'clickedAt', at)
      await markEngaged(req.payload, personKey, emails, at)
      break
    }
    case 'email.opened':
      await markMessage(req.payload, providerId, 'openedAt', at)
      break
    default:
      break
  }
  return jsonResponse({ success: true })
}

export const resendWebhookEndpoint: Endpoint = { path: '/email/webhook', method: 'post', handler: asyncHandler(handle) }
