import type { Payload } from 'payload'
import { logger } from './logger.js'
import { appendLog, formatLagosDate, hasFollowUp, relationId, type LeadDoc } from './leads.js'
import { buildOffer, type OfferCourseDoc } from './offers.js'
import { bodyParams, quickReplyButton, sendTemplate, urlButton, type WhatsAppSendResult } from './whatsapp.js'
import { sendEmail } from './resend.js'
import { A0 } from '../emails/lifecycle/track-a.js'
import { variantFor, variantLabel } from './lifecycle/templates.js'
import { QUICK_REPLY_PAYLOADS } from '../content/whatsapp-replies.js'
import { buildMessageData, loadPerson, loadWindow } from './lifecycle/context.js'
import { recordMessage } from './lifecycle/send.js'
import { idempotencyKey } from './lifecycle/plan.js'
import { windowCycle } from './lifecycle/stage.js'

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

export function resumeUrl(lead: Pick<LeadDoc, 'resumeCode'>): string {
  return `${FRONTEND_URL}/r/${lead.resumeCode}`
}

/** Placeholder addresses created for unknown WhatsApp senders must never receive email. */
export function isDeliverableEmail(email: string): boolean {
  return !email.endsWith('.invalid')
}

/**
 * Sends the instant "offer ready" WhatsApp template (utility) and offer email A.
 * Runs after the lead is committed, so a messaging failure can never block lead capture.
 */
export async function sendOfferMessages(payload: Payload, leadId: number): Promise<void> {
  const lead = (await payload.findByID({ collection: 'leads', id: leadId, depth: 0, overrideAccess: true })) as unknown as LeadDoc
  const courseId = relationId(lead.course)
  if (!courseId) return
  const course = (await payload
    .findByID({ collection: 'courses', id: courseId, depth: 1, overrideAccess: true })
    .catch(() => null)) as unknown as OfferCourseDoc | null
  if (!course) return

  const offer = await buildOffer(payload, course)
  const closesOn = formatLagosDate(offer.closesAt)
  const now = new Date().toISOString()
  const followUps = [...(lead.followUpsSent ?? [])]
  let log = lead.whatsappLog ?? []

  if (lead.source === 'curriculum_request') {
    // "Want this curriculum on WhatsApp?" from a programme page: utility template linking to the curriculum.
    if (!hasFollowUp(lead, 'wa_curriculum')) {
      const result: WhatsAppSendResult = await sendTemplate(lead.phone, 'skillsair_curriculum', 'en', [
        bodyParams(lead.firstName, offer.programme),
        urlButton(0, offer.slug),
        quickReplyButton(1, QUICK_REPLY_PAYLOADS.howItWorks),
        quickReplyButton(2, QUICK_REPLY_PAYLOADS.talk),
      ]).catch((err: unknown) => {
        logger.error({ err, leadId }, 'lead_curriculum_whatsapp_failed')
        return { sent: false, error: 'exception' } as WhatsAppSendResult
      })
      if (result.sent) {
        followUps.push({ key: 'wa_curriculum', sentAt: now })
        log = appendLog({ whatsappLog: log }, { direction: 'out', type: 'template', template: 'skillsair_curriculum', body: result.messageId ?? '', at: now })
      } else if (!result.skipped) {
        log = appendLog({ whatsappLog: log }, { direction: 'out', type: 'error', template: 'skillsair_curriculum', body: result.error ?? 'failed', at: now })
      }
    }
  } else if (!hasFollowUp(lead, 'wa_offer_ready')) {
    // Template variables cannot be empty; with no open window the date reads as "the next window".
    const result: WhatsAppSendResult = await sendTemplate(lead.phone, 'skillsair_offer_ready', 'en', [
      bodyParams(lead.firstName, offer.programme, closesOn || 'the next scholarship window'),
      urlButton(0, lead.resumeCode),
      quickReplyButton(1, QUICK_REPLY_PAYLOADS.howItWorks),
      quickReplyButton(2, QUICK_REPLY_PAYLOADS.requirements),
      quickReplyButton(3, QUICK_REPLY_PAYLOADS.talk),
    ]).catch((err: unknown) => {
      logger.error({ err, leadId }, 'lead_offer_whatsapp_failed')
      return { sent: false, error: 'exception' } as WhatsAppSendResult
    })
    if (result.sent) {
      followUps.push({ key: 'wa_offer_ready', sentAt: now })
      log = appendLog({ whatsappLog: log }, { direction: 'out', type: 'template', template: 'skillsair_offer_ready', body: result.messageId ?? '', at: now })
    } else if (!result.skipped) {
      log = appendLog({ whatsappLog: log }, { direction: 'out', type: 'error', template: 'skillsair_offer_ready', body: result.error ?? 'failed', at: now })
    }
  }

  let a0Variant: string | null = null
  if (!hasFollowUp(lead, 'email_offer') && isDeliverableEmail(lead.email) && !(lead as unknown as { emailSuppressed?: string | null }).emailSuppressed) {
    try {
      // A0: the offer they asked for (transactional), with the same data as every lifecycle email.
      const person = await loadPerson(payload, { type: 'lead', id: lead.id })
      if (!person) throw new Error('lead not found')
      const window = await loadWindow(payload)
      const data = await buildMessageData(payload, person, { track: 'A', subjectId: `lead:${lead.id}`, enteredAt: Date.now(), cycle: 0, courseId: Number(courseId) }, window)
      const variant = variantFor('A0', person.snapshot.key)
      a0Variant = variantLabel(variant)
      await sendEmail(lead.email, A0.render(data, {}, variant), { tags: { track: 'A', step: 'A0' } })
      followUps.push({ key: 'email_offer', sentAt: now })
    } catch (err) {
      logger.error({ err, leadId }, 'lead_offer_email_failed')
    }
  }

  await payload.update({
    collection: 'leads',
    id: lead.id,
    data: { followUpsSent: followUps, whatsappLog: log },
    depth: 0,
    overrideAccess: true,
  })

  // The same sends in the lifecycle messages log (Track A, step A0).
  const added = followUps.slice((lead.followUpsSent ?? []).length)
  if (added.length) {
    const person = await loadPerson(payload, { type: 'lead', id: lead.id })
    const cycle = windowCycle(offer.closesAt ? Date.parse(offer.closesAt) : null)
    for (const item of added) {
      const email = item.key === 'email_offer'
      const stepId = email ? 'A0' : item.key === 'wa_curriculum' ? 'A0-curriculum-WA' : 'A0-WA'
      const template = email ? 'A0' : item.key === 'wa_curriculum' ? 'skillsair_curriculum' : 'skillsair_offer_ready'
      if (person) {
        await recordMessage(payload, {
          person, channel: email ? 'email' : 'whatsapp', kind: 'transactional', track: 'A', stepId, template,
          subjectId: `lead:${lead.id}`, cycle, idempotencyKey: idempotencyKey('A', stepId, `lead:${lead.id}`, cycle), status: 'sent', sentAt: item.sentAt, variant: email ? a0Variant : null,
        }).catch((err: unknown) => logger.error({ err, leadId }, 'lead_offer_message_log_failed'))
      }
    }
  }
}

/** Fire-and-forget wrapper used by the public endpoint. */
export function queueOfferMessages(payload: Payload, leadId: number): void {
  void sendOfferMessages(payload, leadId).catch((err: unknown) => {
    logger.error({ err, leadId }, 'lead_offer_messages_failed')
  })
}
