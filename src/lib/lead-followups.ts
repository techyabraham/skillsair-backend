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
import { getScholarshipWindow, windowIsOpen } from './pricing.js'
import { bodyParams, quickReplyButton, sendTemplate, urlButton, type TemplateComponent } from './whatsapp.js'
import { runLifecycle } from './lifecycle/engine.js'
import { loadPerson, loadWindow } from './lifecycle/context.js'
import { executeStep, recordMessage } from './lifecycle/send.js'
import { stepById } from './lifecycle/sequences.js'
import { idempotencyKey, type PlannedStep } from './lifecycle/plan.js'
import { windowCycle } from './lifecycle/stage.js'
import type { Stage } from './lifecycle/types.js'
import { QUICK_REPLY_PAYLOADS } from '../content/whatsapp-replies.js'
import { leadAllowsMarketing } from './marketing-permission.js'

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

/** Marketing needs no opt-out and a lead still in the funnel. */
export function canMarket(lead: LeadDoc): boolean {
  return leadAllowsMarketing(lead) && lead.status !== 'paid' && lead.status !== 'lost'
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
 * WhatsApp payment help (utility) when a payment fails or stays pending: the B1-WA step of
 * Track B, sent at once when Paystack reports a failed payment. The hourly engine sends the
 * same step for orders still pending after 2 hours; the shared message key means it goes once.
 */
export async function sendPaymentHelp(payload: Payload, orderId: number): Promise<void> {
  const order = await payload.findByID({ collection: 'orders', id: orderId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!order || (order.type !== 'course' && order.type !== 'subscription') || order.status === 'success' || order.status === 'refunded') return
  const userId = relationId(order.user)
  const courseId = relationId(order.course)
  if (!userId || !courseId) return
  const person = await loadPerson(payload, { type: 'user', id: Number(userId) })
  const step = stepById('B1-WA')
  if (!person || !step) return
  const stage: Stage = { track: 'B', subjectId: `order:${orderId}`, enteredAt: Date.now(), cycle: 0, courseId: Number(courseId) }
  const planned: PlannedStep = {
    step, stage, stepId: 'B1-WA', kind: step.kind, channel: 'whatsapp', template: step.template,
    idempotencyKey: idempotencyKey('B', 'B1-WA', stage.subjectId, 0), dueAt: Date.now(),
  }
  await executeStep(payload, person, planned, await loadWindow(payload), person.snapshot.phone ? undefined : 'no_phone')
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

/**
 * Lead scoring that doesn't send anything: "account created, no payment after 2 hours" and
 * "viewed the offer, window closing within 48 hours". Idempotent through followUpsSent.
 */
export async function scoreLead(payload: Payload, lead: LeadDoc, window: WindowContext, now = Date.now()): Promise<void> {
  const followUps: LeadFollowUp[] = [...(lead.followUpsSent ?? [])]
  const data: Record<string, unknown> = {}
  const nowIso = new Date(now).toISOString()
  const mark = (key: string) => followUps.push({ key, sentAt: nowIso })
  const has = (key: string) => followUps.some((item) => item.key === key)

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
  if (followUps.length !== (lead.followUpsSent ?? []).length || Object.keys(data).length) {
    await payload.update({ collection: 'leads', id: lead.id, data: { ...data, followUpsSent: followUps }, depth: 0, overrideAccess: true })
  }
}

/**
 * Kept for existing callers: scores the lead, then runs them through the lifecycle engine
 * (src/lib/lifecycle). Returns the number of messages sent.
 */
export async function processLeadFollowUps(payload: Payload, lead: LeadDoc, window: WindowContext, now = Date.now()): Promise<number> {
  await scoreLead(payload, lead, window, now)
  const userId = relationId(lead.user)
  const summary = await runLifecycle(payload, now, [userId ? { type: 'user', id: Number(userId) } : { type: 'lead', id: lead.id }])
  return summary.sent
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
        if (outcome.sent) {
          sent++
          const person = await loadPerson(payload, { type: 'lead', id: lead.id })
          if (person) {
            const cycle = windowCycle(window.closesAt ? Date.parse(window.closesAt) : null)
            await recordMessage(payload, {
              person, channel: 'whatsapp', kind: 'marketing', track: 'A', stepId: 'W1-WA', template: 'skillsair_window_open',
              subjectId: `lead:${lead.id}`, cycle, idempotencyKey: idempotencyKey('A', 'W1-WA', `lead:${lead.id}`, cycle), status: 'sent', providerId: outcome.messageId ?? null,
            })
          }
        }
      } catch (err) {
        logger.error({ err, leadId: lead.id }, 'waitlist_notify_failed')
      }
    }
    if (!result.hasNextPage) break
    page++
  }
  return sent
}
