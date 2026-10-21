/**
 * Overview panels. Each is a self-contained async server component taking `{ req, range }`, so
 * any of them can later be registered as a Payload dashboard widget (admin.dashboard, still
 * experimental in 3.85.1) without a rewrite. Each panel loads its own (cached) data and shows its
 * own error state, so one failing query never blanks the whole Overview.
 */
import React from 'react'
import type { PayloadRequest } from 'payload'
import { AlertTriangle, Award, CheckCircle2, CircleSlash, GraduationCap, Inbox, Receipt, UserPlus } from 'lucide-react'
import { Callout, Card, CardHeader, EmptyState, InfoTip, Money, ProgressBar, Timeline, type TimelineItem } from '../../ui/primitives'
import { CHART_COLOURS, ColumnChart, Donut, Funnel, HBarChart } from '../../ui/charts'
import { StatCard } from '../../ui/StatCard'
import { EntityIcon } from '../../ui/icons'
import { formatNaira, formatNumber, formatPercent } from '../../format'
import { dayLabel, rate, type PeriodRange } from '../../data/metrics-core'
import { METRIC_DEFINITIONS, getActivity, getAdmissions, getAttention, getLearning, getRevenue } from '../../data/metrics'
import { listUrl, since } from '../../links'

type PanelProps = { req: PayloadRequest; range: PeriodRange }

function PanelError({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <Callout tone="critical" title="This panel couldn’t load">
        Refresh the page. If it keeps happening, check the database connection in the admin service logs.
      </Callout>
    </Card>
  )
}

async function safe<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch {
    return null
  }
}

const createdIn = (range: PeriodRange) => [since(range.from), ['createdAt', 'less_than', new Date(range.to).toISOString()] as [string, string, string]]

/* ------------------------------------------------------------------ KPIs */

export async function KpiRow({ req, range }: PanelProps) {
  const [admissions, revenue, attention] = await Promise.all([safe(() => getAdmissions(req, range)), safe(() => getRevenue(req, range)), safe(() => getAttention(req, range))])
  const period = range.comparisonLabel
  const conversion = admissions ? rate(admissions.current.paid, admissions.current.applicants) : null
  const previousConversion = admissions ? rate(admissions.previous.paid, admissions.previous.applicants) : null
  return (
    <section className="sa-overview__kpis" aria-label="Key numbers">
      <StatCard
        label="Applicants"
        icon={<EntityIcon slug="leads" size={16} />}
        value={admissions ? formatNumber(admissions.current.applicants) : '–'}
        delta={admissions ? { current: admissions.current.applicants, previous: admissions.previous.applicants, periodLabel: period } : null}
        spark={admissions?.applicantsSpark}
        href={listUrl('leads', createdIn(range), '-createdAt')}
        tooltip={METRIC_DEFINITIONS.applicants}
      />
      <StatCard
        label="Conversion to paid"
        icon={<CheckCircle2 size={16} strokeWidth={1.75} aria-hidden />}
        value={formatPercent(conversion)}
        delta={conversion !== null && previousConversion !== null ? { current: conversion, previous: previousConversion, periodLabel: period } : null}
        spark={admissions?.conversionSpark}
        href={listUrl('leads', [...createdIn(range), ['status', 'equals', 'paid']], '-createdAt')}
        tooltip={METRIC_DEFINITIONS.conversion}
      />
      <StatCard
        label="Active subscribers"
        icon={<EntityIcon slug="subscriptions" size={16} />}
        value={revenue ? formatNumber(revenue.activeSubscribers) : '–'}
        delta={revenue ? { current: revenue.activeSubscribers, previous: revenue.previousActiveSubscribers, periodLabel: period } : null}
        spark={revenue?.subscribersSpark}
        href={listUrl('subscriptions', [['status', 'in', ['active', 'past_due']]], '-createdAt')}
        tooltip={METRIC_DEFINITIONS.activeSubscribers}
      />
      <StatCard
        label="MRR"
        icon={<EntityIcon slug="plans" size={16} />}
        value={
          revenue ? (
            <>
              <Money amount={revenue.mrr.total} compact />
              <small>/mo</small>
            </>
          ) : (
            '–'
          )
        }
        delta={revenue ? { current: revenue.mrr.total, previous: revenue.mrr.previous, periodLabel: period } : null}
        spark={revenue?.mrr.daily.slice(-14)}
        href={listUrl('subscriptions', [['status', 'equals', 'active']], '-createdAt')}
        tooltip={`${METRIC_DEFINITIONS.mrr}${revenue ? ` Scholarship ${formatNaira(revenue.mrr.scholarship)}, standard ${formatNaira(revenue.mrr.standard)}.` : ''}`}
      />
      <StatCard
        label="Revenue"
        icon={<EntityIcon slug="orders" size={16} />}
        value={revenue ? <Money amount={revenue.total} compact /> : '–'}
        delta={revenue ? { current: revenue.total, previous: revenue.previousTotal, periodLabel: period } : null}
        spark={revenue?.revenueSpark}
        href={listUrl('orders', [['status', 'equals', 'success'], ...createdIn(range)], '-createdAt')}
        tooltip={METRIC_DEFINITIONS.revenue}
      />
      <StatCard
        label="Needs attention"
        icon={<AlertTriangle size={16} strokeWidth={1.75} aria-hidden />}
        tone={attention && attention.count > 0 ? 'attention' : 'default'}
        goodWhen="down"
        value={attention ? formatNumber(attention.count) : '–'}
        href="#needs-attention"
        tooltip={METRIC_DEFINITIONS.attention}
      />
    </section>
  )
}

/* ------------------------------------------------------------------ Funnel */

export async function AdmissionsFunnelPanel({ req, range, school }: PanelProps & { school?: string }) {
  const data = await safe(() => getAdmissions(req, range))
  if (!data) return <PanelError title="Admissions funnel" />
  const selected = school ? data.bySchool.find((s) => String(s.id ?? 'none') === school) : null
  const funnel = selected?.funnel ?? data.current
  const schoolCondition = selected?.id ? [['school', 'equals', selected.id] as [string, string, number]] : []
  const base = [...createdIn(range), ...schoolCondition]
  const schools = data.bySchool.filter((s) => s.applicants > 0).slice(0, 6)
  const segmentHref = (value?: string) => {
    const params = new URLSearchParams({ period: range.key })
    if (value) params.set('school', value)
    return `/admin?${params.toString()}#funnel`
  }
  return (
    <Card className="sa-overview__wide" id="funnel">
      <CardHeader eyebrow={range.label} title="Admissions funnel" action={<InfoTip text="Each step counts applicants from this period who have reached it. Click a step to see the people." />} />
      {schools.length > 0 ? (
        <nav className="sa-segmented sa-overview__segments" aria-label="Filter the funnel by school">
          <a href={segmentHref()} aria-current={!selected ? 'page' : undefined}>
            All schools
          </a>
          {schools.map((s) => (
            <a key={String(s.id)} href={segmentHref(String(s.id ?? 'none'))} aria-current={selected === s ? 'page' : undefined}>
              {s.name}
            </a>
          ))}
        </nav>
      ) : null}
      {funnel.applicants === 0 ? (
        <EmptyState icon={<Inbox size={22} strokeWidth={1.75} />} title="No applicants yet this period" action={{ href: 'https://skillsair.com/apply', label: 'Share your Apply link' }}>
          New applications appear here as they arrive.
        </EmptyState>
      ) : (
        <Funnel
          title={`Admissions funnel, ${range.label.toLowerCase()}${selected ? `, ${selected.name}` : ''}`}
          steps={[
            { label: 'Applicants', value: funnel.applicants, href: listUrl('leads', base, '-createdAt') },
            { label: 'Offer viewed', value: funnel.offerViewed, href: listUrl('leads', [...base, ['offerViewCount', 'greater_than', 0]], '-createdAt') },
            { label: 'Account created', value: funnel.accounts, href: listUrl('leads', [...base, ['status', 'in', ['account_created', 'paid']]], '-createdAt') },
            { label: 'Paid', value: funnel.paid, href: listUrl('leads', [...base, ['status', 'equals', 'paid']], '-createdAt') },
          ]}
        />
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ Revenue */

export async function RevenuePanel({ req, range }: PanelProps) {
  const data = await safe(() => getRevenue(req, range))
  if (!data) return <PanelError title="Revenue over time" />
  const hasRevenue = data.days.some((_, i) => data.daily.subscription[i]! + data.daily.certificate[i]! + data.daily.course[i]! > 0) || data.mrr.total > 0
  return (
    <Card className="sa-overview__full">
      <CardHeader
        eyebrow={data.days.length > 14 ? range.label : 'Last 14 days'}
        title="Revenue over time"
        action={
          <span className="sa-overview__figure">
            <Money amount={data.total} /> <span className="sa-muted">in {range.label.toLowerCase()}</span>
          </span>
        }
      />
      {hasRevenue ? (
        <ColumnChart
          title="Revenue per day by type, with monthly recurring revenue"
          labels={data.days.map(dayLabel)}
          series={[
            { key: 'subscription', label: 'Subscriptions', colour: CHART_COLOURS[0]! },
            { key: 'certificate', label: 'Certificates', colour: CHART_COLOURS[1]! },
            { key: 'course', label: 'One-off', colour: CHART_COLOURS[2]! },
          ]}
          values={data.daily}
          line={{ label: 'MRR (right axis)', values: data.mrr.daily, colour: 'var(--sa-ink)' }}
          format={(v) => formatNaira(v, { compact: true })}
          lineFormat={(v) => formatNaira(v, { compact: true })}
        />
      ) : (
        <EmptyState icon={<Receipt size={22} strokeWidth={1.75} />} title="No payments yet" action={{ href: '/admin/collections/plans', label: 'Check plans are on Paystack' }}>
          Successful payments will be charted here by day.
        </EmptyState>
      )}
      <dl className="sa-overview__splits">
        <div>
          <dt>Subscriptions</dt>
          <dd>
            <Money amount={data.byType.subscription} />
          </dd>
        </div>
        <div>
          <dt>Certificates</dt>
          <dd>
            <Money amount={data.byType.certificate} /> <span className="sa-muted">({formatNumber(data.certificatesSold)})</span>
          </dd>
        </div>
        <div>
          <dt>One-off</dt>
          <dd>
            <Money amount={data.byType.course} />
          </dd>
        </div>
        <div>
          <dt>MRR split</dt>
          <dd>
            <Money amount={data.mrr.scholarship} compact /> scholarship · <Money amount={data.mrr.standard} compact /> standard
          </dd>
        </div>
      </dl>
    </Card>
  )
}

/* ------------------------------------------------------------------ Schools */

export async function SchoolsPanel({ req, range }: PanelProps) {
  const data = await safe(() => getAdmissions(req, range))
  if (!data) return <PanelError title="Applicants by school" />
  const rows = data.bySchool.filter((s) => s.applicants > 0)
  return (
    <Card>
      <CardHeader eyebrow={range.label} title="Applicants by school" />
      {rows.length ? (
        <HBarChart
          title={`Applicants by school, ${range.label.toLowerCase()}`}
          valueLabel="Applicants"
          data={rows.map((s, i) => ({
            label: s.name,
            value: s.applicants,
            colour: CHART_COLOURS[i % CHART_COLOURS.length],
            href: listUrl('leads', [...createdIn(range), ...(s.id ? [['school', 'equals', s.id] as [string, string, number]] : [['school', 'exists', false] as [string, string, boolean]])], '-createdAt'),
          }))}
        />
      ) : (
        <EmptyState icon={<EntityIcon slug="categories" size={22} />} title="No applicants yet this period">
          Schools appear here once people apply.
        </EmptyState>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ Programmes */

export async function TopProgrammesPanel({ req, range }: PanelProps) {
  const data = await safe(() => getLearning(req, range))
  if (!data) return <PanelError title="Top programmes" />
  const rows = data.topProgrammes
  return (
    <Card>
      <CardHeader eyebrow={range.label} title="Top programmes" action={<a className="sa-link" href="/admin/collections/courses">All programmes</a>} />
      {rows.length ? (
        <div className="sa-table-wrap">
          <table className="sa-table">
            <caption className="sa-visually-hidden">Programmes by applicants in {range.label.toLowerCase()}</caption>
            <thead>
              <tr>
                <th scope="col">Programme</th>
                <th scope="col" className="sa-right">Applied</th>
                <th scope="col" className="sa-right">Paid</th>
                <th scope="col">Conversion</th>
                <th scope="col" className="sa-right">Learning</th>
                <th scope="col" className="sa-right">Done</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`/admin/collections/courses/${p.id}`}>{p.title}</a>
                  </td>
                  <td className="sa-right">{formatNumber(p.applicants)}</td>
                  <td className="sa-right">{formatNumber(p.paid)}</td>
                  <td style={{ minWidth: 110 }}>
                    {p.conversion === null ? <span className="sa-muted">–</span> : <ProgressBar value={p.conversion * 100} label={`${p.title} conversion`} tone="positive" />}
                  </td>
                  <td className="sa-right">{formatNumber(p.activeLearners)}</td>
                  <td className="sa-right">{formatNumber(p.completions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={<EntityIcon slug="courses" size={22} />} title="No published programmes" action={{ href: '/admin/collections/courses/create', label: 'New programme' }} />
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ Needs attention */

export async function NeedsAttentionPanel({ req, range }: PanelProps) {
  const data = await safe(() => getAttention(req, range))
  if (!data) return <PanelError title="Needs attention" />
  return (
    <Card id="needs-attention">
      <CardHeader eyebrow="Problems to fix" title="Needs attention" />
      {data.items.length ? (
        <ul className="sa-attention">
          {data.items.map((item) => (
            <li key={item.id} className={`sa-attention__item sa-attention__item--${item.tone}`}>
              <span className="sa-attention__icon" aria-hidden="true">
                <AlertTriangle size={16} strokeWidth={2} />
              </span>
              <span className="sa-attention__text">
                <span className="sa-visually-hidden">{item.tone === 'critical' ? 'Urgent: ' : 'Check: '}</span>
                {item.text}
              </span>
              <a className="sa-button sa-button--secondary sa-button--sm" href={item.href}>
                {item.fixLabel}
                <span className="sa-visually-hidden">: {item.text}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<CheckCircle2 size={22} strokeWidth={1.75} />} title="All clear ✓">
          No failed payments, waiting applicants or flagged email steps right now.
        </EmptyState>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ Learning */

export async function LearningHealthPanel({ req, range }: PanelProps) {
  const [learning, revenue] = await Promise.all([safe(() => getLearning(req, range)), safe(() => getRevenue(req, range))])
  if (!learning) return <PanelError title="Learning health" />
  const colours: Record<string, string> = { active: CHART_COLOURS[0]!, completed: CHART_COLOURS[2]!, refunded: CHART_COLOURS[5]! }
  return (
    <Card>
      <CardHeader eyebrow={range.label} title="Learning health" />
      <dl className="sa-overview__facts">
        <div>
          <dt>Active learners</dt>
          <dd>
            <a href={listUrl('enrollments', [['status', 'equals', 'active']], '-enrolledAt')}>{formatNumber(learning.activeLearners)}</a>
          </dd>
        </div>
        <div>
          <dt>
            Inactive 10+ days <InfoTip text={METRIC_DEFINITIONS.inactive} />
          </dt>
          <dd className={learning.inactiveLearners ? 'sa-overview__fact--caution' : undefined}>{formatNumber(learning.inactiveLearners)}</dd>
        </div>
        <div>
          <dt>Completion rate</dt>
          <dd>{formatPercent(learning.completionRate)}</dd>
        </div>
        <div>
          <dt>Completions</dt>
          <dd>
            <a href={listUrl('enrollments', [['completedAt', 'greater_than_equal', new Date(range.from).toISOString()]], '-completedAt')}>{formatNumber(learning.completions)}</a>
          </dd>
        </div>
        <div>
          <dt>Certificates sold</dt>
          <dd>{revenue ? formatNumber(revenue.certificatesSold) : '–'}</dd>
        </div>
      </dl>
      {learning.enrolmentStatus.length ? (
        <Donut
          title="Enrolments by status"
          centreLabel="enrolments"
          size={120}
          data={learning.enrolmentStatus.map((s, i) => ({ label: s.status, value: s.count, colour: colours[s.status] ?? CHART_COLOURS[(i + 3) % CHART_COLOURS.length]! }))}
        />
      ) : null}
    </Card>
  )
}

/* ------------------------------------------------------------------ Activity */

const ACTIVITY: Record<string, { icon: React.ReactNode; tone: TimelineItem['tone']; verb: string }> = {
  applicant: { icon: <UserPlus size={16} strokeWidth={1.75} />, tone: 'info', verb: 'applied' },
  payment: { icon: <Receipt size={16} strokeWidth={1.75} />, tone: 'positive', verb: 'paid' },
  certificate: { icon: <Award size={16} strokeWidth={1.75} />, tone: 'accent', verb: 'bought a certificate' },
  completion: { icon: <GraduationCap size={16} strokeWidth={1.75} />, tone: 'positive', verb: 'completed' },
  cancellation: { icon: <CircleSlash size={16} strokeWidth={1.75} />, tone: 'neutral', verb: 'cancelled' },
}

export async function ActivityPanel({ req }: { req: PayloadRequest }) {
  const events = await safe(() => getActivity(req))
  if (!events) return <PanelError title="Recent activity" />
  return (
    <Card>
      <CardHeader eyebrow="Latest 15" title="Recent activity" />
      {events.length ? (
        <Timeline
          items={events.map((event) => {
            const meta = ACTIVITY[event.kind]!
            return {
              id: event.id,
              icon: meta.icon,
              tone: meta.tone,
              title: (
                <>
                  {event.person} {meta.verb}
                  {event.amount ? <> {formatNaira(event.amount)}</> : null}
                </>
              ),
              meta: event.programme ?? undefined,
              at: event.at,
              href: event.href,
            }
          })}
        />
      ) : (
        <EmptyState icon={<Inbox size={22} strokeWidth={1.75} />} title="Nothing yet">
          Applications, payments and completions will appear here.
        </EmptyState>
      )}
    </Card>
  )
}
