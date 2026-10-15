import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { requireInstructorOrAdmin } from '../../middleware/authorize.js'
import { issueCertificate } from '../../hooks/courses/afterComplete.js'
import { AppError } from '../../types/index.js'
import { certificatePrice } from '../../lib/pricing.js'

const generateSchema = z.object({
  studentId: z.string().min(1),
  courseId: z.string().min(1),
})

interface EnrollmentDoc {
  status: 'active' | 'completed' | 'refunded'
}

async function handler(req: PayloadRequest): Promise<Response> {
  const issuer = await requireInstructorOrAdmin(req)
  if (certificatePrice() > 0 && issuer.role !== 'admin') {
    throw new AppError('INSUFFICIENT_PERMISSION', 'Only an admin can issue a paid certificate without purchase')
  }
  const body = parseBody(generateSchema, await readJsonBody(req))
  const payload = req.payload

  const enrollments = await payload.find({
    collection: 'enrollments',
    where: {
      and: [{ student: { equals: body.studentId } }, { course: { equals: body.courseId } }],
    },
    limit: 1,
  })
  const enrollment = enrollments.docs[0] as unknown as EnrollmentDoc | undefined
  if (!enrollment || enrollment.status !== 'completed') {
    throw new AppError('VALIDATION_ERROR', 'Student has not completed this course')
  }

  const certificate = await issueCertificate(payload, body.studentId, body.courseId)
  return sendSuccess(certificate, undefined, 201)
}

export const generateCertificateEndpoint: Endpoint = {
  path: '/certificates/generate',
  method: 'post',
  handler: asyncHandler(handler),
}
