/**
 * One-off data seed for the career-pathway rebuild (run after the
 * 20261015_120000_rebuild_leads_pricing schema migration).
 *
 * For every published, paid programme that has no standard fee yet:
 *   - standardPrice        = 100000 (one-off standard fee)
 *   - standardMonthlyPrice = 40000  (standard monthly fee)
 *   - price                = 2000   (Access Scholarship price per month)
 * and, for every paid programme, the two monthly Paystack plans if they don't exist yet:
 *   - "Access Scholarship" plan: ₦2,000 a month (kind scholarship; only sold while a window is open)
 *   - "Standard monthly" plan:   ₦40,000 a month (kind standard)
 * Creating plans calls the Paystack API, so it needs PAYSTACK_SECRET_KEY and --execute. The
 * Paystack plan charges the price plus the Paystack fee (₦2,031 for ₦2,000; see billing.ts).
 * and ticks `phoneFriendly` for titles matching Canva Design, Smartphone Videography, Mobile Graphics Design, Mobile Streaming,
 * Data Analysis or Product Management (the owner confirms or adjusts these in the admin).
 *
 * Free courses (price 0, e.g. bonus courses) are left untouched and listed.
 * Dry run by default; nothing is written without --execute.
 *
 * Usage:
 *   npm run seed:rebuild-pricing [-- --execute]
 */
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import { createPlan } from '../lib/paystack.js'
import { withPaystackFee } from '../lib/billing.js'

const STANDARD_PRICE = 100000
const STANDARD_MONTHLY_PRICE = 40000
const SCHOLARSHIP_PRICE = 2000
const PHONE_FRIENDLY_PATTERNS = [/canva/i, /smart\s?-?phone\s+videograph/i, /mobile\s+graphic/i, /mobile\s+stream/i, /data\s+analy/i, /product\s+manag/i]

interface CourseRow {
  id: number
  title: string
  slug: string
  price: number
  standardPrice?: number | null
  phoneFriendly?: boolean | null
}

interface PlanSpec {
  kind: 'scholarship' | 'standard'
  name: string
  price: number
}

/** Ensures the course has an active monthly plan of each kind with a Paystack plan code. */
async function ensurePlans(payload: Payload, course: CourseRow, execute: boolean, report: string[]): Promise<void> {
  const specs: PlanSpec[] = [
    { kind: 'scholarship', name: `${course.title}: Access Scholarship (monthly)`, price: SCHOLARSHIP_PRICE },
    { kind: 'standard', name: `${course.title}: Standard (monthly)`, price: STANDARD_MONTHLY_PRICE },
  ]
  const existing = await payload.find({
    collection: 'plans',
    where: { and: [{ course: { equals: course.id } }, { interval: { equals: 'monthly' } }, { isActive: { equals: true } }] },
    limit: 20,
    depth: 0,
    overrideAccess: true,
  })
  for (const spec of specs) {
    const found = existing.docs.find((plan) => (plan.kind ?? 'standard') === spec.kind && plan.paystackPlanCode)
    if (found) {
      report.push(`${course.title}: ${spec.kind} plan exists (₦${found.price}/month, ${found.paystackPlanCode})`)
      continue
    }
    if (!execute) {
      report.push(`${course.title}: would create ${spec.kind} plan ₦${spec.price}/month (₦${withPaystackFee(spec.price)} with the Paystack fee) on Paystack`)
      continue
    }
    if (!process.env.PAYSTACK_SECRET_KEY) {
      report.push(`${course.title}: SKIPPED ${spec.kind} plan (PAYSTACK_SECRET_KEY not set)`)
      continue
    }
    const code = await createPlan(spec.name, withPaystackFee(spec.price), 'monthly')
    await payload.create({
      collection: 'plans',
      data: { name: spec.name, course: course.id, price: spec.price, interval: 'monthly', kind: spec.kind, paystackPlanCode: code, isActive: true },
      overrideAccess: true,
    })
    report.push(`${course.title}: created ${spec.kind} plan ₦${spec.price}/month (${code})`)
  }
}

async function run(): Promise<void> {
  const execute = process.argv.includes('--execute')
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })

  const result = await payload.find({
    collection: 'courses',
    where: { status: { equals: 'published' } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  const courses = result.docs as unknown as CourseRow[]

  const priced: string[] = []
  const alreadyPriced: string[] = []
  const free: string[] = []
  const phoneFriendly: string[] = []
  const plans: string[] = []
  let failed = 0

  for (const course of courses) {
    const data: Record<string, unknown> = {}
    if (course.price <= 0) free.push(course.title)
    else if (course.standardPrice) alreadyPriced.push(`${course.title} (standard ₦${course.standardPrice}, scholarship ₦${course.price})`)
    else {
      Object.assign(data, { standardPrice: STANDARD_PRICE, standardMonthlyPrice: STANDARD_MONTHLY_PRICE, price: SCHOLARSHIP_PRICE })
      priced.push(`${course.title}: ₦${course.price} -> scholarship ₦${SCHOLARSHIP_PRICE}, standard ₦${STANDARD_PRICE}`)
    }
    if (!course.phoneFriendly && PHONE_FRIENDLY_PATTERNS.some((pattern) => pattern.test(course.title))) {
      data.phoneFriendly = true
      phoneFriendly.push(course.title)
    }
    try {
      if (execute && Object.keys(data).length) await payload.update({ collection: 'courses', id: course.id, data, overrideAccess: true })
      if (course.price > 0) await ensurePlans(payload, course, execute, plans)
    } catch (err) {
      failed++
      console.error(`Failed to update ${course.slug}:`, err instanceof Error ? err.message : err)
    }
  }

  const section = (title: string, rows: string[]) => console.log(`\n${title} (${rows.length})\n${rows.map((row) => `  - ${row}`).join('\n') || '  (none)'}`)
  console.log(execute ? 'EXECUTED: changes written.' : 'DRY RUN: no changes written. Re-run with --execute to apply.')
  section('Programmes to price', priced)
  section('Already priced (unchanged)', alreadyPriced)
  section('Free courses (unchanged)', free)
  section('Phone-friendly matches (owner to confirm)', phoneFriendly)
  section('Monthly plans', plans)
  if (failed) console.log(`\nFailed updates: ${failed}`)
  process.exit(failed ? 1 : 0)
}

void run()
