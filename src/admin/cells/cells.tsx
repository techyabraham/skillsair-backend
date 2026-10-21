/**
 * List-table cells (brief 7.5–7.12), registered per field with `admin.components.Cell`.
 * Server components. They format the row Payload already loaded (depth 0, all fields); where a
 * related name is needed they use the per-page batch loader (one query per collection per page,
 * never per row). Name lookups only appear on admin-only lists (applicants, orders,
 * subscriptions). Status is always text plus an icon, never colour alone.
 */
import React from 'react'
import type { DefaultServerCellComponentProps } from 'payload'
import { BadgeCheck, CircleHelp, FileText, Lock, PlayCircle, Smartphone } from 'lucide-react'
import { Avatar, Money, ProgressRing, StatusPill, type Tone } from '../ui/primitives'
import { docLoader, relId, batchLoader } from '../data/batch'
import { formatDay, formatRelative, formatAbsolute, maskPhone, personName } from '../format'
import { accessGraceDays } from '../../lib/billing'
import { CopyButton } from './CopyButton'

type CellProps = DefaultServerCellComponentProps

/** First-column cells must still open the record, like Payload's default cell. */
function MaybeLink({ props, children }: { props: CellProps; children: React.ReactNode }) {
  if (!props.link) return <>{children}</>
  if (!props.linkURL && props.rowData?.id === undefined) return <>{children}</>
  const href = props.linkURL ?? `/admin/collections/${props.collectionSlug}/${props.rowData?.id}`
  return (
    <a className="sa-cell__link" href={href}>
      {children}
    </a>
  )
}

const empty = <span className="sa-muted">–</span>

/* ------------------------------------------------------------------ generic */

export function RelativeDateCell(props: CellProps) {
  const value = props.cellData as string | null
  if (!value) return empty
  return (
    <time dateTime={value} title={formatAbsolute(value)} className="sa-cell__time">
      {formatRelative(value)}
    </time>
  )
}

export function MoneyCell(props: CellProps) {
  const value = props.cellData as number | null
  return value === null || value === undefined ? empty : <Money amount={value} />
}

/* ------------------------------------------------------------------ applicants (admin only) */

const LEAD_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'info' },
  contacted: { label: 'Contacted', tone: 'neutral' },
  offer_viewed: { label: 'Offer viewed', tone: 'accent' },
  account_created: { label: 'Account', tone: 'caution' },
  paid: { label: 'Paid', tone: 'positive' },
  lost: { label: 'Lost', tone: 'neutral' },
}

export function LeadStatusCell(props: CellProps) {
  const status = LEAD_STATUS[String(props.cellData)] ?? { label: String(props.cellData ?? '–'), tone: 'neutral' as Tone }
  return <StatusPill tone={status.tone}>{status.label}</StatusPill>
}

export function ScoreCell(props: CellProps) {
  const score = Math.max(0, Math.min(100, Number(props.cellData ?? 0)))
  return (
    <span className="sa-score" role="img" aria-label={`Score ${score} out of 100`}>
      <span className="sa-score__track" aria-hidden="true">
        <span style={{ width: `${score}%` }} />
      </span>
      <span className="sa-score__value" aria-hidden="true">
        {score}
      </span>
    </span>
  )
}

export function NeedsHumanCell(props: CellProps) {
  if (!props.cellData) return <span className="sa-visually-hidden">No</span>
  return (
    <span className="sa-needs-reply">
      <span className="sa-needs-reply__dot" aria-hidden="true" />
      Needs reply
    </span>
  )
}

export function MaskedPhoneCell(props: CellProps) {
  const phone = props.cellData as string | null
  return phone ? (
    <span className="sa-mono" title="Open the record to see the full number">
      {maskPhone(phone)}
    </span>
  ) : (
    empty
  )
}

export function LeadNameCell(props: CellProps) {
  const name = String(props.cellData ?? 'Applicant')
  return (
    <MaybeLink props={props}>
      <span className="sa-person">
        <Avatar name={name} size={28} />
        <span className="sa-person__name">{name}</span>
      </span>
    </MaybeLink>
  )
}

/** Programme with its school chip (applicants list; programmes and schools are public data). */
export async function ProgrammeSchoolCell(props: CellProps) {
  const courseId = relId(props.cellData)
  const schoolId = relId((props.rowData as Record<string, unknown>)?.school)
  const [course, school] = await Promise.all([
    docLoader<{ title?: string }>(props.payload, 'courses', { title: true }).load(courseId),
    docLoader<{ name?: string }>(props.payload, 'categories', { name: true }).load(schoolId),
  ])
  if (!course && !school) return empty
  return (
    <span className="sa-cell__stack">
      <span>{course?.title ?? 'No programme'}</span>
      {school?.name ? <span className="sa-chip-sm">{school.name.replace(/^School of /, '')}</span> : null}
    </span>
  )
}

/* ------------------------------------------------------------------ programmes */

export async function ProgrammeTitleCell(props: CellProps) {
  const row = (props.rowData ?? {}) as Record<string, unknown>
  const thumbId = relId(row.thumbnail)
  const categoryIds = (Array.isArray(row.categories) ? row.categories : []).map(relId).filter(Boolean)
  const [thumb, ...schools] = await Promise.all([
    docLoader<{ url?: string; sizes?: { thumbnail?: { url?: string } }; alt?: string }>(props.payload, 'media', { url: true, sizes: true, alt: true }).load(thumbId),
    ...categoryIds.map((id) => docLoader<{ name?: string }>(props.payload, 'categories', { name: true }).load(id)),
  ])
  const src = thumb?.sizes?.thumbnail?.url ?? thumb?.url
  return (
    <MaybeLink props={props}>
      <span className="sa-programme-cell">
        {src ? <img className="sa-thumb" src={src} alt="" width={40} height={40} loading="lazy" /> : <span className="sa-thumb sa-thumb--empty" aria-hidden="true" />}
        <span className="sa-cell__stack">
          <span className="sa-programme-cell__title">{String(props.cellData ?? 'Untitled')}</span>
          <span className="sa-cell__chips">
            {schools.filter(Boolean).map((school) => (
              <span key={(school as { name?: string }).name} className="sa-chip-sm">
                {(school as { name?: string }).name?.replace(/^School of /, '')}
              </span>
            ))}
            {row.phoneFriendly ? (
              <span className="sa-chip-sm sa-chip-sm--accent">
                <Smartphone size={11} strokeWidth={2} aria-hidden /> Phone-friendly
              </span>
            ) : null}
          </span>
        </span>
      </span>
    </MaybeLink>
  )
}

export function PublishStatusCell(props: CellProps) {
  const value = props.cellData
  const published = value === 'published' || value === true
  return <StatusPill tone={published ? 'positive' : 'neutral'}>{published ? 'Published' : 'Draft'}</StatusPill>
}

export function ProgrammePricesCell(props: CellProps) {
  const row = (props.rowData ?? {}) as Record<string, number | null | undefined>
  const chips = [
    row.price ? <Money key="s" amount={row.price} /> : null,
    row.standardMonthlyPrice ? <Money key="m" amount={row.standardMonthlyPrice} /> : null,
    row.standardPrice ? <Money key="o" amount={row.standardPrice} /> : null,
  ]
  return (
    <span className="sa-cell__chips">
      {row.price ? (
        <span className="sa-chip-sm" title="Access Scholarship, per month">
          <span>{chips[0]}/mo</span>
        </span>
      ) : (
        <span className="sa-chip-sm">Free</span>
      )}
      {row.standardMonthlyPrice ? (
        <span className="sa-chip-sm" title="Standard, per month">
          <span>{chips[1]}/mo</span>
        </span>
      ) : null}
      {row.standardPrice ? (
        <span className="sa-chip-sm" title="Standard, one payment">
          {chips[2]}
        </span>
      ) : null}
    </span>
  )
}

export interface CourseReadiness {
  sectionsWithLessons: number
  scholarshipPlan: boolean
}

/** Sections-with-lessons and scholarship-plan facts for many programmes, in one SQL query. */
export function readinessLoader(payload: CellProps['payload']) {
  return batchLoader<CourseReadiness>('readiness', async (ids) => {
    const { sql } = await import('@payloadcms/db-postgres')
    const numeric = ids.map(Number).filter(Number.isFinite)
    if (!numeric.length) return new Map()
    const db = payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<{ rows: Array<Record<string, unknown>> }> } }
    const { rows } = await db.drizzle.execute(sql`
      SELECT c.id,
        (SELECT count(DISTINCT s.id)::int FROM sections s JOIN lessons l ON l.section_id = s.id WHERE s.course_id = c.id) AS sections,
        EXISTS (SELECT 1 FROM plans p WHERE p.course_id = c.id AND p.kind = 'scholarship' AND p.is_active) AS plan
      FROM courses c WHERE c.id IN (${sql.join(numeric.map((id) => sql`${id}`), sql`, `)})
    `)
    return new Map(rows.map((row) => [String(row.id), { sectionsWithLessons: Number(row.sections), scholarshipPlan: Boolean(row.plan) }]))
  })
}

export interface ReadinessItem {
  key: string
  label: string
  done: boolean
  tab: string
}

/** The "Ready to publish" checklist (brief 7.6); also drives the list's completeness ring. */
export function readinessItems(doc: Record<string, unknown>, facts: CourseReadiness | undefined): ReadinessItem[] {
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0)
  return [
    { key: 'thumbnail', label: 'Thumbnail', done: Boolean(relId(doc.thumbnail)), tab: 'Overview' },
    { key: 'short', label: 'Short description', done: typeof doc.shortDescription === 'string' && doc.shortDescription.trim().length > 0, tab: 'Overview' },
    { key: 'objectives', label: 'At least 3 objectives', done: count(doc.objectives) >= 3, tab: 'Outcomes' },
    { key: 'requirements', label: 'Requirements', done: count(doc.requirements) > 0, tab: 'Outcomes' },
    { key: 'sections', label: 'A section with lessons', done: (facts?.sectionsWithLessons ?? 0) > 0, tab: 'Curriculum' },
    { key: 'plan', label: 'Scholarship plan exists', done: Boolean(facts?.scholarshipPlan), tab: 'Pricing' },
    { key: 'school', label: 'School set', done: count(doc.categories) > 0, tab: 'Overview' },
  ]
}

export async function CompletenessCell(props: CellProps) {
  const row = (props.rowData ?? {}) as Record<string, unknown>
  if (row.id === undefined) return empty
  const facts = await readinessLoader(props.payload).load(row.id as number)
  const items = readinessItems(row, facts)
  const done = items.filter((i) => i.done).length
  const missing = items.filter((i) => !i.done).map((i) => i.label)
  return (
    <span className="sa-cell__ring" title={missing.length ? `Missing: ${missing.join(', ')}` : 'Ready to publish'}>
      <ProgressRing value={(done / items.length) * 100} size={32} stroke={3} label={`Ready to publish, ${done} of ${items.length}`} />
      <span className="sa-visually-hidden">{missing.length ? `Missing: ${missing.join(', ')}` : 'Ready'}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ learners */

const ROLE: Record<string, { label: string; tone: Tone }> = {
  admin: { label: 'Admin', tone: 'info' },
  instructor: { label: 'Instructor', tone: 'positive' },
  student: { label: 'Learner', tone: 'neutral' },
}

export function RoleCell(props: CellProps) {
  const role = ROLE[String(props.cellData)] ?? { label: String(props.cellData ?? '–'), tone: 'neutral' as Tone }
  return <StatusPill tone={role.tone} icon={false}>{role.label}</StatusPill>
}

export function LearnerCell(props: CellProps) {
  const row = (props.rowData ?? {}) as Record<string, unknown>
  const name = personName(row as never)
  return (
    <MaybeLink props={props}>
      <span className="sa-person">
        <Avatar name={name} size={32} />
        <span className="sa-cell__stack">
          <span className="sa-person__name">
            {name}
            {row.isVerified ? <BadgeCheck className="sa-person__verified" size={14} strokeWidth={2} aria-label="Verified email" /> : null}
          </span>
          {name !== row.email ? <span className="sa-muted sa-cell__small">{String(row.email ?? '')}</span> : null}
        </span>
      </span>
    </MaybeLink>
  )
}

/** Active subscriptions per learner: one grouped query for the page (users list is admin-only beyond oneself). */
export async function ActiveSubscriptionsCell(props: CellProps) {
  const userId = props.rowData?.id
  if (userId === undefined) return empty
  const counts = batchLoader<number>('active-subs', async (ids) => {
    const result = await props.payload.find({
      collection: 'subscriptions',
      where: { and: [{ user: { in: ids } }, { status: { in: ['active', 'past_due'] } }] },
      limit: 1000,
      depth: 0,
      pagination: false,
      overrideAccess: true,
      select: { user: true } as never,
    })
    const map = new Map<string, number>()
    for (const doc of result.docs as unknown as Array<{ user: number }>) map.set(String(doc.user), (map.get(String(doc.user)) ?? 0) + 1)
    return map
  })
  const n = (await counts.load(userId)) ?? 0
  return n ? <StatusPill tone="positive" icon={false}>{n} active</StatusPill> : <span className="sa-muted">None</span>
}

/* ------------------------------------------------------------------ revenue (admin only) */

const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  success: { label: 'Success', tone: 'positive' },
  pending: { label: 'Pending', tone: 'caution' },
  failed: { label: 'Failed', tone: 'critical' },
  refunded: { label: 'Refunded', tone: 'neutral' },
}

export function OrderStatusCell(props: CellProps) {
  const s = ORDER_STATUS[String(props.cellData)] ?? { label: String(props.cellData ?? '–'), tone: 'neutral' as Tone }
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>
}

const ORDER_TYPE: Record<string, string> = { subscription: 'Subscription', certificate: 'Certificate', course: 'Programme' }

export function OrderTypeCell(props: CellProps) {
  const type = String(props.cellData ?? '')
  return (
    <StatusPill tone={type === 'certificate' ? 'accent' : type === 'course' ? 'info' : 'neutral'} icon={false}>
      {ORDER_TYPE[type] ?? type}
    </StatusPill>
  )
}

export function ReferenceCell(props: CellProps) {
  const reference = String(props.cellData ?? '')
  return (
    <span className="sa-reference">
      <MaybeLink props={props}>
        <span className="sa-mono">{reference}</span>
      </MaybeLink>
      {reference ? <CopyButton value={reference} label="Copy Paystack reference" /> : null}
    </span>
  )
}

/** Learner name for orders and subscriptions (both admin-only lists beyond a person's own rows). */
export async function PersonCell(props: CellProps) {
  const user = await docLoader<{ firstName?: string; lastName?: string; email?: string }>(props.payload, 'users', { firstName: true, lastName: true, email: true }).load(relId(props.cellData))
  if (!user) return empty
  const name = personName(user)
  return (
    <a className="sa-person sa-cell__plain-link" href={`/admin/collections/users/${relId(props.cellData)}`}>
      <Avatar name={name} size={24} />
      <span>{name}</span>
    </a>
  )
}

const SUB_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'positive' },
  past_due: { label: 'Past due', tone: 'critical' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
}

export function SubscriptionStatusCell(props: CellProps) {
  const s = SUB_STATUS[String(props.cellData)] ?? { label: String(props.cellData ?? '–'), tone: 'neutral' as Tone }
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>
}

export async function PlanKindCell(props: CellProps) {
  const plan = await docLoader<{ kind?: string; price?: number; interval?: string }>(props.payload, 'plans', { kind: true, price: true, interval: true }).load(relId(props.cellData))
  if (!plan) return empty
  const scholarship = plan.kind === 'scholarship'
  return (
    <span className={`sa-chip-sm${scholarship ? ' sa-chip-sm--accent' : ''}`}>
      {scholarship ? 'Scholarship' : 'Standard'}
      <span>
        <Money amount={plan.price} />
        {plan.interval === 'annually' ? '/yr' : '/mo'}
      </span>
    </span>
  )
}

export function RenewalCell(props: CellProps) {
  const row = (props.rowData ?? {}) as { status?: string; currentPeriodEnd?: string; lastFailedAt?: string; priceLocked?: boolean }
  const locked = row.priceLocked ? (
    <span className="sa-lock" title="Locked at the Access Scholarship rate">
      <Lock size={12} strokeWidth={2.25} aria-hidden /> <span className="sa-visually-hidden">Locked rate</span>
    </span>
  ) : null
  if (row.status === 'past_due' && row.lastFailedAt) {
    const ends = new Date(new Date(row.lastFailedAt).getTime() + accessGraceDays() * 86_400_000)
    return (
      <span className="sa-renewal sa-renewal--critical">
        Grace ends {formatDay(ends)} {locked}
      </span>
    )
  }
  if (row.status === 'active' && row.currentPeriodEnd) {
    return (
      <span className="sa-renewal">
        Renews {formatDay(row.currentPeriodEnd)} {locked}
      </span>
    )
  }
  if (row.status === 'cancelled' && row.currentPeriodEnd) {
    return (
      <span className="sa-renewal sa-muted">
        Access until {formatDay(row.currentPeriodEnd)} {locked}
      </span>
    )
  }
  return locked ?? empty
}

export function PlanKindValueCell(props: CellProps) {
  const scholarship = props.cellData === 'scholarship'
  return <span className={`sa-chip-sm${scholarship ? ' sa-chip-sm--accent' : ''}`}>{scholarship ? 'Scholarship' : 'Standard'}</span>
}

export function PlanPriceCell(props: CellProps) {
  const row = (props.rowData ?? {}) as { price?: number; interval?: string }
  return (
    <span>
      <Money amount={row.price} />
      <span className="sa-muted">{row.interval === 'annually' ? ' a year' : ' a month'}</span>
    </span>
  )
}

export function PaystackCodeCell(props: CellProps) {
  return props.cellData ? (
    <StatusPill tone="positive">On Paystack</StatusPill>
  ) : (
    <StatusPill tone="critical">Not on Paystack</StatusPill>
  )
}

/* ------------------------------------------------------------------ laptop applications (admin only) */

const LAPTOP_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: 'Submitted', tone: 'info' },
  shortlisted: { label: 'Shortlisted', tone: 'caution' },
  awarded: { label: 'Awarded', tone: 'positive' },
  not_selected: { label: 'Not selected', tone: 'neutral' },
}

export function LaptopStatusCell(props: CellProps) {
  const s = LAPTOP_STATUS[String(props.cellData)] ?? { label: String(props.cellData ?? '–'), tone: 'neutral' as Tone }
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>
}

export function StoryPreviewCell(props: CellProps) {
  const story = String(props.cellData ?? '').replace(/\s+/g, ' ').trim()
  if (!story) return empty
  return <span className="sa-cell__story">{story.length > 80 ? `${story.slice(0, 79)}…` : story}</span>
}

export function CertificateTickCell(props: CellProps) {
  return props.cellData ? (
    <span className="sa-tick">
      <BadgeCheck size={16} strokeWidth={2} aria-hidden /> Certified
    </span>
  ) : (
    empty
  )
}

/* ------------------------------------------------------------------ learning content */

/** Lesson's section and programme (lessons list; sections and programmes are visible to staff). */
export async function LessonPlaceCell(props: CellProps) {
  const section = await docLoader<{ title?: string; course?: number }>(props.payload, 'sections', { title: true, course: true }).load(relId(props.cellData))
  const course = section ? await docLoader<{ title?: string }>(props.payload, 'courses', { title: true }).load(relId(section.course)) : undefined
  if (!section) return empty
  return (
    <span className="sa-cell__stack">
      <span>{course?.title ?? 'Programme'}</span>
      <span className="sa-muted sa-cell__small">{section.title}</span>
    </span>
  )
}

export function LessonTypeCell(props: CellProps) {
  const row = (props.rowData ?? {}) as { driveFileId?: string; isFree?: boolean }
  const video = Boolean(row.driveFileId)
  return (
    <span className="sa-cell__chips">
      <span className="sa-chip-sm">
        {video ? <PlayCircle size={12} strokeWidth={2} aria-hidden /> : <FileText size={12} strokeWidth={2} aria-hidden />} {video ? 'Video' : 'Text'}
      </span>
      {row.isFree ? <span className="sa-chip-sm sa-chip-sm--accent">Free preview</span> : null}
    </span>
  )
}

export function DurationCell(props: CellProps) {
  const seconds = Number(props.cellData ?? 0)
  if (!seconds) return empty
  const minutes = Math.round(seconds / 60)
  return <span className="sa-num">{minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`}</span>
}

export function OrderNumberCell(props: CellProps) {
  return <span className="sa-order-badge">{String(props.cellData ?? '–')}</span>
}

export async function SectionLessonCountCell(props: CellProps) {
  const counts = batchLoader<number>('section-lessons', async (ids) => {
    const result = await props.payload.find({ collection: 'lessons', where: { section: { in: ids } }, limit: 5000, depth: 0, pagination: false, overrideAccess: true, select: { section: true } as never })
    const map = new Map<string, number>()
    for (const doc of result.docs as unknown as Array<{ section: number }>) map.set(String(doc.section), (map.get(String(doc.section)) ?? 0) + 1)
    return map
  })
  if (props.rowData?.id === undefined) return empty
  const n = (await counts.load(props.rowData.id)) ?? 0
  return <span className="sa-num">{n} {n === 1 ? 'lesson' : 'lessons'}</span>
}

export function QuestionCountCell(props: CellProps) {
  const n = Array.isArray(props.cellData) ? props.cellData.length : 0
  return <span className="sa-num">{n} {n === 1 ? 'question' : 'questions'}</span>
}

export async function QuizAverageCell(props: CellProps) {
  const averages = batchLoader<{ avg: number; attempts: number }>('quiz-avg', async (ids) => {
    const result = await props.payload.find({ collection: 'quiz-attempts', where: { quiz: { in: ids } }, limit: 10000, depth: 0, pagination: false, overrideAccess: true, select: { quiz: true, score: true } as never })
    const sums = new Map<string, { total: number; n: number }>()
    for (const doc of result.docs as unknown as Array<{ quiz: number; score: number }>) {
      const entry = sums.get(String(doc.quiz)) ?? { total: 0, n: 0 }
      entry.total += Number(doc.score)
      entry.n++
      sums.set(String(doc.quiz), entry)
    }
    return new Map([...sums].map(([k, v]) => [k, { avg: Math.round(v.total / v.n), attempts: v.n }]))
  })
  if (props.rowData?.id === undefined) return empty
  const stats = await averages.load(props.rowData.id)
  return stats ? (
    <span className="sa-num">
      {stats.avg}% <span className="sa-muted">({stats.attempts})</span>
    </span>
  ) : (
    <span className="sa-muted">No attempts</span>
  )
}

export function QuestionPromptCell(props: CellProps) {
  const row = (props.rowData ?? {}) as { options?: unknown[] }
  const n = Array.isArray(row.options) ? row.options.length : 0
  return (
    <MaybeLink props={props}>
      <span className="sa-cell__stack">
        <span>{String(props.cellData ?? '')}</span>
        <span className="sa-chip-sm">
          <CircleHelp size={11} strokeWidth={2} aria-hidden /> {n === 2 ? 'True/false' : `Multiple choice · ${n} options`}
        </span>
      </span>
    </MaybeLink>
  )
}

/* ------------------------------------------------------------------ media */

export function AltTextCell(props: CellProps) {
  const alt = String(props.cellData ?? '').trim()
  return alt ? <span className="sa-cell__story">{alt}</span> : <StatusPill tone="caution">Alt text missing</StatusPill>
}
