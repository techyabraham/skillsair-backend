/**
 * One-off data seed for the career-pathway rebuild (run after the
 * 20261015_120000_rebuild_leads_pricing schema migration).
 *
 * For every published, paid programme that has no standard fee yet:
 *   - standardPrice        = 100000 (charged whenever no scholarship window is open)
 *   - standardMonthlyPrice = 40000  (display only)
 *   - price                = 2000   (the Access Scholarship price)
 * and ticks `phoneFriendly` for titles matching Canva Design, Smartphone Videography,
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

const STANDARD_PRICE = 100000
const STANDARD_MONTHLY_PRICE = 40000
const SCHOLARSHIP_PRICE = 2000
const PHONE_FRIENDLY_PATTERNS = [/canva/i, /smart\s?-?phone\s+videograph/i, /data\s+analy/i, /product\s+manag/i]

interface CourseRow {
  id: number
  title: string
  slug: string
  price: number
  standardPrice?: number | null
  phoneFriendly?: boolean | null
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
    if (!execute || Object.keys(data).length === 0) continue
    try {
      await payload.update({ collection: 'courses', id: course.id, data, overrideAccess: true })
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
  if (failed) console.log(`\nFailed updates: ${failed}`)
  process.exit(failed ? 1 : 0)
}

void run()
