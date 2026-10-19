import type { CollectionAfterChangeHook, Payload } from 'payload'
import { generateCertificatePdf, uploadCertificatePdf } from '../../lib/pdf-certificate.js'
import { generateCertificateCode } from '../../utils/generate-code.js'
import { logger } from '../../lib/logger.js'
import { certificatePrice } from '../../lib/pricing.js'
import { disableAtPaystack, stopBillingOnComplete } from '../../lib/billing.js'
import { onLifecycleEvent } from '../../lib/lifecycle/events.js'

interface UserDoc {
  email: string
  firstName: string
  lastName: string
}

interface CourseDoc {
  title: string
  slug: string
  instructor: unknown
}

function relationId(value: unknown): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return (value as { id: number | string }).id
  }
  return value as number | string
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

/**
 * "Billed monthly until you finish": when a learner completes a programme, its monthly plan is
 * switched off at Paystack. They keep access to the end of the month they've paid for.
 * Owner switch: STOP_BILLING_ON_COMPLETE=false keeps billing until the learner cancels.
 */
export async function stopBillingForCompletedProgramme(payload: Payload, studentId: number | string, courseId: number | string): Promise<boolean> {
  if (!stopBillingOnComplete()) return false
  const live = await payload.find({
    collection: 'subscriptions',
    where: { and: [{ user: { equals: studentId } }, { course: { equals: courseId } }, { status: { in: ['active', 'past_due'] } }] },
    limit: 5,
    depth: 0,
    overrideAccess: true,
  })
  let stopped = false
  for (const doc of live.docs as unknown as Array<{ id: number; status: string; paystackSubscriptionCode?: string | null; paystackEmailToken?: string | null }>) {
    const disabled = await disableAtPaystack(doc, 'programme_completed')
    if (!disabled) continue
    await payload.update({
      collection: 'subscriptions',
      id: doc.id,
      // An active plan runs to the end of its paid month; a past-due one has nothing left to run.
      data: { status: doc.status === 'active' ? 'cancelled' : 'expired', cancelledAt: new Date().toISOString() },
      overrideAccess: true,
    })
    stopped = true
  }
  return stopped
}

/** Generates and uploads a course-completion certificate PDF, records it, and emails the student. */
export async function issueCertificate(
  payload: Payload,
  studentId: number | string,
  courseId: number | string,
  /** The paid certificate order, shown as a receipt in the certificate email (T9). */
  receipt?: { reference: string; amount: number; paidAt: string },
): Promise<unknown> {
  const existing = await payload.find({
    collection: 'certificates',
    where: { and: [{ student: { equals: studentId } }, { course: { equals: courseId } }] },
    limit: 1,
  })
  if (existing.totalDocs > 0) {
    return existing.docs[0]
  }

  const student = (await payload.findByID({
    collection: 'users',
    id: studentId,
    depth: 0,
  })) as unknown as UserDoc
  const course = (await payload.findByID({
    collection: 'courses',
    id: courseId,
    depth: 1,
  })) as unknown as CourseDoc

  const instructorId = relationId(course.instructor)
  let instructorName = 'SkillsAir'
  if (instructorId !== undefined) {
    const instructor = (await payload.findByID({
      collection: 'users',
      id: instructorId,
      depth: 0,
    })) as unknown as UserDoc
    instructorName = `${instructor.firstName} ${instructor.lastName}`
  }

  const certificateCode = generateCertificateCode()
  const verificationUrl = `${FRONTEND_URL}/certificates/verify/${certificateCode}`
  const studentFullName = `${student.firstName} ${student.lastName}`
  const completionDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const pdfBuffer = await generateCertificatePdf({
    studentFullName,
    courseTitle: course.title,
    instructorName,
    completionDate,
    certificateCode,
    verificationUrl,
  })
  const pdfUrl = await uploadCertificatePdf(Number(studentId), certificateCode, pdfBuffer)

  const certificate = await payload.create({
    collection: 'certificates',
    data: {
      student: studentId,
      course: courseId,
      certificateCode,
      pdfUrl,
      issuedAt: new Date().toISOString(),
    },
    overrideAccess: true,
  })


  await onLifecycleEvent(payload, { type: 'certificate_issued', userId: Number(studentId), courseId: Number(courseId), ...(receipt ? { receipt: { ...receipt, paidAt: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date(receipt.paidAt)) } } : {}) })

  return certificate
}

export const afterComplete: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update') return doc
  if (doc.status !== 'completed' || previousDoc?.status === 'completed') return doc

  const completedStudentId = relationId(doc.student)
  const completedCourseId = relationId(doc.course)
  if (completedStudentId !== undefined && completedCourseId !== undefined) {
    let billingStopped = false
    try {
      billingStopped = await stopBillingForCompletedProgramme(req.payload, completedStudentId, completedCourseId)
    } catch (err) {
      logger.error({ err, enrollmentId: doc.id }, 'stop_billing_on_complete_failed')
    }
    await onLifecycleEvent(req.payload, {
      type: 'enrollment_completed',
      userId: Number(completedStudentId),
      courseId: Number(completedCourseId),
      enrollmentId: Number(doc.id),
      billingStopped,
    })
  }

  // With a certificate fee, the completion email (T8, sent through the completion event above) offers it.
  if (certificatePrice() > 0) return doc
  try {
    const studentId = relationId(doc.student)
    const courseId = relationId(doc.course)
    if (studentId === undefined || courseId === undefined) return doc
    await issueCertificate(req.payload, studentId, courseId)
  } catch (err) {
    logger.error({ err, enrollmentId: doc.id }, 'course_completion_certificate_failed')
  }
  return doc
}
