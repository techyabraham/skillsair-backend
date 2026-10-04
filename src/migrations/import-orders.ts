/**
 * Imports historical payment records from a WordPress/TutorLMS CSV export into `orders`.
 *
 * Historical successful orders are marked fulfilled so the live fulfillment job does not
 * grant access again. Enrollments must be imported separately via import-enrollments.ts.
 *
 * Expected CSV columns:
 *   student_email, type (course|subscription|certificate), course_slug (for course/certificate),
 *   plan_name (for subscription), amount, currency (optional, default NGN),
 *   status (optional: pending|success|failed|refunded, default success),
 *   reference (required, unique), paystack_transaction_id (optional), paid_at (optional ISO date)
 *
 * Requires the referenced users, courses, and plans to already exist.
 *
 * Usage:
 *   node --loader ts-node/esm src/migrations/import-orders.ts <csv-path> [--execute]
 */
import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'

interface OrderCsvRow {
  student_email: string
  type: string
  course_slug?: string
  plan_name?: string
  amount: string
  currency?: string
  status?: string
  reference: string
  paystack_transaction_id?: string
  paid_at?: string
}

const VALID_TYPES = new Set(['course', 'subscription', 'certificate'])
const VALID_STATUSES = new Set(['pending', 'success', 'failed', 'refunded'])

interface Summary {
  total: number
  created: number
  skipped: number
  failed: number
}

async function run(): Promise<void> {
  const csvPath = process.argv[2]
  const execute = process.argv.includes('--execute')

  if (!csvPath) {
    console.error('Usage: import-orders.ts <csv-path> [--execute]')
    process.exitCode = 1
    return
  }

  const rows = parse(readFileSync(csvPath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as OrderCsvRow[]

  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })

  const summary: Summary = { total: rows.length, created: 0, skipped: 0, failed: 0 }

  const userIdByEmail = new Map<string, number | string>()
  const courseIdBySlug = new Map<string, number | string>()
  const planIdByName = new Map<string, number | string>()

  for (const [index, row] of rows.entries()) {
    const rowLabel = `row ${index + 2}`
    try {
      const email = row.student_email?.trim().toLowerCase()
      const type = row.type?.trim().toLowerCase()
      const reference = row.reference?.trim()
      if (!email) throw new Error('missing student_email')
      if (!type || !VALID_TYPES.has(type)) throw new Error(`invalid type: "${row.type ?? ''}"`)
      if (!reference) throw new Error('missing reference')

      const amount = Number(row.amount)
      if (!Number.isFinite(amount) || amount < 0) throw new Error(`invalid amount: "${row.amount}"`)
      const status = row.status?.trim().toLowerCase() || 'success'
      if (!VALID_STATUSES.has(status)) throw new Error(`invalid status: "${row.status ?? ''}"`)
      const currency = row.currency?.trim().toUpperCase() || 'NGN'

      let studentId = userIdByEmail.get(email)
      if (studentId === undefined) {
        const user = await payload.find({
          collection: 'users',
          where: { email: { equals: email } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        if (user.docs.length === 0) throw new Error(`no user found for email "${email}"`)
        studentId = user.docs[0]!.id as number | string
        userIdByEmail.set(email, studentId)
      }

      let courseId: number | string | undefined
      if (type === 'course' || type === 'certificate') {
        const courseSlug = row.course_slug?.trim()
        if (!courseSlug) throw new Error('missing course_slug')
        courseId = courseIdBySlug.get(courseSlug)
        if (courseId === undefined) {
          const course = await payload.find({
            collection: 'courses',
            where: { slug: { equals: courseSlug } },
            limit: 1,
            depth: 0,
            overrideAccess: true,
          })
          if (course.docs.length === 0) throw new Error(`no course found for slug "${courseSlug}"`)
          courseId = course.docs[0]!.id as number | string
          courseIdBySlug.set(courseSlug, courseId)
        }
      }

      let planId: number | string | undefined
      if (type === 'subscription') {
        const planName = row.plan_name?.trim()
        if (!planName) throw new Error('missing plan_name')
        planId = planIdByName.get(planName)
        if (planId === undefined) {
          const plan = await payload.find({
            collection: 'plans',
            where: { name: { equals: planName } },
            limit: 1,
            depth: 0,
            overrideAccess: true,
          })
          if (plan.docs.length === 0) throw new Error(`no plan found named "${planName}"`)
          planId = plan.docs[0]!.id as number | string
          planIdByName.set(planName, planId)
        }
      }

      const existing = await payload.find({
        collection: 'orders',
        where: { reference: { equals: reference } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      if (existing.docs.length > 0) {
        console.log(`SKIP  ${reference} (already exists)`)
        summary.skipped += 1
        continue
      }

      if (!execute) {
        console.log(`WOULD CREATE  ${reference} (${email}, ${type})`)
        summary.created += 1
        continue
      }

      await payload.create({
        collection: 'orders',
        data: {
          user: studentId,
          type: type as 'course' | 'subscription' | 'certificate',
          ...(courseId !== undefined ? { course: courseId } : {}),
          ...(planId !== undefined ? { plan: planId } : {}),
          amount,
          currency,
          status: status as 'pending' | 'success' | 'failed' | 'refunded',
          reference,
          ...(row.paystack_transaction_id ? { paystackTransactionId: row.paystack_transaction_id.trim() } : {}),
          ...(row.paid_at ? { paidAt: new Date(row.paid_at).toISOString() } : {}),
          ...(status === 'success' ? { fulfilledAt: row.paid_at ? new Date(row.paid_at).toISOString() : new Date().toISOString() } : {}),
        },
        overrideAccess: true,
      })
      console.log(`CREATED  ${reference}`)
      summary.created += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`FAILED  ${rowLabel}: ${message}`)
      summary.failed += 1
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`)
  console.log(`Total rows: ${summary.total}`)
  console.log(`Created: ${summary.created}`)
  console.log(`Skipped (existing): ${summary.skipped}`)
  console.log(`Failed: ${summary.failed}`)
}

run().catch((err: unknown) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
