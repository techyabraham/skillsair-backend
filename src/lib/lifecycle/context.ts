import type { Payload } from 'payload'
import { relationId, findLeadForUser, formatLagosDate, type LeadDoc } from '../leads.js'
import { getScholarshipWindow, windowIsOpen, certificatePrice } from '../pricing.js'
import { accessGraceDays, stopBillingOnComplete } from '../billing.js'
import { hasPriceLock, nextProgrammeLockDays } from '../price-lock.js'
import { phoneFriendlyAlternatives } from '../offers.js'
import { careerExplainer } from '../../content/career-explainers.js'
import { offerFor } from './templates.js'
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
        billing: (doc as { billing?: string | null }).billing === 'manual' ? 'manual' : 'card',
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

/**
 * Everything a lifecycle template can show. Every field has a fallback, so a template never
 * prints "undefined"; optional owner content (anecdote, exercise, proof, pairing) is null when
 * not filled in, and the template leaves that part out.
 */
export interface MessageData {
  firstName: string
  email: string
  programme: string
  programmeSlug: string
  school: string
  role: string
  careerExplainer: string
  phoneFriendly: boolean
  phoneFriendlyList: string
  // Links
  offerUrl: string
  checkoutUrl: string
  resumeCheckoutUrl: string
  waitlistUrl: string
  previewUrl: string
  phoneFriendlyUrl: string
  dashboardUrl: string
  resumeUrl: string
  firstLessonUrl: string
  billingUrl: string
  updateCardUrl: string
  certificateCheckoutUrl: string
  laptopUrl: string
  // Window and prices
  windowOpen: boolean
  closesOn: string
  closesDay: string
  closesAt: string | null
  priceLocked: boolean
  price: number
  standardPrice: number
  standardMonthlyPrice: number | null
  certificatePrice: number
  // Learning
  progressPercent: number
  lessonsLeft: number
  nextLessonTitle: string
  lesson1Title: string
  lesson1Minutes: number | null
  weeksLeft: number
  weekPlan: string[]
  completedOn: string
  // Billing (receipts, notices)
  reference: string
  amount: number
  paidAt: string
  billingDay: string
  monthNumber: number
  nextChargeDate: string
  chargeDate: string
  cardLast4: string
  cardExpiry: string
  periodEnd: string
  graceDays: number
  graceEnds: string
  renewalSoon: boolean
  stopBillingOnComplete: boolean
  /** Pays month by month by bank transfer or OPay (no automatic renewal). */
  manualBilling: boolean
  // Certificate and graduates
  certificateUrl: string
  linkedinAddUrl: string
  laptopApplicationsOpen: boolean
  laptopDeadline: string
  nextProgramme: { title: string; slug: string; url: string; checkoutUrl: string; pairingReason: string | null } | null
  nextProgrammeLockEnds: string
  // Owner content
  founderAnecdote: string | null
  freeExercise: string | null
  proof: { text: string; attribution: string } | null
  /** Joined a programme on the ₦2,000-a-month Access Scholarship (price lock rules apply). */
  joinedOnScholarship: boolean
  /** 0 for the first send of a repeating step, 1 for the next... (rotates the wording). */
  occurrence: number
  // WhatsApp helpers
  resumeCode: string | null
  orderReference: string | null
}

/** Values an event already knows (a receipt's reference, the card on a renewal notice...). */
export type EventData = Partial<Pick<MessageData, 'reference' | 'amount' | 'paidAt' | 'chargeDate' | 'cardLast4' | 'cardExpiry'>>

const FRONTEND_URL = (process.env.FRONTEND_URL ?? 'https://skillsair.com').replace(/\/+$/, '')
const site = (path: string) => `${FRONTEND_URL}${path}`

function lagosDate(at: number | string | null | undefined, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }): string {
  if (at === null || at === undefined || at === '') return ''
  const time = typeof at === 'number' ? at : Date.parse(at)
  return Number.isFinite(time) ? new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Africa/Lagos' }).format(new Date(time)) : ''
}

function ordinal(day: number): string {
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'
  return `${day}${suffix}`
}

interface LessonRow { id: number; title: string; duration?: number | null; order: number; section: unknown }
interface SectionRow { id: number; title: string; order: number }

/** Progress, next lesson and a simple week-by-week plan for what's left (8 hours a week). */
async function learningStats(payload: Payload, userId: number, courseId: number) {
  const sections = (await payload.find({ collection: 'sections', where: { course: { equals: courseId } }, sort: 'order', limit: 500, depth: 0, overrideAccess: true })).docs as unknown as SectionRow[]
  const sectionOrder = new Map(sections.map((section) => [section.id, section]))
  const lessons = sections.length
    ? ((await payload.find({ collection: 'lessons', where: { and: [{ section: { in: sections.map((section) => section.id) } }, { isPublished: { equals: true } }] }, limit: 5000, depth: 0, overrideAccess: true })).docs as unknown as LessonRow[])
    : []
  lessons.sort((a, b) => {
    const sa = sectionOrder.get(Number(relationId(a.section)))?.order ?? 0
    const sb = sectionOrder.get(Number(relationId(b.section)))?.order ?? 0
    return sa - sb || a.order - b.order
  })
  const done = new Set(
    lessons.length
      ? (await payload.find({ collection: 'lesson-progress', where: { and: [{ student: { equals: userId } }, { lesson: { in: lessons.map((lesson) => lesson.id) } }, { isCompleted: { equals: true } }] }, limit: 5000, depth: 0, overrideAccess: true })).docs.map((doc) => Number(relationId(doc.lesson)))
      : [],
  )
  const remaining = lessons.filter((lesson) => !done.has(lesson.id))
  // Lesson durations are in seconds; when a course has none, assume 30 minutes a lesson.
  const minutes = (lesson: LessonRow) => (lesson.duration && lesson.duration > 0 ? lesson.duration / 60 : 30)
  const remainingMinutes = remaining.reduce((sum, lesson) => sum + minutes(lesson), 0)
  const weeksLeft = Math.max(1, Math.ceil(remainingMinutes / 480))
  const remainingSections: string[] = []
  for (const lesson of remaining) {
    const title = sectionOrder.get(Number(relationId(lesson.section)))?.title
    if (title && !remainingSections.includes(title)) remainingSections.push(title)
  }
  const perWeek = Math.max(1, Math.ceil(remainingSections.length / weeksLeft))
  const weekPlan: string[] = []
  for (let week = 0; week < weeksLeft && week * perWeek < remainingSections.length; week++) {
    weekPlan.push(`Week ${week + 1}: ${remainingSections.slice(week * perWeek, (week + 1) * perWeek).join(', ')}`)
  }
  const first = lessons[0]
  return {
    total: lessons.length,
    progressPercent: lessons.length ? Math.round((done.size / lessons.length) * 100) : 0,
    lessonsLeft: remaining.length,
    nextLessonTitle: remaining[0]?.title ?? first?.title ?? '',
    lesson1Title: first?.title ?? '',
    lesson1Minutes: first?.duration && first.duration > 0 ? Math.max(1, Math.round(first.duration / 60)) : null,
    weeksLeft,
    weekPlan,
  }
}

interface CourseRow {
  id: number
  title: string
  slug: string
  status?: string
  price?: number
  phoneFriendly?: boolean | null
  categories?: Array<number | { id: number; name?: string; freeExercise?: string | null }> | null
  nextProgrammes?: Array<{ programme?: number | { id: number; title?: string; slug?: string; status?: string }; pairingReason?: string | null }> | null
}

async function nextProgrammeFor(payload: Payload, course: CourseRow, excludeIds: number[]): Promise<MessageData['nextProgramme']> {
  const make = (title: string, slug: string, pairingReason: string | null) => ({
    title, slug, pairingReason, url: site(`/programmes/${encodeURIComponent(slug)}`), checkoutUrl: site(`/checkout?course=${encodeURIComponent(slug)}`),
  })
  for (const item of course.nextProgrammes ?? []) {
    const programme = typeof item.programme === 'object' ? item.programme : null
    if (programme?.slug && programme.title && programme.status === 'published' && !excludeIds.includes(programme.id)) return make(programme.title, programme.slug, item.pairingReason?.trim() || null)
  }
  const schoolId = Number(relationId(course.categories?.[0]))
  const candidates = (await payload.find({
    collection: 'courses',
    where: { and: [{ status: { equals: 'published' } }, { price: { greater_than: 0 } }, { id: { not_in: excludeIds } }] },
    limit: 200, depth: 0, overrideAccess: true, sort: 'title',
  })).docs as unknown as CourseRow[]
  const sameSchool = candidates.find((candidate) => (candidate.categories ?? []).some((category) => Number(relationId(category)) === schoolId))
  const pick = sameSchool ?? candidates.find((candidate) => candidate.phoneFriendly)
  return pick ? make(pick.title, pick.slug, null) : null
}

export async function buildMessageData(payload: Payload, person: LoadedPerson, stage: Stage, window: WindowState, extra: EventData = {}): Promise<MessageData> {
  const now = Date.now()
  const userId = person.user?.id
  const course = stage.courseId
    ? ((await payload.findByID({ collection: 'courses', id: stage.courseId, depth: 1, overrideAccess: true }).catch(() => null)) as unknown as CourseRow | null)
    : null
  const slug = course?.slug ?? ''
  const school = (course?.categories ?? []).find((category): category is { id: number; name?: string; freeExercise?: string | null } => typeof category === 'object' && category !== null)
  const explainer = careerExplainer(school?.name ?? '')
  const offer = await offerFor(payload, stage.courseId, userId)
  const resumeCode = person.lead?.resumeCode ?? null

  const learning = userId && stage.courseId && ['I', 'R', 'T', 'D', 'C'].includes(stage.track)
    ? await learningStats(payload, userId, stage.courseId).catch(() => null)
    : null

  let orderReference: string | null = null
  if (stage.subjectId.startsWith('order:')) {
    const order = await payload.findByID({ collection: 'orders', id: Number(stage.subjectId.slice(6)), depth: 0, overrideAccess: true }).catch(() => null)
    orderReference = order ? String(order.reference) : null
  }

  // The programme's current (or latest) subscription, for billing dates.
  const subscriptions = userId && stage.courseId
    ? ((await payload.find({ collection: 'subscriptions', where: { and: [{ user: { equals: userId } }, { course: { equals: stage.courseId } }] }, sort: '-createdAt', limit: 10, depth: 0, overrideAccess: true })).docs as unknown as Array<{ id: number; status: string; billing?: string | null; currentPeriodStart?: string; currentPeriodEnd?: string | null; lastFailedAt?: string | null; createdAt: string }>)
    : []
  const subscription = stage.subjectId.startsWith('sub:') ? subscriptions.find((item) => item.id === Number(stage.subjectId.slice(4))) ?? subscriptions[0] : subscriptions[0]
  const periodEnd = subscription?.currentPeriodEnd ?? null
  const firstStart = subscriptions.length ? Math.min(...subscriptions.map((item) => Date.parse(item.createdAt))) : now
  const manualBilling = subscription?.billing === 'manual'
  // Card: grace runs from the failed renewal. Month by month: from the end of the paid month.
  const graceEndsAt = subscription?.lastFailedAt
    ? Date.parse(subscription.lastFailedAt) + accessGraceDays() * 86_400_000
    : manualBilling && periodEnd ? Date.parse(periodEnd) + accessGraceDays() * 86_400_000 : null

  const enrollment = userId && stage.courseId
    ? ((await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: userId } }, { course: { equals: stage.courseId } }] }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as { id: number; completedAt?: string | null } | undefined)
    : undefined
  const certificate = userId && stage.courseId
    ? ((await payload.find({ collection: 'certificates', where: { and: [{ student: { equals: userId } }, { course: { equals: stage.courseId } }] }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as { certificateCode?: string } | undefined)
    : undefined
  const certificateUrl = certificate?.certificateCode ? site(`/certificates/verify/${certificate.certificateCode}`) : ''
  const completedOn = lagosDate(enrollment?.completedAt)
  const nextLockEnds = enrollment?.completedAt ? Date.parse(enrollment.completedAt) + nextProgrammeLockDays() * 86_400_000 : null

  const windowDoc = (await payload.findGlobal({ slug: 'scholarship-window', depth: 0, overrideAccess: true }).catch(() => null)) as { laptopApplicationsOpen?: boolean | null; laptopApplicationDeadline?: string | null } | null
  const emailContent = (await payload.findGlobal({ slug: 'email-content', depth: 0, overrideAccess: true }).catch(() => null)) as { founderAnecdote?: string | null; proofItems?: Array<{ text?: string; attribution?: string; approved?: boolean | null }> | null } | null
  const proof = (emailContent?.proofItems ?? []).find((item) => item.approved && item.text && item.attribution)
  const enrolledCourseIds = userId
    ? (await payload.find({ collection: 'enrollments', where: { student: { equals: userId } }, limit: 200, depth: 0, overrideAccess: true })).docs.map((doc) => Number(relationId(doc.course)))
    : []
  const nextProgramme = course && ['G', 'T', 'C'].includes(stage.track) ? await nextProgrammeFor(payload, course, [course.id, ...enrolledCourseIds]) : null
  const phoneFriendlyList = (await phoneFriendlyAlternatives(payload)).map((item) => item.title).join(', ')
  const renewalSoon = subscription?.status === 'active' && periodEnd !== null && Date.parse(periodEnd) - now < 5 * 86_400_000 && Date.parse(periodEnd) > now
  const certificateLink = certificateUrl || site('/dashboard/certificates')

  return {
    firstName: (person.user?.firstName || person.lead?.firstName || '').trim() || 'there',
    email: person.snapshot.email ?? '',
    programme: course?.title ?? 'your programme',
    programmeSlug: slug,
    school: school?.name ?? '',
    role: explainer.role || 'people in this field',
    careerExplainer: explainer.body,
    phoneFriendly: Boolean(course?.phoneFriendly),
    phoneFriendlyList,
    offerUrl: resumeCode ? site(`/r/${resumeCode}`) : slug ? site(`/apply/offer?programme=${encodeURIComponent(slug)}`) : site('/apply'),
    checkoutUrl: slug ? site(`/checkout?course=${encodeURIComponent(slug)}`) : site('/schools'),
    resumeCheckoutUrl: slug ? site(`/checkout?course=${encodeURIComponent(slug)}`) : site('/dashboard/subscription'),
    waitlistUrl: resumeCode ? site(`/r/${resumeCode}`) : slug ? site(`/apply/offer?programme=${encodeURIComponent(slug)}`) : site('/apply'),
    previewUrl: slug ? site(`/programmes/${encodeURIComponent(slug)}`) : site('/schools'),
    phoneFriendlyUrl: site('/schools'),
    dashboardUrl: site('/dashboard'),
    resumeUrl: slug ? site(`/dashboard/courses/${encodeURIComponent(slug)}/learn`) : site('/dashboard/courses'),
    firstLessonUrl: slug ? site(`/dashboard/courses/${encodeURIComponent(slug)}/learn`) : site('/dashboard/courses'),
    billingUrl: site('/dashboard/subscription'),
    updateCardUrl: site(`/billing/update-card${subscription ? `?subscription=${subscription.id}` : ''}`),
    certificateCheckoutUrl: slug ? site(`/checkout?certificate=${encodeURIComponent(slug)}`) : site('/dashboard/certificates'),
    laptopUrl: site('/dashboard/laptop-support'),
    windowOpen: window.open,
    closesOn: window.closesAt !== null ? formatLagosDate(new Date(window.closesAt).toISOString()) : '',
    closesDay: window.closesAt !== null ? lagosDate(window.closesAt, { weekday: 'long', day: 'numeric', month: 'long' }) : '',
    closesAt: window.closesAt !== null ? new Date(window.closesAt).toISOString() : null,
    priceLocked: Boolean(offer?.priceLocked),
    price: offer?.price ?? 2000,
    standardPrice: offer?.standardPrice ?? 100000,
    standardMonthlyPrice: offer?.standardMonthlyPrice ?? null,
    certificatePrice: certificatePrice(),
    progressPercent: learning?.progressPercent ?? 0,
    lessonsLeft: learning?.lessonsLeft ?? 0,
    nextLessonTitle: learning?.nextLessonTitle ?? '',
    lesson1Title: learning?.lesson1Title ?? '',
    lesson1Minutes: learning?.lesson1Minutes ?? null,
    weeksLeft: learning?.weeksLeft ?? 1,
    weekPlan: learning?.weekPlan ?? [],
    completedOn,
    reference: extra.reference ?? orderReference ?? '',
    amount: extra.amount ?? offer?.price ?? 2000,
    paidAt: extra.paidAt ?? lagosDate(now),
    billingDay: periodEnd ? ordinal(Number(lagosDate(periodEnd, { day: 'numeric' }))) : '',
    monthNumber: Math.max(1, Math.floor((now - firstStart) / (30 * 86_400_000)) + 1),
    nextChargeDate: lagosDate(periodEnd),
    chargeDate: extra.chargeDate ?? lagosDate(periodEnd),
    cardLast4: extra.cardLast4 ?? '',
    cardExpiry: extra.cardExpiry ?? '',
    periodEnd: lagosDate(periodEnd),
    graceDays: accessGraceDays(),
    graceEnds: lagosDate(graceEndsAt, { weekday: 'long', day: 'numeric', month: 'long' }),
    renewalSoon,
    stopBillingOnComplete: stopBillingOnComplete(),
    manualBilling,
    certificateUrl: certificateLink,
    linkedinAddUrl: `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${encodeURIComponent(course?.title ?? 'SkillsAir programme')}&organizationName=SkillsAir&certUrl=${encodeURIComponent(certificateLink)}${certificate?.certificateCode ? `&certId=${encodeURIComponent(certificate.certificateCode)}` : ''}`,
    laptopApplicationsOpen: Boolean(windowDoc?.laptopApplicationsOpen),
    laptopDeadline: lagosDate(windowDoc?.laptopApplicationDeadline),
    nextProgramme,
    nextProgrammeLockEnds: nextLockEnds && nextLockEnds > now ? lagosDate(nextLockEnds, { weekday: 'long', day: 'numeric', month: 'long' }) : '',
    founderAnecdote: emailContent?.founderAnecdote?.trim() || null,
    freeExercise: school?.freeExercise?.trim() || null,
    proof: proof ? { text: String(proof.text), attribution: String(proof.attribution) } : null,
    joinedOnScholarship: userId ? await hasPriceLock(payload, userId) : false,
    occurrence: Number(/#(\d+)$/.exec(stage.subjectId)?.[1] ?? 0),
    resumeCode,
    orderReference,
  }
}
