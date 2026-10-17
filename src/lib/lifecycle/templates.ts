import type { Payload } from 'payload'
import type { FooterLinks } from '../../emails/layout.js'
import { followUpCareerEmail, followUpClosingEmail, followUpQuickQuestionEmail, type EmailContent } from '../resend.js'
import { bodyParams, quickReplyButton, urlButton, type TemplateComponent } from '../whatsapp.js'
import { QUICK_REPLY_PAYLOADS } from '../../content/whatsapp-replies.js'
import { careerExplainer } from '../../content/career-explainers.js'
import { buildOffer, type Offer, type OfferCourseDoc } from '../offers.js'
import { applyLeadEvent, type LeadDoc } from '../leads.js'
import type { MessageData } from './context.js'

/**
 * Lifecycle templates by id. Email renderers return null when the data they need is missing
 * (the step is then held back, not skipped). Step 5 replaces these with the final copy in
 * src/emails/; until then A1, A3 and A6 use the existing follow-up emails.
 */
export interface RenderInput {
  data: MessageData
  offer: Offer | null
  links: FooterLinks
}

export type EmailRenderer = (input: RenderInput) => EmailContent | null

function followUpInput(input: RenderInput) {
  if (!input.offer) return null
  return {
    firstName: input.data.firstName,
    programme: input.offer.programme,
    offerUrl: input.data.offerUrl,
    unsubscribeUrl: input.links.preferencesUrl ?? '',
    price: input.offer.price,
    standardPrice: input.offer.standardPrice,
    certificatePrice: input.offer.certificatePrice,
    closesOn: input.data.closesOn,
  }
}

export const LIFECYCLE_EMAILS: Record<string, EmailRenderer> = {
  A1: (input) => {
    const base = followUpInput(input)
    return base ? followUpQuickQuestionEmail(base) : null
  },
  A3: (input) => {
    const base = followUpInput(input)
    if (!base || !input.offer) return null
    const explainer = careerExplainer(input.offer.school)
    return followUpCareerEmail({ ...base, role: explainer.role, explainer: explainer.body })
  },
  A6: (input) => {
    const base = followUpInput(input)
    return base ? followUpClosingEmail(base) : null
  },
}

/** WhatsApp templates: the components to send, or null if a required value is missing. */
export interface WhatsAppTemplate {
  components: (data: MessageData) => TemplateComponent[] | null
  /** Runs after a successful send (e.g. put the lead in Imisi's queue). */
  afterSend?: (payload: Payload, lead: LeadDoc | null) => Promise<void>
}

const talk = quickReplyButton(1, QUICK_REPLY_PAYLOADS.talk)

export const LIFECYCLE_WHATSAPP: Record<string, WhatsAppTemplate> = {
  skillsair_offer_reminder: {
    components: (data) => (data.resumeCode && data.closesOn ? [bodyParams(data.firstName, data.programme, data.closesOn), urlButton(0, data.resumeCode), talk] : null),
  },
  skillsair_window_closing: {
    components: (data) => (data.resumeCode && data.closesOn ? [bodyParams(data.firstName, data.closesOn, data.programme), urlButton(0, data.resumeCode), talk] : null),
  },
  skillsair_payment_help: {
    components: (data) => (data.orderReference && data.programmeSlug ? [bodyParams(data.firstName, data.programme, data.orderReference), urlButton(0, data.programmeSlug), talk] : null),
    // A failed payment puts the applicant in Imisi's queue (+40).
    afterSend: async (payload, lead) => {
      if (lead) await applyLeadEvent(payload, lead, { type: 'payment_failed' })
    },
  },
}

/** The applicant's offer for the stage's programme, priced for them (locked rate included). */
export async function offerFor(payload: Payload, courseId: number | undefined, userId: number | undefined): Promise<Offer | null> {
  if (!courseId) return null
  const course = (await payload.findByID({ collection: 'courses', id: courseId, depth: 1, overrideAccess: true }).catch(() => null)) as OfferCourseDoc | null
  if (!course || course.status !== 'published') return null
  return buildOffer(payload, course, userId)
}
