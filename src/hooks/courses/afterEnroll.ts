import type { CollectionAfterChangeHook } from 'payload'
import { enrollmentConfirmationEmail, sendEmail } from '../../lib/resend.js'
import { afterCommit } from '../../lib/after-commit.js'

interface UserDoc {
  email: string
  firstName: string
}

interface CourseDoc {
  title: string
  slug: string
}

function relationId(value: unknown): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return (value as { id: number | string }).id
  }
  return value as number | string
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

export const afterEnroll: CollectionAfterChangeHook = async ({ context, doc, operation, req }) => {
  if (operation !== 'create' || context?.skipEnrollmentEmail === true) return doc
  // Paid enrolments get the welcome-and-receipt email (T1) instead.
  if (doc.orderId) return doc
  const { payload } = req
  afterCommit('enrollment_confirmation_email', async () => {
    const studentId = relationId(doc.student)
    const courseId = relationId(doc.course)
    if (studentId === undefined || courseId === undefined) return
    const student = (await payload.findByID({
      collection: 'users',
      id: studentId,
      depth: 0,
    })) as unknown as UserDoc
    const course = (await payload.findByID({
      collection: 'courses',
      id: courseId,
      depth: 0,
    })) as unknown as CourseDoc
    const content = enrollmentConfirmationEmail(
      student.firstName,
      course.title,
      `${FRONTEND_URL}/courses/${course.slug}`,
    )
    await sendEmail(student.email, content)
  })
  return doc
}
