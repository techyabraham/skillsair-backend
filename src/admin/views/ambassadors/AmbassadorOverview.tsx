import React from 'react'
import type { PayloadRequest } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { ambassadorSQL } from '../../../lib/ambassadors/db.js'
import { withTransaction } from '../../../lib/ambassadors/ledger.js'
import { Card, Money } from '../../ui/primitives'

interface Metrics { active: number; pending: number; commissions: number; awaiting: number; awaitingKobo: number; failed: number }
export async function AmbassadorOverview({ req }: { req: PayloadRequest }) {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const monthStart = new Date(Date.UTC(year, month - 1, 1, -1))
  const weekStart = new Date(now.getTime() - 7 * 86_400_000)
  const [row] = await withTransaction(req.payload, (txReq) => ambassadorSQL(req.payload, txReq, sql`
    SELECT
      (SELECT COUNT(*) FROM ambassadors WHERE status = 'active')::int AS active,
      (SELECT COUNT(*) FROM ambassadors WHERE status = 'pending')::int AS pending,
      (SELECT COALESCE(SUM(amount_kobo), 0) FROM ambassador_ledger WHERE type = 'commission' AND status IN ('pending','approved') AND created_at >= ${monthStart.toISOString()})::numeric AS commissions,
      (SELECT COUNT(*) FROM ambassador_payouts WHERE status = 'requested')::int AS awaiting,
      (SELECT COALESCE(SUM(amount_kobo), 0) FROM ambassador_payouts WHERE status = 'requested')::numeric AS awaiting_kobo,
      (SELECT COUNT(*) FROM ambassador_payouts WHERE status = 'failed' AND updated_at >= ${weekStart.toISOString()})::int AS failed`))
  const metrics: Metrics = { active: Number(row?.active ?? 0), pending: Number(row?.pending ?? 0), commissions: Number(row?.commissions ?? 0), awaiting: Number(row?.awaiting ?? 0), awaitingKobo: Number(row?.awaiting_kobo ?? 0), failed: Number(row?.failed ?? 0) }
  const figures: Array<{ label: string; value: React.ReactNode; href: string }> = [
    { label: 'Active ambassadors', value: metrics.active.toLocaleString('en-NG'), href: '/admin/ambassadors/directory?status=active' },
    { label: 'Pending applications', value: metrics.pending.toLocaleString('en-NG'), href: '/admin/ambassadors/applications' },
    { label: 'Commissions this month', value: <Money amount={metrics.commissions} />, href: '/admin/collections/ambassador-ledger' },
    { label: 'Payouts awaiting review', value: metrics.awaiting.toLocaleString('en-NG'), href: '/admin/ambassadors/payouts' },
    { label: 'Awaiting payout value', value: <Money amount={metrics.awaitingKobo} />, href: '/admin/ambassadors/payouts' },
    { label: 'Failed payouts · 7 days', value: metrics.failed.toLocaleString('en-NG'), href: '/admin/ambassadors/payouts?status=failed' },
  ]
  return <section className="sa-overview__section" aria-labelledby="ambassador-overview"><h2 id="ambassador-overview" className="sa-section-title">Ambassadors</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{figures.map((item) => <Card key={item.label} className="p-4"><a className="block no-underline" href={item.href}><p className="sa-muted">{item.label}</p><p className="mt-2 text-xl font-semibold text-ink">{item.value}</p></a></Card>)}</div><p className="mt-3"><a className="sa-link" href="/admin/ambassadors/directory">Open ambassador directory →</a></p></section>
}
