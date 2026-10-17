import type { Payload } from 'payload'
import { relationId, findLeadForUser, formatLagosDate, type LeadDoc } from '../leads.js'
import { getScholarshipWindow, windowIsOpen, certificatePrice } from '../pricing.js'
import { isDeliverableEmail } from '../lead-messaging.js'
import type { LogEntry, PersonSnapshot, Stage, WindowState } from './types.js'

/**
 * Loads what the planner needs from the database: a person's snapshot, their message log and
 * the scholarship window. A lead who has created an account is handled as the user (one
 * person, one message history).
 */
export type PersonRef = { type: 'user'; id: number } | { type: 'lead'; id: number }

const ms = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

interface UserRow {
  id: number
  email: string
  firstName?: string | null
  phone?: string | null
  createdAt: string
  marketingConsent?: string | null
  lifecycle?: {
    lastLearningAt?: string | null
    emailPrefs?: { offers?: boolean | null; learningReminders?: boolean | null } | null
    emailSuppressed?: string | null
    lastEngagedAt?: string | null
    sunsetAt?: string | null
  } | null
}

export interface LoadedPerson {
  snapshot: PersonSnapshot
  user: UserRow | null
  lead: LeadDoc | null
}

function leadAllowsMarketing(lead: LeadDoc | null): boolean {
  return Boolean(lead?.marketingConsent) && !lead?.optedOutAt
}

export async function loadPerson(payload: Payload, ref: PersonRef): Promise<LoadedPerson | null> {
  let user: UserRow | null = null
  let lead: LeadDoc | null = null
  if (ref.type === 'lead') {
    lead = (await payload.findByID({ collection: 'leads', id: ref.id, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as LeadDoc | null
    if (!lead) return null
    const userId = relationId(lead.user)
    if (userId) user = (await payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as UserRow | null
  } else {
    user = (await payload.findByID({ collection: 'users', id: ref.id, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as UserRow | null
    if (!user) return null
    lead = await findLeadForUser(payload, { id: user.id, email: user.email, role: 'student' })
  }

  const leadSnapshot = lead
    ? { id: lead.id, status: lead.status, createdAt: ms(lead.createdAt) ?? Date.now(), courseId: relationId(lead.course) ?? null }
    : null

  if (!user) {
    const email = lead && isDeliverableEmail(lead.email) ? lead.email : null
    return {
      user: null,
      lead,
      snapshot: {
        key: `lead:${lead!.id}`, kind: 'lead', id: lead!.id, createdAt: ms(lead!.createdAt) ?? Date.now(),
        email, phone: lead!.phone || null,
        emailSuppressed: Boolean((lead as unknown as { emailSuppressed?: string | null }).emailSuppressed),
        marketingEmailAllowed: leadAllowsMarketing(lead), marketingWhatsAppAllowed: leadAllowsMarketing(lead), learningReminders: true,
        sunsetAt: ms((lead as unknown as { sunsetAt?: string | null }).sunsetAt),
        lastEngagedAt: ms((lead as unknown as { lastEngagedAt?: string | null }).lastEngagedAt),
        lastLearningAt: null, lead: leadSnapshot, orders: [], subscriptions: [], enrollments: [], certificates: [],
      },
    }
  }

  const [orders, subscriptions, enrollments, certificates] = await Promise.all([
    payload.find({ collection: 'orders', where: { user: { equals: user.id } }, limit: 200, depth: 0, overrideAccess: true }),
    payload.find({ collection: 'subscriptions', where: { user: { equals: user.id } }, limit: 200, depth: 0, overrideAccess: true }),
    payload.find({ collection: 'enrollments', where: { student: { equals: user.id } }, limit: 200, depth: 0, overrideAccess: true }),
    payload.find({ collection: 'certificates', where: { student: { equals: user.id } }, limit: 200, depth: 0, overrideAccess: true }),
  ])
  const life = user.lifecycle ?? {}
  const email = isDeliverableEmail(user.email) ? user.email : null
  const consented = user.marketingConsent === 'opted_in'
  return {
    user,
    lead,
    snapshot: {
      key: `user:${user.id}`, kind: 'user', id: user.id, createdAt: ms(user.createdAt) ?? Date.now(),
      email, phone: user.phone || lead?.phone || null,
      emailSuppressed: Boolean(life.emailSuppressed),
      marketingEmailAllowed: consented && life.emailPrefs?.offers === true,
      // WhatsApp marketing consent lives on the lead (STOP/START there).
      marketingWhatsAppAllowed: lead ? leadAllowsMarketing(lead) : consented,
      learningReminders: life.emailPrefs?.learningReminders !== false,
      sunsetAt: ms(life.sunsetAt),
      lastEngagedAt: Math.max(ms(life.lastEngagedAt) ?? 0, ms((lead as unknown as { lastEngagedAt?: string | null } | null)?.lastEngagedAt) ?? 0) || null,
      lastLearningAt: ms(life.lastLearningAt),
      lead: leadSnapshot,
      orders: orders.docs.map((doc) => ({ id: Number(doc.id), type: String(doc.type), status: String(doc.status), courseId: Number(relationId(doc.course)) || null, createdAt: ms(doc.createdAt) ?? 0 })),
      subscriptions: subscriptions.docs.map((doc) => ({
        id: Number(doc.id), courseId: Number(relationId(doc.course)), status: doc.status as PersonSnapshot['subscriptions'][number]['status'],
        lastFailedAt: ms((doc as { lastFailedAt?: string | null }).lastFailedAt), currentPeriodEnd: ms(doc.currentPeriodEnd),
        failedAttempts: Number((doc as { failedAttempts?: number | null }).failedAttempts ?? 0), updatedAt: ms(doc.updatedAt) ?? 0,
      })),
      enrollments: enrollments.docs.map((doc) => ({
        id: Number(doc.id), courseId: Number(relationId(doc.course)), status: String(doc.status),
        enrolledAt: ms((doc as { enrolledAt?: string | null }).enrolledAt) ?? ms(doc.createdAt) ?? 0,
        completedAt: ms((doc as { completedAt?: string | null }).completedAt),
        cycle: Number((doc as { lifecycleCycle?: number | null }).lifecycleCycle ?? 0),
        subscriptionBased: Boolean(relationId(doc.subscription)) || subscriptions.docs.some((sub) => Number(relationId(sub.course)) === Number(relationId(doc.course))),
      })),
      certificates: certificates.docs.map((doc) => ({ courseId: Number(relationId(doc.course)), issuedAt: ms((doc as { issuedAt?: string | null }).issuedAt) ?? ms(doc.createdAt) ?? 0 })),
    },
  }
}

export async function loadLog(payload: Payload, personKey: string): Promise<LogEntry[]> {
  const result = await payload.find({ collection: 'messages', where: { personKey: { equals: personKey } }, sort: 'sentAt', limit: 2000, depth: 0, overrideAccess: true })
  return result.docs.map((doc) => ({
    idempotencyKey: String(doc.idempotencyKey), track: String(doc.track), stepId: String(doc.stepId),
    kind: doc.kind as LogEntry['kind'], channel: doc.channel as LogEntry['channel'], status: doc.status as LogEntry['status'],
    skipReason: (doc.skipReason as string | null) ?? null, sentAt: ms(doc.sentAt) ?? 0, openedAt: ms(doc.openedAt), clickedAt: ms(doc.clickedAt),
  }))
}

export async function loadWindow(payload: Payload, now = Date.now()): Promise<WindowState> {
  const window = await getScholarshipWindow(payload)
  const open = windowIsOpen(window, now)
  const closesAt = ms(window.closesAt)
  return {
    open,
    opensAt: open ? ms(window.opensAt) : null,
    closesAt: open ? closesAt : null,
    lastClosedAt: !open && closesAt !== null && closesAt <= now ? closesAt : null,
  }
}

/** Data the templates use. Every field has a fallback; templates never see undefined. */
export interface MessageData {
  firstName: string
  email: string
  programme: string
  programmeSlug: string
  /** The applicant's personal offer page (resume link for leads). */
  offerUrl: string
  checkoutUrl: string
  closesOn: string
  closesAt: string | null
  certificatePrice: number
  resumeCode: string | null
  orderReference: string | null
}

const FRONTEND_URL = (process.env.FRONTEND_URL ?? 'https://skillsair.com').replace(/\/+$/, '')

export async function buildMessageData(payload: Payload, person: LoadedPerson, stage: Stage, window: WindowState): Promise<MessageData> {
  const course = stage.courseId
    ? ((await payload.findByID({ collection: 'courses', id: stage.courseId, depth: 0, overrideAccess: true }).catch(() => null)) as { title?: string; slug?: string } | null)
    : null
  const slug = course?.slug ?? ''
  const resumeCode = person.lead?.resumeCode ?? null
  let orderReference: string | null = null
  if (stage.subjectId.startsWith('order:')) {
    const order = await payload.findByID({ collection: 'orders', id: Number(stage.subjectId.slice(6)), depth: 0, overrideAccess: true }).catch(() => null)
    orderReference = order ? String(order.reference) : null
  }
  return {
    firstName: (person.user?.firstName || person.lead?.firstName || '').trim() || 'there',
    email: person.snapshot.email ?? '',
    programme: course?.title ?? 'your programme',
    programmeSlug: slug,
    offerUrl: resumeCode ? `${FRONTEND_URL}/r/${resumeCode}` : slug ? `${FRONTEND_URL}/apply/offer?programme=${encodeURIComponent(slug)}` : `${FRONTEND_URL}/apply`,
    checkoutUrl: slug ? `${FRONTEND_URL}/checkout?course=${encodeURIComponent(slug)}` : `${FRONTEND_URL}/schools`,
    closesOn: window.closesAt !== null ? formatLagosDate(new Date(window.closesAt).toISOString()) : '',
    closesAt: window.closesAt !== null ? new Date(window.closesAt).toISOString() : null,
    certificatePrice: certificatePrice(),
    resumeCode,
    orderReference,
  }
}
