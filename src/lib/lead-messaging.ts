import type { Payload } from 'payload'
import { logger } from './logger.js'
import { appendLog, formatLagosDate, hasFollowUp, relationId, type LeadDoc } from './leads.js'
import { buildOffer, type OfferCourseDoc } from './offers.js'
import { bodyParams, quickReplyButton, sendTemplate, urlButton, type WhatsAppSendResult } from './whatsapp.js'
import { offerEmail, sendEmail } from './resend.js'
import { QUICK_REPLY_PAYLOADS } from '../content/whatsapp-replies.js'

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

  if (!hasFollowUp(lead, 'email_offer') && isDeliverableEmail(lead.email)) {
    try {
      await sendEmail(lead.email, offerEmail({
        firstName: lead.firstName,
        programme: offer.programme,
        offerUrl: resumeUrl(lead),
        windowOpen: offer.windowOpen,
        price: offer.price,
        standardPrice: offer.standardPrice,
        standardMonthlyPrice: offer.standardMonthlyPrice,
        certificatePrice: offer.certificatePrice,
        closesOn,
      }))
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
}

/** Fire-and-forget wrapper used by the public endpoint. */
export function queueOfferMessages(payload: Payload, leadId: number): void {
  void sendOfferMessages(payload, leadId).catch((err: unknown) => {
    logger.error({ err, leadId }, 'lead_offer_messages_failed')
  })
}
