import type { Payload } from 'payload'
import type { FooterLinks } from '../../emails/layout.js'
import type { EmailContent } from '../resend.js'
import { LIFECYCLE_TEMPLATES } from '../../emails/lifecycle/index.js'
import { bodyParams, quickReplyButton, urlButton, type TemplateComponent } from '../whatsapp.js'
import { QUICK_REPLY_PAYLOADS } from '../../content/whatsapp-replies.js'
import { buildOffer, type Offer, type OfferCourseDoc } from '../offers.js'
import { applyLeadEvent, type LeadDoc } from '../leads.js'
import type { MessageData } from './context.js'

/**
 * Lifecycle templates by id: the emails in src/emails/lifecycle/ and the WhatsApp templates in
 * docs/whatsapp-templates.md. A renderer returns null when content it needs isn't there (the
 * step then waits instead of going out half-empty).
 */
export interface RenderInput {
  data: MessageData
  offer: Offer | null
  links: FooterLinks
}

export type EmailRenderer = (input: RenderInput & { variant?: number }) => EmailContent | null

/** Steps that need content the owner may not have filled in yet. */
const REQUIRES: Record<string, (data: MessageData) => boolean> = {
  P2: (data) => Boolean(data.freeExercise),
  C2L: (data) => Boolean(data.laptopDeadline),
  G1: (data) => Boolean(data.nextProgramme),
  G2: (data) => Boolean(data.nextProgramme),
  G3: (data) => Boolean(data.nextProgramme),
  A1: (data) => Boolean(data.programmeSlug),
  A3: (data) => Boolean(data.programmeSlug),
  L1: (data) => Boolean(data.plan),
  L2: (data) => Boolean(data.plan?.nextTitle),
}

/**
 * A/B subject lines (brief section 12): the person's version is fixed by a hash of their id, so
 * they always see the same one; winners are picked on conversions in the lifecycle dashboard.
 * LIFECYCLE_AB_TESTS=false sends everyone version a.
 */
export function variantFor(templateId: string, personKey: string): number {
  const count = LIFECYCLE_TEMPLATES[templateId]?.variantCount ?? 1
  if (count < 2 || process.env.LIFECYCLE_AB_TESTS === 'false') return 0
  let hash = 0
  for (const char of `${templateId}:${personKey}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % count
}

export const variantLabel = (variant: number) => String.fromCharCode(97 + variant)

export const LIFECYCLE_EMAILS: Record<string, EmailRenderer> = Object.fromEntries(
  Object.values(LIFECYCLE_TEMPLATES).map((template) => [
    template.id,
    (input: RenderInput & { variant?: number }) => {
      const requirement = REQUIRES[template.id]
      if (requirement && !requirement(input.data)) return null
      return template.render(input.data, input.links, input.variant ?? 0)
    },
  ]),
)

/** WhatsApp templates: the components to send, or null if a required value is missing. */
export interface WhatsAppTemplate {
  components: (data: MessageData) => TemplateComponent[] | null
  /** Runs after a successful send (e.g. put the lead in Imisi's queue). */
  afterSend?: (payload: Payload, lead: LeadDoc | null) => Promise<void>
}

const talk = (index = 1) => quickReplyButton(index, QUICK_REPLY_PAYLOADS.talk)
/** New templates (8–13) use one URL button "https://skillsair.com/{{1}}", so the suffix is a path. */
const path = (url: string) => url.replace(/^https?:\/\/[^/]+\//, '')

export const LIFECYCLE_WHATSAPP: Record<string, WhatsAppTemplate> = {
  // Existing approved templates (1–7).
  skillsair_offer_reminder: {
    components: (data) => (data.resumeCode && data.closesOn ? [bodyParams(data.firstName, data.programme, data.closesOn), urlButton(0, data.resumeCode), talk()] : null),
  },
  skillsair_window_closing: {
    components: (data) => (data.resumeCode && data.closesOn ? [bodyParams(data.firstName, data.closesOn, data.programme), urlButton(0, data.resumeCode), talk()] : null),
  },
  skillsair_payment_help: {
    components: (data) => (data.orderReference && data.programmeSlug ? [bodyParams(data.firstName, data.programme, data.orderReference), urlButton(0, data.programmeSlug), talk()] : null),
    // A failed payment puts the applicant in Imisi's queue (+40).
    afterSend: async (payload, lead) => {
      if (lead) await applyLeadEvent(payload, lead, { type: 'payment_failed' })
    },
  },
  skillsair_welcome: {
    // "Aim to finish by": the programme is designed to take about 3 months.
    components: (data) => [bodyParams(data.firstName, data.programme, new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date(Date.now() + 91 * 86_400_000)))],
  },
  skillsair_course_complete: {
    components: (data) => (data.programmeSlug ? [bodyParams(data.firstName, data.programme), urlButton(0, data.programmeSlug)] : null),
  },
  // New templates (8–13), submitted to Meta with this release.
  skillsair_payment_failed: {
    components: (data) => [bodyParams(data.firstName, data.programme, String(data.graceDays)), urlButton(0, path(data.updateCardUrl)), talk()],
  },
  skillsair_access_paused: {
    components: (data) => [bodyParams(data.firstName, data.programme, String(data.progressPercent)), urlButton(0, path(data.resumeCheckoutUrl)), talk()],
  },
  skillsair_learning_nudge: {
    components: (data) => (data.nextLessonTitle ? [bodyParams(data.firstName, data.programme, data.nextLessonTitle), urlButton(0, path(data.resumeUrl)), quickReplyButton(1, QUICK_REPLY_PAYLOADS.talk)] : null),
  },
  skillsair_resume_offer: {
    components: (data) => [bodyParams(data.firstName, data.programme, String(data.progressPercent)), urlButton(0, path(data.resumeCheckoutUrl)), talk()],
  },
  skillsair_certificate_reminder: {
    components: (data) => [bodyParams(data.firstName, data.programme), urlButton(0, path(data.certificateCheckoutUrl))],
  },
  skillsair_next_programme: {
    components: (data) => (data.nextProgramme ? [bodyParams(data.firstName, data.programme, data.nextProgramme.title), urlButton(0, path(data.nextProgramme.url))] : null),
  },
}

/** The applicant's offer for the stage's programme, priced for them (locked rate included). */
export async function offerFor(payload: Payload, courseId: number | undefined, userId: number | undefined): Promise<Offer | null> {
  if (!courseId) return null
  const course = (await payload.findByID({ collection: 'courses', id: courseId, depth: 1, overrideAccess: true }).catch(() => null)) as OfferCourseDoc | null
  if (!course || course.status !== 'published') return null
  return buildOffer(payload, course, userId)
}
