import type { Payload } from 'payload'
import { certificatePrice, getScholarshipWindow, oneOffCoursePrice, windowIsOpen } from './pricing.js'
import { NO_LOCK, getPriceLock, type PriceLockReason } from './price-lock.js'

export interface OfferCourseDoc {
  id: number
  title: string
  slug: string
  status: 'draft' | 'published'
  price: number
  standardPrice?: number | null
  standardMonthlyPrice?: number | null
  durationMonths?: number | null
  weeklyHours?: number | null
  phoneFriendly?: boolean | null
  requirements?: Array<{ requirement?: string | null }> | null
  objectives?: Array<{ objective?: string | null }> | null
  categories?: Array<number | { id: number; name?: string; slug?: string }> | null
}

export interface Offer {
  courseId: number
  slug: string
  programme: string
  school: string
  schoolSlug: string
  /** Access Scholarship price per month (charged monthly while subscribed). */
  price: number
  /** Standard fee, paid once. */
  standardPrice: number
  standardMonthlyPrice: number | null
  /** What a new learner pays now: the monthly scholarship price, or the one-off standard fee. */
  effectivePrice: number
  /** "monthly" while a window is open (scholarship plan), otherwise "once". */
  billing: 'monthly' | 'once'
  /** Plan to subscribe to for the ₦2,000/month scholarship (null if not set up yet). */
  scholarshipPlanId: number | null
  /** Standard monthly plan (₦40,000/month), offered when no window is open. */
  standardPlanId: number | null
  windowOpen: boolean
  closesAt: string | null
  /** The learner keeps ₦2,000 a month regardless of the window (see price-lock.ts). */
  priceLocked: boolean
  priceLockReason: PriceLockReason | null
  /** Only for next_programme: start before this to keep the rate. */
  priceLockEndsAt: string | null
  cohortLabel: string
  durationMonths: number
  weeklyHours: number
  requirements: string[]
  objectives: string[]
  phoneFriendly: boolean
  phoneFriendlyAlternatives: Array<{ title: string; slug: string }>
  certificatePrice: number
  laptopsPerCohort: number
}

export async function findPublishedCourseBySlug(payload: Payload, slug: string): Promise<OfferCourseDoc | null> {
  const result = await payload.find({
    collection: 'courses',
    where: { and: [{ slug: { equals: slug } }, { status: { equals: 'published' } }] },
    limit: 1,
    depth: 1,
    overrideAccess: true,
  })
  return (result.docs[0] as unknown as OfferCourseDoc | undefined) ?? null
}

export async function phoneFriendlyAlternatives(payload: Payload, excludeId?: number): Promise<Array<{ title: string; slug: string }>> {
  const result = await payload.find({
    collection: 'courses',
    where: {
      and: [
        { status: { equals: 'published' } },
        { phoneFriendly: { equals: true } },
        ...(excludeId ? [{ id: { not_equals: excludeId } }] : []),
      ],
    },
    sort: 'title',
    limit: 8,
    depth: 0,
    overrideAccess: true,
  })
  return (result.docs as unknown as OfferCourseDoc[]).map((course) => ({ title: course.title, slug: course.slug }))
}

interface PlanRow {
  id: number
  price: number
  interval: 'monthly' | 'annually'
  kind?: 'scholarship' | 'standard' | null
  paystackPlanCode?: string | null
}

async function coursePlans(payload: Payload, courseId: number): Promise<PlanRow[]> {
  const result = await payload.find({
    collection: 'plans',
    where: { and: [{ course: { equals: courseId } }, { isActive: { equals: true } }, { interval: { equals: 'monthly' } }] },
    limit: 20,
    depth: 0,
    overrideAccess: true,
  })
  return (result.docs as unknown as PlanRow[]).filter((plan) => Boolean(plan.paystackPlanCode))
}

/** `userId` (when known) lets a price-locked learner see ₦2,000 a month with the window closed. */
export async function buildOffer(payload: Payload, course: OfferCourseDoc, userId?: number): Promise<Offer> {
  const window = await getScholarshipWindow(payload)
  const open = windowIsOpen(window)
  const plans = await coursePlans(payload, course.id)
  const scholarshipPlan = plans.find((plan) => plan.kind === 'scholarship')
  const standardPlan = plans.find((plan) => plan.kind !== 'scholarship')
  const monthlyScholarship = scholarshipPlan?.price ?? course.price
  const school = (course.categories ?? []).find(
    (category): category is { id: number; name?: string; slug?: string } => typeof category === 'object' && category !== null,
  )
  const standardPrice = oneOffCoursePrice(course)
  const lock = userId ? await getPriceLock(payload, userId, course.id) : NO_LOCK
  const scholarshipOn = (open || lock.locked) && Boolean(scholarshipPlan)
  return {
    courseId: course.id,
    slug: course.slug,
    programme: course.title,
    school: school?.name ?? '',
    schoolSlug: school?.slug ?? '',
    price: monthlyScholarship,
    standardPrice,
    standardMonthlyPrice: standardPlan?.price ?? course.standardMonthlyPrice ?? null,
    effectivePrice: scholarshipOn ? monthlyScholarship : standardPrice,
    billing: scholarshipOn ? 'monthly' : 'once',
    scholarshipPlanId: scholarshipPlan?.id ?? null,
    standardPlanId: standardPlan?.id ?? null,
    windowOpen: open,
    closesAt: open ? window.closesAt ?? null : null,
    priceLocked: lock.locked && Boolean(scholarshipPlan),
    priceLockReason: lock.locked && scholarshipPlan ? lock.reason : null,
    priceLockEndsAt: lock.locked && scholarshipPlan ? lock.endsAt : null,
    cohortLabel: window.cohortLabel ?? '',
    durationMonths: course.durationMonths ?? 3,
    weeklyHours: course.weeklyHours ?? 8,
    requirements: (course.requirements ?? []).map((item) => item.requirement ?? '').filter(Boolean),
    objectives: (course.objectives ?? []).map((item) => item.objective ?? '').filter(Boolean),
    phoneFriendly: Boolean(course.phoneFriendly),
    phoneFriendlyAlternatives: course.phoneFriendly ? [] : await phoneFriendlyAlternatives(payload, course.id),
    certificatePrice: certificatePrice(),
    laptopsPerCohort: window.laptopsPerCohort ?? 2,
  }
}
