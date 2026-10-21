/**
 * Programme edit view panels (brief 7.6), as `ui` fields:
 * CourseOutline (Curriculum tab: sections → lessons with durations and a total),
 * CoursePricing (Pricing tab: what learners will see, in plain words),
 * CourseReadyChecklist (sidebar: "Ready to publish", the same score as the list's ring),
 * ViewOnSite (beside Save: opens FRONTEND_URL/programmes/{slug}).
 * Server components; programmes are readable by admins and instructors, who may see all of this.
 */
import React from 'react'
import type { UIFieldServerProps } from 'payload'
import { Check, ExternalLink, X } from 'lucide-react'
import { EmptyState, ProgressRing } from '../ui/primitives'
import { isStaff } from '../data/auth'
import { formatNaira } from '../format'
import { certificatePrice, getScholarshipWindow, windowIsOpen } from '../../lib/pricing'
import { readinessItems } from '../cells/cells'

type Props = UIFieldServerProps
type Course = Record<string, unknown> & { id?: number; slug?: string }

const minutes = (seconds: number) => {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

async function outline(props: Props) {
  const sections = await props.payload.find({ collection: 'sections', where: { course: { equals: props.id } }, sort: 'order', limit: 200, depth: 0, pagination: false, overrideAccess: true, select: { title: true, order: true } as never })
  const ids = (sections.docs as unknown as Array<{ id: number }>).map((s) => s.id)
  const lessons = ids.length
    ? await props.payload.find({ collection: 'lessons', where: { section: { in: ids } }, sort: 'order', limit: 2000, depth: 0, pagination: false, overrideAccess: true, select: { title: true, section: true, duration: true, isFree: true, isPublished: true } as never })
    : { docs: [] }
  return {
    sections: sections.docs as unknown as Array<{ id: number; title: string; order: number }>,
    lessons: lessons.docs as unknown as Array<{ id: number; title: string; section: number; duration?: number; isFree?: boolean; isPublished?: boolean }>,
  }
}

export async function CourseOutline(props: Props) {
  if (!isStaff(props.req) || !props.id) return null
  const { sections, lessons } = await outline(props)
  if (!sections.length)
    return (
      <EmptyState icon={<X size={22} strokeWidth={1.75} />} title="No sections yet" action={{ href: `/admin/collections/sections/create`, label: 'Add the first section' }}>
        Add a section, then lessons inside it. The outline appears here.
      </EmptyState>
    )
  const total = lessons.reduce((sum, l) => sum + Number(l.duration ?? 0), 0)
  return (
    <div className="sa-outline">
      <p className="sa-outline__total">
        {sections.length} sections · {lessons.length} lessons{total ? ` · ${minutes(total)} in total` : ''}
      </p>
      <ol className="sa-outline__sections">
        {sections.map((section) => {
          const mine = lessons.filter((l) => l.section === section.id)
          const sectionTotal = mine.reduce((sum, l) => sum + Number(l.duration ?? 0), 0)
          return (
            <li key={section.id}>
              <a className="sa-outline__section" href={`/admin/collections/sections/${section.id}`}>
                <span className="sa-order-badge">{section.order}</span>
                <span>{section.title}</span>
                <span className="sa-muted">
                  {mine.length} lessons{sectionTotal ? ` · ${minutes(sectionTotal)}` : ''}
                </span>
              </a>
              {mine.length ? (
                <ol className="sa-outline__lessons">
                  {mine.map((lesson) => (
                    <li key={lesson.id}>
                      <a href={`/admin/collections/lessons/${lesson.id}`}>{lesson.title}</a>
                      <span className="sa-outline__meta">
                        {lesson.isFree ? <span className="sa-chip-sm sa-chip-sm--accent">Free preview</span> : null}
                        {!lesson.isPublished ? <span className="sa-chip-sm">Draft</span> : null}
                        {lesson.duration ? <span className="sa-muted">{minutes(Number(lesson.duration))}</span> : null}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="sa-outline__empty">No lessons in this section yet.</p>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export async function CoursePricing(props: Props) {
  if (!isStaff(props.req)) return null
  const course = (props.data ?? {}) as Course
  const price = Number(course.price ?? 0)
  const standard = course.standardPrice ? Number(course.standardPrice) : null
  const monthly = course.standardMonthlyPrice ? Number(course.standardMonthlyPrice) : null
  const open = windowIsOpen(await getScholarshipWindow(props.payload).catch(() => null))
  const parts = [
    price ? `Scholarship ${formatNaira(price)}/month` : 'Free',
    standard ? `Standard ${monthly ? `${formatNaira(monthly)}/month or ` : ''}${formatNaira(standard)}${monthly ? ' once' : ''}` : null,
    `Certificate ${formatNaira(certificatePrice())} (shown to learners only when they finish)`,
  ].filter(Boolean)
  return (
    <div className="sa-callout sa-callout--info">
      <div>
        <p className="sa-callout__title">What learners will see</p>
        <p className="sa-pricing-line">{parts.join(' · ')}</p>
        <p className="sa-muted">
          Right now the scholarship window is <strong>{open ? 'open' : 'closed'}</strong>, so new learners pay {open || !standard ? `${formatNaira(price)} a month` : `the standard fee`}.
          Designed to take about {String(course.durationMonths ?? 3)} months at about {String(course.weeklyHours ?? 8)} hours a week.
        </p>
      </div>
    </div>
  )
}

export async function CourseReadyChecklist(props: Props) {
  if (!isStaff(props.req)) return null
  const course = (props.data ?? {}) as Course
  let facts: { sectionsWithLessons: number; scholarshipPlan: boolean } | undefined
  if (props.id) {
    const [sections, plans] = await Promise.all([
      props.payload.find({ collection: 'sections', where: { course: { equals: props.id } }, limit: 200, depth: 0, pagination: false, overrideAccess: true, select: { id: true } as never }),
      props.payload.count({ collection: 'plans', where: { and: [{ course: { equals: props.id } }, { kind: { equals: 'scholarship' } }, { isActive: { equals: true } }] }, overrideAccess: true }),
    ])
    const sectionIds = (sections.docs as unknown as Array<{ id: number }>).map((s) => s.id)
    const withLessons = sectionIds.length
      ? new Set(((await props.payload.find({ collection: 'lessons', where: { section: { in: sectionIds } }, limit: 2000, depth: 0, pagination: false, overrideAccess: true, select: { section: true } as never })).docs as unknown as Array<{ section: number }>).map((l) => l.section)).size
      : 0
    facts = { sectionsWithLessons: withLessons, scholarshipPlan: plans.totalDocs > 0 }
  }
  const items = readinessItems(course, facts)
  const done = items.filter((i) => i.done).length
  return (
    <section className="sa-ready" aria-labelledby="sa-ready-title">
      <div className="sa-ready__head">
        <ProgressRing value={(done / items.length) * 100} size={44} label="Ready to publish" />
        <div>
          <h3 id="sa-ready-title" className="sa-ready__title">
            Ready to publish
          </h3>
          <p className="sa-muted sa-ready__count">
            {done} of {items.length} done
          </p>
        </div>
      </div>
      <ul className="sa-ready__list">
        {items.map((item) => (
          <li key={item.key} className={item.done ? 'sa-ready__item--done' : 'sa-ready__item--todo'}>
            {item.done ? <Check size={14} strokeWidth={2.5} aria-hidden /> : <X size={14} strokeWidth={2.5} aria-hidden />}
            <span>
              {item.label}
              <span className="sa-visually-hidden">{item.done ? ': done' : ': to do'}</span>
            </span>
            {!item.done ? <span className="sa-ready__where">{item.tab} tab</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** `edit.beforeDocumentControls` on programmes (receives the id, not the data, so it reads the slug). */
export async function ViewOnSite(props: { id?: number | string; payload: UIFieldServerProps['payload'] }) {
  if (!props.id) return null
  const course = (await props.payload.findByID({ collection: 'courses', id: props.id, depth: 0, select: { slug: true, status: true } as never, disableErrors: true, overrideAccess: true })) as unknown as Course | null
  const slug = course?.slug
  if (!slug) return null
  const base = (process.env.FRONTEND_URL ?? 'https://skillsair.com').split(',')[0]!.replace(/\/$/, '')
  return (
    <a className="sa-button sa-button--secondary sa-button--sm" href={`${base}/programmes/${slug}`} target="_blank" rel="noreferrer noopener">
      <ExternalLink size={14} strokeWidth={2} aria-hidden /> View on site
    </a>
  )
}
