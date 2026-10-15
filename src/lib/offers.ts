import type { Payload } from 'payload'
import { certificatePrice, effectiveCoursePrice, getScholarshipWindow, windowIsOpen } from './pricing.js'

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
  price: number
  standardPrice: number
  standardMonthlyPrice: number | null
  effectivePrice: number
  windowOpen: boolean
  closesAt: string | null
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

export async function buildOffer(payload: Payload, course: OfferCourseDoc): Promise<Offer> {
  const window = await getScholarshipWindow(payload)
  const open = windowIsOpen(window)
  const school = (course.categories ?? []).find(
    (category): category is { id: number; name?: string; slug?: string } => typeof category === 'object' && category !== null,
  )
  const standardPrice = course.standardPrice ?? course.price
  return {
    courseId: course.id,
    slug: course.slug,
    programme: course.title,
    school: school?.name ?? '',
    schoolSlug: school?.slug ?? '',
    price: course.price,
    standardPrice,
    standardMonthlyPrice: course.standardMonthlyPrice ?? null,
    effectivePrice: effectiveCoursePrice(course, open),
    windowOpen: open,
    closesAt: open ? window.closesAt ?? null : null,
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
