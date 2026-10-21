/**
 * Summary strips above list tables (`admin.components.beforeListTable`), brief 7.5, 7.8, 7.12:
 * the answer first (a few numbers), then quick filter chips that set the list's query params.
 * Server components; each checks the role from the list's `user` before reading anything.
 */
import React from 'react'
import type { Payload, TypedUser } from 'payload'
import { Money } from '../ui/primitives'
import { lagosMidnight, DAY } from '../../lib/lifecycle/timing'
import { accessGraceDays } from '../../lib/billing'
import { listUrl } from '../links'
import { monthlyValue } from '../data/metrics-core'
import { formatNumber } from '../format'

type StripProps = { payload: Payload; user?: TypedUser | null; searchParams?: Record<string, unknown> }

const isAdmin = (user: StripProps['user']) => (user as { role?: string } | null | undefined)?.role === 'admin'

function Strip({ label, figures, chips, current }: { label: string; figures: Array<{ label: string; value: React.ReactNode; href?: string; tone?: 'critical' }>; chips?: Array<{ label: string; href: string }>; current?: string }) {
  return (
    <section className="sa-strip" aria-label={label}>
      <dl className="sa-strip__figures">
        {figures.map((figure) => (
          <div key={figure.label} className={`sa-strip__figure${figure.tone ? ` sa-strip__figure--${figure.tone}` : ''}`}>
            <dt>{figure.label}</dt>
            <dd>{figure.href ? <a href={figure.href}>{figure.value}</a> : figure.value}</dd>
          </div>
        ))}
      </dl>
      {chips?.length ? (
        <nav className="sa-strip__chips" aria-label="Quick filters">
          {chips.map((chip) => (
            <a key={chip.label} className="sa-chip" href={chip.href} aria-current={current && chip.href.endsWith(current) ? 'page' : undefined}>
              {chip.label}
            </a>
          ))}
          <a className="sa-chip sa-chip--clear" href={chips[0]!.href.split('?')[0]}>
            Clear filters
          </a>
        </nav>
      ) : null}
    </section>
  )
}

const count = async (payload: Payload, collection: string, where: object) => (await payload.count({ collection: collection as never, where: where as never, overrideAccess: true })).totalDocs

export async function LeadsStrip({ payload, user }: StripProps) {
  if (!isAdmin(user)) return null
  const now = Date.now()
  const today = new Date(lagosMidnight(now)).toISOString()
  const week = new Date(lagosMidnight(now) - 6 * DAY).toISOString()
  const [todayCount, queue, paidWeek, waitlist] = await Promise.all([
    count(payload, 'leads', { createdAt: { greater_than_equal: today } }),
    count(payload, 'leads', { needsHuman: { equals: true } }),
    count(payload, 'leads', { and: [{ status: { equals: 'paid' } }, { updatedAt: { greater_than_equal: week } }] }),
    count(payload, 'leads', { waitlist: { equals: true } }),
  ])
  return (
    <Strip
      label="Applicants summary"
      figures={[
        { label: 'Applied today', value: formatNumber(todayCount), href: listUrl('leads', [['createdAt', 'greater_than_equal', today]], '-createdAt') },
        { label: 'In Imisi’s queue', value: formatNumber(queue), href: '/admin/queue' },
        { label: 'Paid this week', value: formatNumber(paidWeek), href: listUrl('leads', [['status', 'equals', 'paid'], ['updatedAt', 'greater_than_equal', week]], '-updatedAt') },
        { label: 'Waitlist', value: formatNumber(waitlist), href: listUrl('leads', [['waitlist', 'equals', true]], '-createdAt') },
      ]}
      chips={[
        { label: 'Needs reply', href: listUrl('leads', [['needsHuman', 'equals', true]], '-score') },
        { label: 'Waitlist', href: listUrl('leads', [['waitlist', 'equals', true]], '-createdAt') },
        { label: 'Paid', href: listUrl('leads', [['status', 'equals', 'paid']], '-updatedAt') },
        { label: 'Opted out', href: listUrl('leads', [['optedOutAt', 'exists', true]], '-optedOutAt') },
      ]}
    />
  )
}

async function sumOrders(payload: Payload, since: string) {
  const result = await payload.find({
    collection: 'orders',
    where: { and: [{ status: { equals: 'success' } }, { createdAt: { greater_than_equal: since } }] },
    limit: 10_000,
    depth: 0,
    pagination: false,
    overrideAccess: true,
    select: { amount: true, paidAt: true, createdAt: true } as never,
  })
  return result.docs as unknown as Array<{ amount: number; paidAt?: string; createdAt: string }>
}

export async function OrdersStrip({ payload, user }: StripProps) {
  if (!isAdmin(user)) return null
  const now = Date.now()
  const today = lagosMidnight(now)
  const week = today - 6 * DAY
  const month = new Date(new Date(today + 3_600_000).toISOString().slice(0, 8) + '01T00:00:00Z').getTime() - 3_600_000
  const from = Math.min(week, month)
  const [orders, failed] = await Promise.all([
    sumOrders(payload, new Date(from - DAY).toISOString()),
    count(payload, 'orders', { and: [{ status: { equals: 'failed' } }, { createdAt: { greater_than_equal: new Date(week).toISOString() } }] }),
  ])
  const total = (since: number) => orders.filter((o) => new Date(o.paidAt ?? o.createdAt).getTime() >= since).reduce((sum, o) => sum + Number(o.amount), 0)
  return (
    <Strip
      label="Orders summary"
      figures={[
        { label: 'Revenue today', value: <Money amount={total(today)} /> },
        { label: 'This week', value: <Money amount={total(week)} /> },
        { label: 'This month', value: <Money amount={total(month)} /> },
        { label: 'Failed this week', value: formatNumber(failed), tone: failed ? 'critical' : undefined, href: listUrl('orders', [['status', 'equals', 'failed']], '-createdAt') },
      ]}
      chips={[
        { label: 'Successful', href: listUrl('orders', [['status', 'equals', 'success']], '-createdAt') },
        { label: 'Failed', href: listUrl('orders', [['status', 'equals', 'failed']], '-createdAt') },
        { label: 'Certificates', href: listUrl('orders', [['type', 'equals', 'certificate']], '-createdAt') },
        { label: 'Pending', href: listUrl('orders', [['status', 'equals', 'pending']], '-createdAt') },
      ]}
    />
  )
}

export async function SubscriptionsStrip({ payload, user }: StripProps) {
  if (!isAdmin(user)) return null
  const now = Date.now()
  const monthStart = new Date(new Date(lagosMidnight(now) + 3_600_000).toISOString().slice(0, 8) + '01T00:00:00Z').getTime() - 3_600_000
  const graceStart = new Date(now - accessGraceDays() * DAY).toISOString()
  const [active, pastDue, cancelled] = await Promise.all([
    payload.find({
      collection: 'subscriptions',
      where: { or: [{ status: { equals: 'active' } }, { and: [{ status: { equals: 'past_due' } }, { lastFailedAt: { greater_than: graceStart } }] }] },
      limit: 10_000,
      depth: 0,
      pagination: false,
      overrideAccess: true,
      select: { plan: true } as never,
    }),
    count(payload, 'subscriptions', { status: { equals: 'past_due' } }),
    count(payload, 'subscriptions', { and: [{ status: { equals: 'cancelled' } }, { cancelledAt: { greater_than_equal: new Date(monthStart).toISOString() } }] }),
  ])
  const planIds = [...new Set((active.docs as unknown as Array<{ plan: number }>).map((d) => d.plan))]
  const plans = planIds.length
    ? ((await payload.find({ collection: 'plans', where: { id: { in: planIds } }, limit: planIds.length, depth: 0, pagination: false, overrideAccess: true, select: { price: true, interval: true } as never })).docs as unknown as Array<{ id: number; price: number; interval: string }>)
    : []
  const byId = new Map(plans.map((p) => [p.id, p]))
  const mrr = (active.docs as unknown as Array<{ plan: number }>).reduce((sum, d) => {
    const plan = byId.get(d.plan)
    return sum + (plan ? monthlyValue(Number(plan.price), plan.interval) : 0)
  }, 0)
  return (
    <Strip
      label="Subscriptions summary"
      figures={[
        { label: 'Active', value: formatNumber(active.totalDocs), href: listUrl('subscriptions', [['status', 'equals', 'active']], '-createdAt') },
        { label: 'Past due', value: formatNumber(pastDue), tone: pastDue ? 'critical' : undefined, href: listUrl('subscriptions', [['status', 'equals', 'past_due']], '-lastFailedAt') },
        { label: 'Cancelled this month', value: formatNumber(cancelled), href: listUrl('subscriptions', [['status', 'equals', 'cancelled']], '-cancelledAt') },
        { label: 'MRR', value: <Money amount={mrr} /> },
      ]}
      chips={[
        { label: 'Active', href: listUrl('subscriptions', [['status', 'equals', 'active']], '-createdAt') },
        { label: 'Past due', href: listUrl('subscriptions', [['status', 'equals', 'past_due']], '-lastFailedAt') },
        { label: 'Locked rate', href: listUrl('subscriptions', [['priceLocked', 'equals', true]], '-createdAt') },
        { label: 'Cancelled', href: listUrl('subscriptions', [['status', 'equals', 'cancelled']], '-cancelledAt') },
      ]}
    />
  )
}

export async function MediaStrip({ payload, user }: StripProps) {
  if (!user) return null
  const missing = await count(payload, 'media', { or: [{ alt: { exists: false } }, { alt: { equals: '' } }] })
  return (
    <Strip
      label="Media summary"
      figures={[{ label: 'Missing alt text', value: formatNumber(missing), tone: missing ? 'critical' : undefined, href: listUrl('media', [['alt', 'exists', false]], '-createdAt') }]}
      chips={[{ label: 'Missing alt text', href: listUrl('media', [['alt', 'exists', false]], '-createdAt') }]}
    />
  )
}
