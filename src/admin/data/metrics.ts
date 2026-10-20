/**
 * SkillsAir Studio business metrics (brief 7.1). Server-only.
 *
 * - Every exported function takes the request and checks the role first: business metrics are
 *   admin-only (assertAdmin); instructor metrics are limited to the instructor's own programmes.
 *   Queries run with full database access only after that check.
 * - One SQL statement per aggregate (Postgres adapter), never paging documents in JavaScript.
 *   The whole Overview is 6 statements plus the cached window global.
 * - Aggregates are cached for 60 seconds per process (cache.ts); keys never mix users' data.
 *
 * Metric definitions (also shown in each card's tooltip, see METRIC_DEFINITIONS):
 *   Applicants           leads created in the period
 *   Offer viewed         of those, leads with offerViewCount > 0
 *   Accounts             of those, leads with status account_created or paid
 *   Paid                 of those, leads with status paid
 *   Conversion to paid   paid ÷ applicants, same creation-date cohort
 *   Active subscribers   subscriptions active, or past_due still inside the grace period
 *   MRR                  sum of monthly plan prices of active subscribers (annual ÷ 12), split scholarship/standard
 *   Revenue              sum of successful order amounts in the period, by type
 *   Needs attention      past-due subscriptions + failed orders in the period + queue waiting > 1 working hour
 *   Completions          enrolments completed in the period
 *   Certificates sold    successful certificate orders in the period
 *   Queue                leads with needsHuman = true; oldest wait
 */
import type { PayloadRequest } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { accessGraceDays } from '../../lib/billing.js'
import { HOUR } from '../../lib/lifecycle/timing.js'
import { assertAdmin, assertStaff } from './auth.js'
import { cached } from './cache.js'
import { dayKeys, fillSeries, lastDays, monthlyValue, rate, stepHealth, workingMsBetween, type PeriodRange } from './metrics-core.js'

type Row = Record<string, unknown>
type SQLQuery = ReturnType<typeof sql>

export const METRIC_DEFINITIONS = {
  applicants: 'People who applied (new applicant records) in this period.',
  conversion: 'Applicants from this period who have paid, divided by all applicants from this period.',
  activeSubscribers: 'Subscriptions that are active, or past due but still inside the grace period.',
  mrr: 'Monthly recurring revenue: the monthly price of every active subscription (annual plans ÷ 12).',
  revenue: 'Successful payments in this period: subscriptions, certificates and one-off programme fees.',
  attention: 'Past-due subscriptions, failed payments in this period and applicants waiting over an hour in working hours.',
  completions: 'Enrolments marked completed in this period.',
  inactive: 'Learners with an active enrolment who have not opened a lesson in 10 days or more.',
} as const

/** Runs one SQL statement through the Postgres adapter. */
async function query<T extends Row = Row>(req: PayloadRequest, statement: SQLQuery): Promise<T[]> {
  const db = req.payload.db as unknown as { drizzle: { execute: (q: SQLQuery) => Promise<{ rows: T[] }> } }
  const result = await db.drizzle.execute(statement)
  return result.rows
}

const iso = (ms: number) => new Date(ms).toISOString()
const num = (value: unknown) => Number(value ?? 0) || 0
/** Lagos day key of a timestamptz column, in SQL (WAT has no daylight saving). */
const lagosDay = (column: string) => sql.raw(`to_char((${column} AT TIME ZONE 'UTC') + interval '1 hour', 'YYYY-MM-DD')`)

/* ------------------------------------------------------------------------ */
/* Admissions                                                               */
/* ------------------------------------------------------------------------ */

export interface FunnelCounts {
  applicants: number
  offerViewed: number
  accounts: number
  paid: number
}

export interface AdmissionsMetrics {
  current: FunnelCounts
  previous: FunnelCounts
  /** Applicants per Lagos day for the last 14 days (sparkline). */
  applicantsSpark: number[]
  /** Conversion per day for the last 14 days (paid ÷ applicants of that day's cohort). */
  conversionSpark: number[]
  bySchool: Array<{ id: number | null; name: string; applicants: number; paid: number; funnel: FunnelCounts }>
  queue: { waiting: number; oldestSince: string | null; overHour: number }
}

export async function getAdmissions(req: PayloadRequest, range: PeriodRange): Promise<AdmissionsMetrics> {
  assertAdmin(req)
  const { value } = await cached(`admissions:${range.key}`, async () => {
    const spark = lastDays(range.to, 14)
    const [row] = await query(
      req,
      sql`
      WITH cur AS (SELECT * FROM leads WHERE created_at >= ${iso(range.from)}::timestamptz AND created_at < ${iso(range.to)}::timestamptz),
           prev AS (SELECT * FROM leads WHERE created_at >= ${iso(range.previousFrom)}::timestamptz AND created_at < ${iso(range.previousTo)}::timestamptz)
      SELECT
        (SELECT json_build_object(
          'applicants', count(*)::int,
          'offerViewed', count(*) FILTER (WHERE offer_view_count > 0)::int,
          'accounts', count(*) FILTER (WHERE status IN ('account_created', 'paid'))::int,
          'paid', count(*) FILTER (WHERE status = 'paid')::int) FROM cur) AS current,
        (SELECT json_build_object(
          'applicants', count(*)::int,
          'offerViewed', count(*) FILTER (WHERE offer_view_count > 0)::int,
          'accounts', count(*) FILTER (WHERE status IN ('account_created', 'paid'))::int,
          'paid', count(*) FILTER (WHERE status = 'paid')::int) FROM prev) AS previous,
        (SELECT coalesce(json_agg(json_build_object('day', d.day, 'value', d.n, 'paid', d.paid)), '[]'::json) FROM (
           SELECT ${lagosDay('created_at')} AS day, count(*)::int AS n, count(*) FILTER (WHERE status = 'paid')::int AS paid
           FROM leads WHERE created_at >= ${iso(new Date(`${spark[0]}T00:00:00Z`).getTime() - HOUR)}::timestamptz GROUP BY 1) d) AS spark,
        (SELECT coalesce(json_agg(s ORDER BY s.applicants DESC), '[]'::json) FROM (
           SELECT c.id, coalesce(c.name, 'No school') AS name, count(*)::int AS applicants,
             count(*) FILTER (WHERE cur.offer_view_count > 0)::int AS "offerViewed",
             count(*) FILTER (WHERE cur.status IN ('account_created', 'paid'))::int AS accounts,
             count(*) FILTER (WHERE cur.status = 'paid')::int AS paid
           FROM cur LEFT JOIN categories c ON c.id = cur.school_id GROUP BY c.id, c.name) s) AS by_school,
        (SELECT json_build_object('waiting', count(*)::int,
           'oldest', min(greatest(coalesce(last_inbound_at, 'epoch'::timestamptz), coalesce(last_event_at, updated_at))))
         FROM leads WHERE needs_human = true) AS queue,
        (SELECT coalesce(json_agg(greatest(coalesce(last_inbound_at, 'epoch'::timestamptz), coalesce(last_event_at, updated_at))), '[]'::json) FROM leads WHERE needs_human = true) AS queue_since
    `,
    )
    const r = row ?? {}
    const sparkRows = (r.spark as Array<{ day: string; value: number; paid: number }>) ?? []
    const applicantsSpark = fillSeries(sparkRows, spark)
    const paidSpark = fillSeries(sparkRows.map((s) => ({ day: s.day, value: s.paid })), spark)
    const now = Date.now()
    const queueSince = ((r.queue_since as string[]) ?? []).map((s) => new Date(s).getTime())
    const queue = r.queue as { waiting: number; oldest: string | null }
    return {
      current: r.current as FunnelCounts,
      previous: r.previous as FunnelCounts,
      applicantsSpark,
      conversionSpark: applicantsSpark.map((n, i) => Math.round((rate(paidSpark[i]!, n) ?? 0) * 100)),
      bySchool: ((r.by_school as Array<Row>) ?? []).map((s) => ({
        id: (s.id as number | null) ?? null,
        name: String(s.name),
        applicants: num(s.applicants),
        paid: num(s.paid),
        funnel: { applicants: num(s.applicants), offerViewed: num(s.offerViewed), accounts: num(s.accounts), paid: num(s.paid) },
      })),
      queue: {
        waiting: num(queue?.waiting),
        oldestSince: queue?.oldest ?? null,
        overHour: queueSince.filter((since) => workingMsBetween(since, now) > HOUR).length,
      },
    }
  })
  return value
}

/* ------------------------------------------------------------------------ */
/* Revenue and subscriptions                                                */
/* ------------------------------------------------------------------------ */

export interface RevenueMetrics {
  total: number
  previousTotal: number
  byType: { subscription: number; certificate: number; course: number }
  failedOrders: number
  certificatesSold: number
  previousCertificatesSold: number
  days: string[]
  daily: { subscription: number[]; certificate: number[]; course: number[] }
  revenueSpark: number[]
  activeSubscribers: number
  previousActiveSubscribers: number
  pastDue: number
  mrr: { total: number; scholarship: number; standard: number; daily: number[]; previous: number }
  subscribersSpark: number[]
}

export async function getRevenue(req: PayloadRequest, range: PeriodRange): Promise<RevenueMetrics> {
  assertAdmin(req)
  const { value } = await cached(`revenue:${range.key}`, async () => {
    const chartDays = range.to - range.from < 13 * 24 * HOUR ? lastDays(range.to, 14) : dayKeys(range.from, range.to)
    const spark = lastDays(range.to, 14)
    const chartStart = Math.min(new Date(`${chartDays[0]}T00:00:00Z`).getTime() - HOUR, new Date(`${spark[0]}T00:00:00Z`).getTime() - HOUR)
    const graceMs = accessGraceDays() * 24 * HOUR
    const [orders] = await query(
      req,
      sql`
      SELECT
        (SELECT coalesce(json_object_agg(type, total), '{}'::json) FROM (
           SELECT type::text, sum(amount)::float AS total FROM orders
           WHERE status = 'success' AND coalesce(paid_at, created_at) >= ${iso(range.from)}::timestamptz AND coalesce(paid_at, created_at) < ${iso(range.to)}::timestamptz GROUP BY 1) t) AS by_type,
        (SELECT coalesce(sum(amount), 0)::float FROM orders
           WHERE status = 'success' AND coalesce(paid_at, created_at) >= ${iso(range.previousFrom)}::timestamptz AND coalesce(paid_at, created_at) < ${iso(range.previousTo)}::timestamptz) AS previous_total,
        (SELECT count(*)::int FROM orders WHERE status = 'failed' AND created_at >= ${iso(range.from)}::timestamptz AND created_at < ${iso(range.to)}::timestamptz) AS failed,
        (SELECT count(*)::int FROM orders WHERE type = 'certificate' AND status = 'success' AND coalesce(paid_at, created_at) >= ${iso(range.from)}::timestamptz AND coalesce(paid_at, created_at) < ${iso(range.to)}::timestamptz) AS certificates,
        (SELECT count(*)::int FROM orders WHERE type = 'certificate' AND status = 'success' AND coalesce(paid_at, created_at) >= ${iso(range.previousFrom)}::timestamptz AND coalesce(paid_at, created_at) < ${iso(range.previousTo)}::timestamptz) AS previous_certificates,
        (SELECT coalesce(json_agg(d), '[]'::json) FROM (
           SELECT ${lagosDay('coalesce(paid_at, created_at)')} AS day, type::text AS type, sum(amount)::float AS value FROM orders
           WHERE status = 'success' AND coalesce(paid_at, created_at) >= ${iso(chartStart)}::timestamptz GROUP BY 1, 2) d) AS daily
    `,
    )
    // Subscriptions: active now, MRR now, and the active set at the end of each chart day
    // (created before the day ended and not yet cancelled/expired by then). Past-due counts as
    // active while inside the grace period.
    const [subs] = await query(
      req,
      sql`
      WITH s AS (
        SELECT s.id, s.status::text AS status, s.created_at, s.cancelled_at, s.last_failed_at, s.current_period_end,
               coalesce(p.price, 0)::float AS price, p.interval::text AS interval, p.kind::text AS kind
        FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id),
      active AS (
        SELECT * FROM s WHERE status = 'active'
          OR (status = 'past_due' AND last_failed_at IS NOT NULL AND last_failed_at + (${graceMs} * interval '1 millisecond') > now()))
      SELECT
        (SELECT coalesce(json_agg(json_build_object('price', price, 'interval', interval, 'kind', kind)), '[]'::json) FROM active) AS active,
        (SELECT count(*)::int FROM s WHERE status = 'past_due') AS past_due,
        (SELECT coalesce(json_agg(json_build_object('created', created_at, 'ended', coalesce(cancelled_at, CASE WHEN status = 'expired' THEN current_period_end END), 'price', price, 'interval', interval)), '[]'::json) FROM s) AS history
    `,
    )
    const byType = (orders?.by_type as Record<string, number>) ?? {}
    const dailyRows = (orders?.daily as Array<{ day: string; type: string; value: number }>) ?? []
    const series = (type: string, keys: string[]) => fillSeries(dailyRows.filter((d) => d.type === type), keys)
    const active = (subs?.active as Array<{ price: number; interval: string; kind: string }>) ?? []
    const history = (subs?.history as Array<{ created: string; ended: string | null; price: number; interval: string }>) ?? []
    const activeAt = (at: number) => history.filter((h) => new Date(h.created).getTime() <= at && (!h.ended || new Date(h.ended).getTime() > at))
    const endOfDay = (key: string) => new Date(`${key}T00:00:00Z`).getTime() - HOUR + 24 * HOUR
    const mrrAt = (at: number) => activeAt(at).reduce((sum, h) => sum + monthlyValue(h.price, h.interval), 0)
    const scholarship = active.filter((a) => a.kind === 'scholarship').reduce((sum, a) => sum + monthlyValue(a.price, a.interval), 0)
    const standard = active.filter((a) => a.kind !== 'scholarship').reduce((sum, a) => sum + monthlyValue(a.price, a.interval), 0)
    const daily = { subscription: series('subscription', chartDays), certificate: series('certificate', chartDays), course: series('course', chartDays) }
    const sparkTotals = spark.map((_, i) => ['subscription', 'certificate', 'course'].reduce((sum, t) => sum + series(t, spark)[i]!, 0))
    return {
      total: Object.values(byType).reduce((sum, v) => sum + num(v), 0),
      previousTotal: num(orders?.previous_total),
      byType: { subscription: num(byType.subscription), certificate: num(byType.certificate), course: num(byType.course) },
      failedOrders: num(orders?.failed),
      certificatesSold: num(orders?.certificates),
      previousCertificatesSold: num(orders?.previous_certificates),
      days: chartDays,
      daily,
      revenueSpark: sparkTotals,
      activeSubscribers: active.length,
      previousActiveSubscribers: activeAt(range.previousTo).length,
      pastDue: num(subs?.past_due),
      mrr: {
        total: scholarship + standard,
        scholarship,
        standard,
        daily: chartDays.map((day) => mrrAt(Math.min(endOfDay(day), Date.now()))),
        previous: mrrAt(range.previousTo),
      },
      subscribersSpark: spark.map((day) => activeAt(Math.min(endOfDay(day), Date.now())).length),
    }
  })
  return value
}

/* ------------------------------------------------------------------------ */
/* Learning and programmes                                                  */
/* ------------------------------------------------------------------------ */

export interface LearningMetrics {
  activeLearners: number
  inactiveLearners: number
  completions: number
  previousCompletions: number
  completionRate: number | null
  enrolmentStatus: Array<{ status: string; count: number }>
  topProgrammes: Array<{ id: number; title: string; applicants: number; paid: number; conversion: number | null; activeLearners: number; completions: number }>
}

export async function getLearning(req: PayloadRequest, range: PeriodRange): Promise<LearningMetrics> {
  assertAdmin(req)
  const { value } = await cached(`learning:${range.key}`, async () => {
    const [row] = await query(
      req,
      sql`
      SELECT
        (SELECT count(DISTINCT student_id)::int FROM enrollments WHERE status = 'active') AS active_learners,
        (SELECT count(DISTINCT e.student_id)::int FROM enrollments e JOIN users u ON u.id = e.student_id
           WHERE e.status = 'active' AND coalesce(u.lifecycle_last_learning_at, e.enrolled_at) < now() - interval '10 days') AS inactive,
        (SELECT count(*)::int FROM enrollments WHERE completed_at >= ${iso(range.from)}::timestamptz AND completed_at < ${iso(range.to)}::timestamptz) AS completions,
        (SELECT count(*)::int FROM enrollments WHERE completed_at >= ${iso(range.previousFrom)}::timestamptz AND completed_at < ${iso(range.previousTo)}::timestamptz) AS previous_completions,
        (SELECT coalesce(json_agg(json_build_object('status', status, 'count', n)), '[]'::json) FROM (SELECT status::text, count(*)::int AS n FROM enrollments GROUP BY 1) e) AS status,
        (SELECT coalesce(json_agg(t ORDER BY t.applicants DESC, t.active DESC), '[]'::json) FROM (
           SELECT c.id, c.title,
             (SELECT count(*)::int FROM leads l WHERE l.course_id = c.id AND l.created_at >= ${iso(range.from)}::timestamptz AND l.created_at < ${iso(range.to)}::timestamptz) AS applicants,
             (SELECT count(*)::int FROM leads l WHERE l.course_id = c.id AND l.status = 'paid' AND l.created_at >= ${iso(range.from)}::timestamptz AND l.created_at < ${iso(range.to)}::timestamptz) AS paid,
             (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS active,
             (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id AND e.completed_at >= ${iso(range.from)}::timestamptz AND e.completed_at < ${iso(range.to)}::timestamptz) AS completions
           FROM courses c WHERE c.status = 'published') t) AS top
    `,
    )
    const status = ((row?.status as Array<{ status: string; count: number }>) ?? []).map((s) => ({ status: s.status, count: num(s.count) }))
    const completed = status.find((s) => s.status === 'completed')?.count ?? 0
    const activeCount = status.find((s) => s.status === 'active')?.count ?? 0
    return {
      activeLearners: num(row?.active_learners),
      inactiveLearners: num(row?.inactive),
      completions: num(row?.completions),
      previousCompletions: num(row?.previous_completions),
      completionRate: rate(completed, completed + activeCount),
      enrolmentStatus: status,
      topProgrammes: ((row?.top as Array<Row>) ?? [])
        .map((t) => ({
          id: num(t.id),
          title: String(t.title),
          applicants: num(t.applicants),
          paid: num(t.paid),
          conversion: rate(num(t.paid), num(t.applicants)),
          activeLearners: num(t.active),
          completions: num(t.completions),
        }))
        .slice(0, 8),
    }
  })
  return value
}

/* ------------------------------------------------------------------------ */
/* Needs attention                                                          */
/* ------------------------------------------------------------------------ */

export interface AttentionItem {
  id: string
  tone: 'caution' | 'critical'
  kind: 'queue' | 'past_due' | 'failed_order' | 'lifecycle' | 'programme' | 'laptop'
  text: string
  href: string
  fixLabel: string
}

export async function getAttention(req: PayloadRequest, range: PeriodRange): Promise<{ items: AttentionItem[]; count: number; previousCount: number }> {
  assertAdmin(req)
  const { value } = await cached(`attention:${range.key}`, async () => {
    const since30 = iso(Date.now() - 30 * 24 * HOUR)
    const [row] = await query(
      req,
      sql`
      SELECT
        (SELECT coalesce(json_agg(json_build_object('since', greatest(coalesce(last_inbound_at, 'epoch'::timestamptz), coalesce(last_event_at, updated_at)), 'id', id, 'name', first_name)), '[]'::json) FROM leads WHERE needs_human = true) AS queue,
        (SELECT coalesce(json_agg(json_build_object('id', s.id, 'title', s.display_title, 'failed', s.last_failed_at)), '[]'::json) FROM subscriptions s WHERE s.status = 'past_due') AS past_due,
        (SELECT coalesce(json_agg(json_build_object('id', o.id, 'reference', o.reference, 'amount', o.amount)), '[]'::json) FROM orders o
           WHERE o.status = 'failed' AND o.created_at >= ${iso(range.from)}::timestamptz
             AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.user_id = o.user_id AND o2.status = 'success' AND o2.created_at > o.created_at
                             AND o2.course_id IS NOT DISTINCT FROM o.course_id)) AS failed,
        (SELECT count(*)::int FROM orders WHERE status = 'failed' AND created_at >= ${iso(range.previousFrom)}::timestamptz AND created_at < ${iso(range.previousTo)}::timestamptz) AS previous_failed,
        (SELECT coalesce(json_agg(m), '[]'::json) FROM (
           SELECT regexp_replace(step_id, '#[0-9]+$', '') AS step, count(*)::int AS sent,
             count(unsubscribed_at)::int AS unsubscribed, count(complained_at)::int AS complained
           FROM messages WHERE status = 'sent' AND sent_at >= ${since30}::timestamptz GROUP BY 1) m) AS lifecycle,
        (SELECT coalesce(json_agg(json_build_object('id', c.id, 'title', c.title,
            'noRequirements', NOT EXISTS (SELECT 1 FROM courses_requirements r WHERE r._parent_id = c.id),
            'noObjectives', NOT EXISTS (SELECT 1 FROM courses_objectives o WHERE o._parent_id = c.id))), '[]'::json)
         FROM courses c WHERE c.status = 'published'
           AND (NOT EXISTS (SELECT 1 FROM courses_requirements r WHERE r._parent_id = c.id) OR NOT EXISTS (SELECT 1 FROM courses_objectives o WHERE o._parent_id = c.id))) AS programmes,
        (SELECT count(*)::int FROM laptop_applications WHERE status = 'submitted') AS laptops
    `,
    )
    const now = Date.now()
    const items: AttentionItem[] = []
    const waiting = ((row?.queue as Array<{ since: string; id: number; name: string }>) ?? []).filter((q) => workingMsBetween(new Date(q.since).getTime(), now) > HOUR)
    if (waiting.length) {
      items.push({
        id: 'queue',
        tone: waiting.some((q) => workingMsBetween(new Date(q.since).getTime(), now) > 4 * HOUR) ? 'critical' : 'caution',
        kind: 'queue',
        text: `${waiting.length} applicant${waiting.length === 1 ? ' has' : 's have'} waited over an hour for a reply`,
        href: '/admin/queue',
        fixLabel: 'Open queue',
      })
    }
    const pastDue = (row?.past_due as Array<{ id: number; title: string | null }>) ?? []
    if (pastDue.length) {
      items.push({
        id: 'past_due',
        tone: 'critical',
        kind: 'past_due',
        text: pastDue.length === 1 ? `Renewal failed: ${pastDue[0]!.title ?? 'one subscription'}` : `${pastDue.length} subscriptions are past due`,
        href: '/admin/collections/subscriptions?where[status][equals]=past_due',
        fixLabel: 'Review',
      })
    }
    const failed = (row?.failed as Array<{ id: number; reference: string }>) ?? []
    if (failed.length) {
      items.push({
        id: 'failed',
        tone: 'caution',
        kind: 'failed_order',
        text: `${failed.length} failed payment${failed.length === 1 ? '' : 's'} with no successful payment since`,
        href: '/admin/collections/orders?where[status][equals]=failed&sort=-createdAt',
        fixLabel: 'Review',
      })
    }
    for (const step of (row?.lifecycle as Array<{ step: string; sent: number; unsubscribed: number; complained: number }>) ?? []) {
      if (stepHealth(step) === 'critical') {
        items.push({
          id: `lifecycle-${step.step}`,
          tone: 'critical',
          kind: 'lifecycle',
          text: `Email step ${step.step}: ${step.unsubscribed} unsubscribes and ${step.complained} spam reports from ${step.sent} sent`,
          href: '/admin/lifecycle',
          fixLabel: 'Inspect',
        })
      }
    }
    for (const programme of (row?.programmes as Array<{ id: number; title: string; noRequirements: boolean; noObjectives: boolean }>) ?? []) {
      const missing = [programme.noObjectives && 'objectives', programme.noRequirements && 'requirements'].filter(Boolean).join(' and ')
      items.push({ id: `programme-${programme.id}`, tone: 'caution', kind: 'programme', text: `${programme.title} is published without ${missing}`, href: `/admin/collections/courses/${programme.id}`, fixLabel: 'Fix' })
    }
    const laptops = num(row?.laptops)
    if (laptops) {
      items.push({ id: 'laptops', tone: 'caution', kind: 'laptop', text: `${laptops} laptop application${laptops === 1 ? '' : 's'} awaiting review`, href: '/admin/collections/laptop-applications?where[status][equals]=submitted', fixLabel: 'Review' })
    }
    // The headline count is the money-and-people problems (not content housekeeping).
    const count = waiting.length + pastDue.length + failed.length
    return { items, count, previousCount: num(row?.previous_failed) }
  })
  return value
}

/* ------------------------------------------------------------------------ */
/* Recent activity                                                          */
/* ------------------------------------------------------------------------ */

export interface ActivityEvent {
  id: string
  kind: 'applicant' | 'payment' | 'completion' | 'certificate' | 'cancellation'
  person: string
  programme: string | null
  at: string
  href: string
  amount?: number
}

export async function getActivity(req: PayloadRequest): Promise<ActivityEvent[]> {
  assertAdmin(req)
  const { value } = await cached('activity', async () => {
    const rows = await query<{ kind: string; id: number; person: string | null; programme: string | null; at: string; amount: number | null; ord: string }>(
      req,
      sql`
      (SELECT 'applicant' AS kind, l.id, l.first_name AS person, c.title AS programme, l.created_at AS at, NULL::float AS amount, 'leads' AS ord
         FROM leads l LEFT JOIN courses c ON c.id = l.course_id ORDER BY l.created_at DESC LIMIT 15)
      UNION ALL
      (SELECT CASE WHEN o.type = 'certificate' THEN 'certificate' ELSE 'payment' END, o.id, trim(concat_ws(' ', u.first_name, u.last_name)), c.title, coalesce(o.paid_at, o.created_at), o.amount::float, 'orders'
         FROM orders o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN courses c ON c.id = o.course_id
         WHERE o.status = 'success' ORDER BY coalesce(o.paid_at, o.created_at) DESC LIMIT 15)
      UNION ALL
      (SELECT 'completion', e.id, trim(concat_ws(' ', u.first_name, u.last_name)), c.title, e.completed_at, NULL, 'enrollments'
         FROM enrollments e LEFT JOIN users u ON u.id = e.student_id LEFT JOIN courses c ON c.id = e.course_id
         WHERE e.completed_at IS NOT NULL ORDER BY e.completed_at DESC LIMIT 15)
      UNION ALL
      (SELECT 'cancellation', s.id, trim(concat_ws(' ', u.first_name, u.last_name)), c.title, s.cancelled_at, NULL, 'subscriptions'
         FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN courses c ON c.id = s.course_id
         WHERE s.cancelled_at IS NOT NULL ORDER BY s.cancelled_at DESC LIMIT 15)
      ORDER BY at DESC LIMIT 15
    `,
    )
    return rows.map((r) => ({
      id: `${r.ord}-${r.id}`,
      kind: r.kind as ActivityEvent['kind'],
      person: r.person || 'Someone',
      programme: r.programme,
      at: new Date(r.at).toISOString(),
      href: `/admin/collections/${r.ord}/${r.id}`,
      amount: r.amount ?? undefined,
    }))
  })
  return value
}

/* ------------------------------------------------------------------------ */
/* Instructor overview                                                      */
/* ------------------------------------------------------------------------ */

export interface InstructorMetrics {
  programmes: Array<{ id: number; title: string; status: string; learners: number; completionRate: number | null; averageQuizScore: number | null; updatedAt: string }>
  needingHelp: Array<{ enrollmentId: number; learner: string; programme: string; lastLearningAt: string | null; progress: number }>
}

/** An instructor's own programmes only (admins see every programme they instruct, too). */
export async function getInstructorOverview(req: PayloadRequest): Promise<InstructorMetrics> {
  const user = assertStaff(req)
  const { value } = await cached(`instructor:${user.id}`, async () => {
    const [row] = await query(
      req,
      sql`
      WITH mine AS (SELECT id, title, status::text AS status, updated_at FROM courses WHERE instructor_id = ${Number(user.id)})
      SELECT
        (SELECT coalesce(json_agg(json_build_object(
            'id', m.id, 'title', m.title, 'status', m.status, 'updatedAt', m.updated_at,
            'learners', (SELECT count(*)::int FROM enrollments e WHERE e.course_id = m.id AND e.status IN ('active', 'completed')),
            'completed', (SELECT count(*)::int FROM enrollments e WHERE e.course_id = m.id AND e.status = 'completed'),
            'quiz', (SELECT avg(a.score)::float FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE q.course_id = m.id)
          ) ORDER BY m.updated_at DESC), '[]'::json) FROM mine m) AS programmes,
        (SELECT coalesce(json_agg(h), '[]'::json) FROM (
           SELECT e.id AS "enrollmentId", trim(concat_ws(' ', u.first_name, u.last_name)) AS learner, m.title AS programme,
                  u.lifecycle_last_learning_at AS "lastLearningAt", coalesce(e.progress_percent, 0)::float AS progress
           FROM enrollments e JOIN mine m ON m.id = e.course_id JOIN users u ON u.id = e.student_id
           WHERE e.status = 'active' AND coalesce(u.lifecycle_last_learning_at, e.enrolled_at) < now() - interval '10 days'
           ORDER BY coalesce(u.lifecycle_last_learning_at, e.enrolled_at) ASC LIMIT 20) h) AS needing_help
    `,
    )
    return {
      programmes: ((row?.programmes as Array<Row>) ?? []).map((p) => ({
        id: num(p.id),
        title: String(p.title),
        status: String(p.status),
        learners: num(p.learners),
        completionRate: rate(num(p.completed), num(p.learners)),
        averageQuizScore: p.quiz === null || p.quiz === undefined ? null : Math.round(num(p.quiz)),
        updatedAt: String(p.updatedAt),
      })),
      needingHelp: ((row?.needing_help as Array<Row>) ?? []).map((h) => ({
        enrollmentId: num(h.enrollmentId),
        learner: String(h.learner || 'Learner'),
        programme: String(h.programme),
        lastLearningAt: (h.lastLearningAt as string | null) ?? null,
        progress: num(h.progress),
      })),
    }
  })
  return value
}
