import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { adminRateLimiter } from '../../lib/rate-limiter.js'
import { resolveAuthUser } from '../../middleware/authenticate.js'
import { relationId, type LeadDoc } from '../../lib/leads.js'
import { isDeliverableEmail } from '../../lib/lead-messaging.js'
import { sendEmail } from '../../lib/resend.js'
import { bodyParams, sendTemplate, urlButton } from '../../lib/whatsapp.js'
import { listUnsubscribeHeaders, preferencesUrl } from '../../lib/email-tokens.js'
import { publishedProgrammes } from '../../lib/career-quiz.js'
import { careerStatus, careers, isCareerId } from '../../content/career-quiz.js'
import { waitlistOpen } from '../../emails/waitlist-open.js'
import { logger } from '../../lib/logger.js'
import { AppError } from '../../types/index.js'

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'
/** WhatsApp marketing template; must be approved in Meta before WhatsApp notices go out. */
export const WAITLIST_TEMPLATE = 'skillsair_programme_open'

async function requireAdmin(req: PayloadRequest): Promise<number> {
  const sessionUser = req.user as { id?: number | string; role?: string } | null | undefined
  if (sessionUser?.role === 'admin' && sessionUser.id !== undefined) return Number(sessionUser.id)
  const user = await resolveAuthUser(req)
  if (user?.role === 'admin') return user.id
  throw new AppError('INSUFFICIENT_PERMISSION', 'Only admins can do this')
}

const schema = z.object({ career: z.string().max(40) })

/**
 * POST /api/career-waitlist/notify { career }: sends the launch message to everyone waiting for
 * this career who has marketing consent and hasn't been notified, then stamps notifiedAt. Only
 * when the career's programme is published. Never runs on its own.
 */
async function handler(req: PayloadRequest): Promise<Response> {
  const adminId = await requireAdmin(req)
  await adminRateLimiter.check(req, adminId)
  const { career } = parseBody(schema, await readJsonBody(req))
  if (!isCareerId(career)) throw new AppError('VALIDATION_ERROR', 'Unknown career')
  const programmes = await publishedProgrammes(req.payload)
  if (careerStatus(career, new Set(programmes.keys())) !== 'open') {
    throw new AppError('VALIDATION_ERROR', `${careers[career].name} has no published programme yet. Set its programmeSlug in the quiz and publish the course first.`)
  }
  const slug = careers[career].programmeSlug!
  const applyUrl = `${FRONTEND_URL}/apply?programme=${encodeURIComponent(slug)}&from=waitlist`

  const pending = await req.payload.find({
    collection: 'career-waitlist' as never,
    where: { and: [{ career: { equals: career } }, { notifiedAt: { exists: false } }] },
    limit: 1000,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const summary = { notified: 0, skippedNoConsent: 0, failed: 0, whatsappSent: 0, emailSent: 0 }
  for (const row of pending.docs as unknown as Array<{ id: number; lead: number | { id: number } }>) {
    const leadId = relationId(row.lead)
    const lead = leadId
      ? ((await req.payload.findByID({ collection: 'leads', id: leadId, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as (LeadDoc & { emailSuppressed?: string | null }) | null)
      : null
    if (!lead || !lead.marketingConsent || lead.optedOutAt) {
      summary.skippedNoConsent += 1
      continue
    }
    let sent = false
    if (isDeliverableEmail(lead.email) && !lead.emailSuppressed) {
      try {
        const audience = { type: 'lead' as const, id: lead.id }
        const key = `waitlist:${career}:${lead.id}`
        const content = waitlistOpen.render({ firstName: lead.firstName, career: careers[career].name, applyUrl }, { preferencesUrl: preferencesUrl(audience, key), unsubscribeUrl: preferencesUrl(audience, key) })
        await sendEmail(lead.email, content, { stream: 'marketing', headers: listUnsubscribeHeaders(audience, 'offers', key), tags: { track: 'W', step: 'career-waitlist' } })
        summary.emailSent += 1
        sent = true
      } catch (err) {
        logger.error({ err, leadId: lead.id }, 'waitlist_email_failed')
      }
    }
    const whatsapp = await sendTemplate(lead.phone, WAITLIST_TEMPLATE, 'en', [bodyParams(lead.firstName, careers[career].name), urlButton(0, slug)]).catch(() => ({ sent: false }))
    if (whatsapp.sent) {
      summary.whatsappSent += 1
      sent = true
    }
    if (sent) {
      await req.payload.update({ collection: 'career-waitlist' as never, id: row.id, data: { notifiedAt: new Date().toISOString() } as never, depth: 0, overrideAccess: true })
      summary.notified += 1
    } else summary.failed += 1
  }
  return sendSuccess(summary)
}

export const notifyWaitlistEndpoint: Endpoint = { path: '/notify', method: 'post', handler: asyncHandler(handler) }
