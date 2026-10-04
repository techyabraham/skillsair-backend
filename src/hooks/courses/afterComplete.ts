import type { CollectionAfterChangeHook, Payload } from 'payload'
import { generateCertificatePdf, uploadCertificatePdf } from '../../lib/pdf-certificate.js'
import { generateCertificateCode } from '../../utils/generate-code.js'
import { courseCompletionEmail, certificateUnlockedEmail, sendEmail } from '../../lib/resend.js'
import { logger } from '../../lib/logger.js'

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

/** Generates and uploads a course-completion certificate PDF, records it, and emails the student. */
export async function issueCertificate(
  payload: Payload,
  studentId: number | string,
  courseId: number | string,
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

  await sendEmail(student.email, courseCompletionEmail(student.firstName, course.title, verificationUrl))
  await sendEmail(student.email, certificateUnlockedEmail(student.firstName, pdfUrl, verificationUrl))

  return certificate
}

export const afterComplete: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update') return doc
  if (doc.status !== 'completed' || previousDoc?.status === 'completed') return doc

  if (Number(process.env.CERTIFICATE_PRICE_NGN ?? '5000') > 0) return doc
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
