/**
 * Imports student course enrollments from a WordPress/TutorLMS CSV export.
 *
 * Expected CSV columns:
 *   student_email, course_slug, status (optional: active|completed|refunded, default active),
 *   enrolled_at (optional ISO date), completed_at (optional ISO date),
 *   progress_percent (optional 0-100, default 0), order_id (optional)
 *
 * Requires the referenced users (import-users.ts) and courses (import-courses.ts)
 * to already exist.
 *
 * Usage:
 *   node --loader ts-node/esm src/migrations/import-enrollments.ts <csv-path> [--execute]
 */
import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'

interface EnrollmentCsvRow {
  student_email: string
  course_slug: string
  status?: string
  enrolled_at?: string
  completed_at?: string
  progress_percent?: string
  order_id?: string
}

const VALID_STATUSES = new Set(['active', 'completed', 'refunded'])

interface Summary {
  total: number
  created: number
  skipped: number
  studentsMarked: number
  failed: number
}

async function run(): Promise<void> {
  const csvPath = process.argv[2]
  const execute = process.argv.includes('--execute')

  if (!csvPath) {
    console.error('Usage: import-enrollments.ts <csv-path> [--execute]')
    process.exitCode = 1
    return
  }

  const rows = parse(readFileSync(csvPath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as EnrollmentCsvRow[]

  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })

  const summary: Summary = { total: rows.length, created: 0, skipped: 0, studentsMarked: 0, failed: 0 }

  const userIdByEmail = new Map<string, number | string>()
  const studentFlagByEmail = new Map<string, boolean>()
  const courseIdBySlug = new Map<string, number | string>()

  for (const [index, row] of rows.entries()) {
    const rowLabel = `row ${index + 2}`
    try {
      const email = row.student_email?.trim().toLowerCase()
      const courseSlug = row.course_slug?.trim()
      if (!email) throw new Error('missing student_email')
      if (!courseSlug) throw new Error('missing course_slug')

      const status = row.status?.trim().toLowerCase() || 'active'
      if (!VALID_STATUSES.has(status)) throw new Error(`invalid status: "${row.status ?? ''}"`)
      const progressPercent = row.progress_percent ? Number(row.progress_percent) : 0
      if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) {
        throw new Error(`invalid progress_percent: "${row.progress_percent ?? ''}"`)
      }

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
        studentFlagByEmail.set(email, Boolean((user.docs[0] as { isStudent?: boolean }).isStudent))
      }

      let courseId = courseIdBySlug.get(courseSlug)
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

      if (!studentFlagByEmail.get(email)) {
        if (!execute) {
          console.log(`WOULD MARK STUDENT  ${email} (has a Tutor LMS enrollment)`)
        } else {
          await payload.update({
            collection: 'users',
            id: studentId,
            data: { isStudent: true },
            overrideAccess: true,
          })
          console.log(`MARKED STUDENT  ${email}`)
        }
        studentFlagByEmail.set(email, true)
        summary.studentsMarked += 1
      }

      const existing = await payload.find({
        collection: 'enrollments',
        where: { and: [{ student: { equals: studentId } }, { course: { equals: courseId } }] },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      if (existing.docs.length > 0) {
        console.log(`SKIP  ${email} / ${courseSlug} (already enrolled)`)
        summary.skipped += 1
        continue
      }

      if (!execute) {
        console.log(`WOULD CREATE  ${email} / ${courseSlug}`)
        summary.created += 1
        continue
      }

      await payload.create({
        collection: 'enrollments',
        data: {
          student: studentId,
          course: courseId,
          status: status as 'active' | 'completed' | 'refunded',
          progressPercent,
          ...(row.enrolled_at ? { enrolledAt: new Date(row.enrolled_at).toISOString() } : {}),
          ...(row.completed_at ? { completedAt: new Date(row.completed_at).toISOString() } : {}),
          ...(row.order_id ? { orderId: row.order_id.trim() } : {}),
        },
        context: { skipEnrollmentEmail: true },
        overrideAccess: true,
      })
      console.log(`CREATED  ${email} / ${courseSlug}`)
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
  console.log(`Students marked: ${summary.studentsMarked}`)
  console.log(`Failed: ${summary.failed}`)
}

run().catch((err: unknown) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
