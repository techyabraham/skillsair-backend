/**
 * Checks SkillsAir Studio's Overview numbers against independent Local API counts, and measures
 * the Overview's database round trips and render-data time (brief 12: ≤ 8 round trips,
 * ≤ 600 ms warm, ≤ 1.5 s cold). Read-only; safe on any database you may read, but intended for
 * local or staging.
 *
 *   node --loader ts-node/esm scripts/studio-metrics-check.ts
 */
import assert from 'node:assert/strict'
import pg from 'pg'
import type { PayloadRequest } from 'payload'

const { getPayload } = await import('payload')
const { default: config } = await import('../payload.config.js')
const payload = await getPayload({ config })
const { getAdmissions, getRevenue, getLearning, getAttention, getActivity } = await import('../src/admin/data/metrics.js')
const { getWindowState } = await import('../src/admin/data/nav.js')
const { invalidate } = await import('../src/admin/data/cache.js')
const { periodRange } = await import('../src/admin/data/metrics-core.js')
const { accessGraceDays } = await import('../src/lib/billing.js')

const admin = (await payload.find({ collection: 'users', where: { role: { equals: 'admin' } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
if (!admin) throw new Error('No admin user to run the check as')
const req = { payload, user: { ...admin, collection: 'users' } } as unknown as PayloadRequest

// Count every query that reaches Postgres.
let queries = 0
const original = pg.Client.prototype.query
;(pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown }).query = function (this: pg.Client, ...args: unknown[]) {
  queries++
  return (original as unknown as (...a: unknown[]) => unknown).apply(this, args)
}

const now = Date.now()
const window = await getWindowState(req)
const range = periodRange('7d', now, window.opensAt)
const iso = (ms: number) => new Date(ms).toISOString()
const inRange = { and: [{ createdAt: { greater_than_equal: iso(range.from) } }, { createdAt: { less_than: iso(range.to) } }] }
const count = async (collection: string, where: object) => (await payload.count({ collection: collection as never, where: where as never, overrideAccess: true })).totalDocs

invalidate()
const [admissions, revenue, learning] = await Promise.all([getAdmissions(req, range), getRevenue(req, range), getLearning(req, range)])

// Admissions funnel
assert.equal(admissions.current.applicants, await count('leads', inRange), 'applicants')
assert.equal(admissions.current.paid, await count('leads', { and: [...inRange.and, { status: { equals: 'paid' } }] }), 'paid')
assert.equal(admissions.current.accounts, await count('leads', { and: [...inRange.and, { status: { in: ['account_created', 'paid'] } }] }), 'accounts')
assert.equal(admissions.current.offerViewed, await count('leads', { and: [...inRange.and, { offerViewCount: { greater_than: 0 } }] }), 'offer viewed')
assert.equal(admissions.queue.waiting, await count('leads', { needsHuman: { equals: true } }), 'queue')

// Revenue: successful orders paid (or, without paidAt, created) in the period
const orders = await payload.find({ collection: 'orders', where: { status: { equals: 'success' } }, limit: 10000, depth: 0, overrideAccess: true, pagination: false })
const revenueTotal = (orders.docs as unknown as Array<{ amount: number; paidAt?: string; createdAt: string }>)
  .filter((o) => {
    const at = new Date(o.paidAt ?? o.createdAt).getTime()
    return at >= range.from && at < range.to
  })
  .reduce((sum, o) => sum + Number(o.amount), 0)
assert.equal(revenue.total, revenueTotal, 'revenue total')
assert.equal(revenue.pastDue, await count('subscriptions', { status: { equals: 'past_due' } }), 'past due')
const graceStart = iso(now - accessGraceDays() * 86_400_000)
const activeSubs = (await count('subscriptions', { status: { equals: 'active' } })) + (await count('subscriptions', { and: [{ status: { equals: 'past_due' } }, { lastFailedAt: { greater_than: graceStart } }] }))
assert.equal(revenue.activeSubscribers, activeSubs, 'active subscribers')

// Learning
assert.equal(learning.completions, await count('enrollments', { and: [{ completedAt: { greater_than_equal: iso(range.from) } }, { completedAt: { less_than: iso(range.to) } }] }), 'completions')

console.log('✓ Overview numbers match the Local API counts:', {
  applicants: admissions.current.applicants,
  paid: admissions.current.paid,
  revenue: revenue.total,
  activeSubscribers: revenue.activeSubscribers,
  completions: learning.completions,
})

// Round trips and timing for the whole Overview (cold, then warm).
async function overview() {
  const started = performance.now()
  queries = 0
  const w = await getWindowState(req)
  const r = periodRange('7d', Date.now(), w.opensAt)
  await Promise.all([getAdmissions(req, r), getRevenue(req, r), getLearning(req, r), getAttention(req, r), getActivity(req)])
  return { ms: Math.round(performance.now() - started), queries }
}
invalidate()
const cold = await overview()
const warm = await overview()
console.log(`Overview data, cold: ${cold.ms} ms, ${cold.queries} database round trips`)
console.log(`Overview data, warm (cached): ${warm.ms} ms, ${warm.queries} database round trips`)
assert.ok(cold.queries <= 8, `Overview needs ${cold.queries} round trips (budget 8)`)
process.exit(0)
