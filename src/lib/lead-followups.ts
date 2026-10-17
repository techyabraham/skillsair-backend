import type { Payload } from 'payload'
import { logger } from './logger.js'
import { claimIdempotencyKey } from './redis.js'
import {
  appendLog,
  findLeadForUser,
  formatLagosDate,
  hasFollowUp,
  relationId,
  scoreLeadEvent,
  type LeadDoc,
  type LeadFollowUp,
  type LeadLogEntry,
} from './leads.js'
import { listUnsubscribeHeaders, preferencesUrl } from './email-tokens.js'
import { buildOffer, type Offer, type OfferCourseDoc } from './offers.js'
import { getScholarshipWindow, windowIsOpen } from './pricing.js'
import { bodyParams, quickReplyButton, sendTemplate, urlButton, type TemplateComponent } from './whatsapp.js'
import {
  followUpCareerEmail,
  followUpClosingEmail,
  followUpQuickQuestionEmail,
  sendEmail,
  welcomeAfterPaymentEmail,
} from './resend.js'
import { isDeliverableEmail, resumeUrl } from './lead-messaging.js'
import { QUICK_REPLY_PAYLOADS } from '../content/whatsapp-replies.js'
import { careerExplainer } from '../content/career-explainers.js'

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'
const HOUR = 60 * 60 * 1000
/** At most 3 automated marketing WhatsApp templates per lead per scholarship window. */
const MARKETING_WA_CAP = 3

interface UserDoc {
  id: number
  email: string
  firstName: string
  phone?: string | null
  marketingConsent?: string
}

interface CourseLite {
  id: number
  title: string
  slug: string
  durationMonths?: number | null
}

/** Marketing needs explicit consent, no opt-out, and a lead still in the funnel. */
export function canMarket(lead: LeadDoc): boolean {
  return Boolean(lead.marketingConsent) && !lead.optedOutAt && lead.status !== 'paid' && lead.status !== 'lost'
}

function marketingSentThisWindow(lead: Pick<LeadDoc, 'followUpsSent'>, windowKey: string): number {
  return (lead.followUpsSent ?? []).filter((item) => item.key.startsWith('wa_mkt:') && item.key.endsWith(`:${windowKey}`)).length
}

async function getUser(payload: Payload, userId: number): Promise<UserDoc | null> {
  return (await payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true }).catch(() => null)) as UserDoc | null
}

async function getCourse(payload: Payload, courseId: number): Promise<CourseLite | null> {
  return (await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true }).catch(() => null)) as CourseLite | null
}

async function recordOnLead(payload: Payload, lead: LeadDoc | null, entry: LeadLogEntry, data: Record<string, unknown> = {}): Promise<void> {
  if (!lead) return
  await payload.update({
    collection: 'leads',
    id: lead.id,
    data: { ...data, whatsappLog: appendLog(lead, entry) },
    depth: 0,
    overrideAccess: true,
  })
}

/**
 * Utility template when a course payment fails or stays pending. Sent once per order;
 * the lead joins Imisi's queue (+40).
 */
export async function sendPaymentHelp(payload: Payload, orderId: number): Promise<void> {
  const order = await payload.findByID({ collection: 'orders', id: orderId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!order || (order.type !== 'course' && order.type !== 'subscription') || order.status === 'success' || order.status === 'refunded') return
  if (!(await claimIdempotencyKey(`payment-help:${orderId}`, 60 * 24 * 60 * 60))) return
  const userId = relationId(order.user)
  const courseId = relationId(order.course)
  if (!userId || !courseId) return
  const [user, course] = await Promise.all([getUser(payload, userId), getCourse(payload, courseId)])
  if (!user || !course) return
  const lead = await findLeadForUser(payload, { id: user.id, email: user.email, role: 'student' })
  const phone = user.phone || lead?.phone
  const now = new Date().toISOString()
  let entry: LeadLogEntry = { direction: 'out', type: 'skipped', template: 'skillsair_payment_help', body: 'no phone', at: now }
  if (phone) {
    const result = await sendTemplate(phone, 'skillsair_payment_help', 'en', [
      bodyParams(user.firstName, course.title, String(order.reference)),
      urlButton(0, course.slug),
      quickReplyButton(1, QUICK_REPLY_PAYLOADS.talk),
    ])
    entry = { direction: 'out', type: result.sent ? 'template' : result.skipped ? `template_${result.skipped}` : 'error', template: 'skillsair_payment_help', body: result.error ?? String(order.reference), at: now }
  }
  if (lead) await recordOnLead(payload, lead, entry, scoreLeadEvent(lead, { type: 'payment_failed' }) as Record<string, unknown>)
}

/** Utility template + email E after a course payment succeeds. Once per learner and course. */
export async function sendWelcomeMessages(payload: Payload, userId: number, courseId: number): Promise<void> {
  if (!(await claimIdempotencyKey(`welcome:${userId}:${courseId}`, 365 * 24 * 60 * 60))) return
  const [user, course] = await Promise.all([getUser(payload, userId), getCourse(payload, courseId)])
  if (!user || !course) return
  const finishBy = formatLagosDate(new Date(Date.now() + (course.durationMonths ?? 3) * 30 * 24 * HOUR).toISOString())
  const lead = await findLeadForUser(payload, { id: user.id, email: user.email, role: 'student' })
  const phone = user.phone || lead?.phone
  if (phone) {
    const result = await sendTemplate(phone, 'skillsair_welcome', 'en', [bodyParams(user.firstName, course.title, finishBy)])
    await recordOnLead(payload, lead, {
      direction: 'out',
      type: result.sent ? 'template' : result.skipped ? `template_${result.skipped}` : 'error',
      template: 'skillsair_welcome',
      body: result.error ?? '',
      at: new Date().toISOString(),
    })
  }
  try {
    await sendEmail(user.email, welcomeAfterPaymentEmail(user.firstName, course.title, finishBy))
  } catch (err) {
    logger.error({ err, userId }, 'welcome_email_failed')
  }
}

/** Utility template when a learner completes a programme (certificate is claimable). */
export async function sendCourseCompleteMessage(payload: Payload, userId: number, courseId: number): Promise<void> {
  if (!(await claimIdempotencyKey(`course-complete:${userId}:${courseId}`, 365 * 24 * 60 * 60))) return
  const [user, course] = await Promise.all([getUser(payload, userId), getCourse(payload, courseId)])
  if (!user?.phone || !course) return
  await sendTemplate(user.phone, 'skillsair_course_complete', 'en', [bodyParams(user.firstName, course.title), urlButton(0, course.slug)])
}

function reminderComponents(lead: LeadDoc, ...params: string[]): TemplateComponent[] {
  return [bodyParams(...params), urlButton(0, lead.resumeCode), quickReplyButton(1, QUICK_REPLY_PAYLOADS.talk)]
}

interface WindowContext {
  open: boolean
  key: string
  closesAt: string | null
  closesOn: string
}

async function hasPaidOrder(payload: Payload, userId: number | undefined): Promise<boolean> {
  if (!userId) return false
  const orders = await payload.count({ collection: 'orders', where: { and: [{ user: { equals: userId } }, { status: { equals: 'success' } }] }, overrideAccess: true })
  return orders.totalDocs > 0
}

/** Runs one lead through the follow-up rules; returns the number of messages sent. */
export async function processLeadFollowUps(payload: Payload, lead: LeadDoc, window: WindowContext, now = Date.now()): Promise<number> {
  const followUps: LeadFollowUp[] = [...(lead.followUpsSent ?? [])]
  let log = lead.whatsappLog ?? []
  const data: Record<string, unknown> = {}
  const nowIso = new Date(now).toISOString()
  const created = new Date(lead.createdAt).getTime()
  const mark = (key: string) => followUps.push({ key, sentAt: nowIso })
  const has = (key: string) => followUps.some((item) => item.key === key)
  let sent = 0

  // Scoring rules that don't send anything.
  if (lead.status === 'account_created' && !has('score_no_payment') && lead.lastEventAt && now - new Date(lead.lastEventAt).getTime() > 2 * HOUR) {
    if (!(await hasPaidOrder(payload, relationId(lead.user)))) {
      Object.assign(data, scoreLeadEvent(lead, { type: 'account_no_payment' }))
      mark('score_no_payment')
    }
  }
  const closingSoon = window.open && window.closesAt !== null && new Date(window.closesAt).getTime() - now < 48 * HOUR
  if (closingSoon && Number(lead.offerViewCount ?? 0) > 0 && !has(`score_window_closing:${window.key}`)) {
    data.score = Math.min(100, Number(data.score ?? lead.score ?? 0) + 10)
    mark(`score_window_closing:${window.key}`)
  }

  const courseId = relationId(lead.course)
  if (window.open && canMarket(lead) && courseId) {
    const course = (await payload.findByID({ collection: 'courses', id: courseId, depth: 1, overrideAccess: true }).catch(() => null)) as OfferCourseDoc | null
    const offer: Offer | null = course && course.status === 'published' ? await buildOffer(payload, course) : null
    if (offer?.windowOpen) {
      const emailInput = {
        firstName: lead.firstName,
        programme: offer.programme,
        offerUrl: resumeUrl(lead),
        unsubscribeUrl: preferencesUrl({ type: 'lead', id: lead.id }),
        price: offer.effectivePrice,
        standardPrice: offer.standardPrice,
        certificatePrice: offer.certificatePrice,
        closesOn: window.closesOn,
      }
      const email = isDeliverableEmail(lead.email)
      const waBudget = () => MARKETING_WA_CAP - marketingSentThisWindow({ followUpsSent: followUps }, window.key)
      const sendWa = async (template: string, key: string, params: string[]) => {
        if (waBudget() <= 0 || has(key)) return
        const result = await sendTemplate(lead.phone, template, 'en', reminderComponents(lead, ...params))
        if (result.sent) {
          mark(key)
          sent++
        }
        if (!result.skipped || result.sent) {
          log = appendLog({ whatsappLog: log }, { direction: 'out', type: result.sent ? 'template' : 'error', template, body: result.error ?? '', at: nowIso })
        }
      }
      const sendMail = async (key: string, build: () => { subject: string; html: string; text: string }) => {
        if (!email || has(key)) return
        try {
          await sendEmail(lead.email, build(), {
            stream: 'marketing',
            headers: listUnsubscribeHeaders({ type: 'lead', id: lead.id }, 'offers'),
            tags: { track: 'A', step: key },
          })
          mark(key)
          sent++
        } catch (err) {
          logger.error({ err, leadId: lead.id, key }, 'lead_followup_email_failed')
        }
      }

      const inFunnel = lead.status !== 'account_created'
      if (inFunnel && now - created >= HOUR) await sendMail('email_b', () => followUpQuickQuestionEmail(emailInput))
      if (inFunnel && now - created >= 24 * HOUR) {
        const explainer = careerExplainer(offer.school)
        await sendMail('email_c', () => followUpCareerEmail({ ...emailInput, role: explainer.role, explainer: explainer.body }))
        await sendWa('skillsair_offer_reminder', `wa_mkt:offer_reminder:${window.key}`, [lead.firstName, offer.programme, window.closesOn])
      }
      if (closingSoon) {
        await sendMail(`email_d:${window.key}`, () => followUpClosingEmail(emailInput))
        await sendWa('skillsair_window_closing', `wa_mkt:window_closing:${window.key}`, [lead.firstName, window.closesOn, offer.programme])
      }
    }
  }

  if (followUps.length !== (lead.followUpsSent ?? []).length || Object.keys(data).length) {
    await payload.update({
      collection: 'leads',
      id: lead.id,
      data: { ...data, followUpsSent: followUps, whatsappLog: log },
      depth: 0,
      overrideAccess: true,
    })
  }
  return sent
}

export async function currentWindowContext(payload: Payload): Promise<WindowContext> {
  const window = await getScholarshipWindow(payload)
  const open = windowIsOpen(window)
  return {
    open,
    key: open && window.closesAt ? new Date(window.closesAt).toISOString() : 'closed',
    closesAt: open ? window.closesAt ?? null : null,
    closesOn: open ? formatLagosDate(window.closesAt) : '',
  }
}

/** Waitlist leads with consent hear when a new window opens (counts toward the cap). */
export async function notifyWaitlist(payload: Payload): Promise<number> {
  const window = await currentWindowContext(payload)
  if (!window.open) return 0
  if (!(await claimIdempotencyKey(`window-open:${window.key}`, 180 * 24 * 60 * 60))) return 0
  let sent = 0
  let page = 1
  for (;;) {
    const result = await payload.find({
      collection: 'leads',
      where: { and: [{ waitlist: { equals: true } }, { marketingConsent: { equals: true } }, { optedOutAt: { exists: false } }, { status: { not_in: ['paid', 'lost'] } }] },
      limit: 200,
      page,
      depth: 0,
      overrideAccess: true,
    })
    for (const lead of result.docs as unknown as LeadDoc[]) {
      try {
        const key = `wa_mkt:window_open:${window.key}`
        if (hasFollowUp(lead, key) || marketingSentThisWindow(lead, window.key) >= MARKETING_WA_CAP) continue
        const courseId = relationId(lead.course)
        const course = courseId ? await getCourse(payload, courseId) : null
        const outcome = await sendTemplate(lead.phone, 'skillsair_window_open', 'en', reminderComponents(lead, lead.firstName, course?.title ?? 'your programme', window.closesOn))
        const now = new Date().toISOString()
        await payload.update({
          collection: 'leads',
          id: lead.id,
          data: {
            waitlist: false,
            ...(outcome.sent ? { followUpsSent: [...(lead.followUpsSent ?? []), { key, sentAt: now }] } : {}),
            whatsappLog: appendLog(lead, { direction: 'out', type: outcome.sent ? 'template' : outcome.skipped ? `template_${outcome.skipped}` : 'error', template: 'skillsair_window_open', body: outcome.error ?? '', at: now }),
          },
          depth: 0,
          overrideAccess: true,
        })
        if (outcome.sent) sent++
      } catch (err) {
        logger.error({ err, leadId: lead.id }, 'waitlist_notify_failed')
      }
    }
    if (!result.hasNextPage) break
    page++
  }
  return sent
}
