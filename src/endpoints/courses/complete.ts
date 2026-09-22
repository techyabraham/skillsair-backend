import type { Endpoint, PayloadRequest } from 'payload'
import { sendSuccess, asyncHandler, getParam } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'

interface EnrollmentDoc {
  id: number
  status: 'active' | 'completed' | 'refunded'
}

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const courseId = getParam(req, 'courseId')
  if (!isValidPayloadId(courseId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid course id')
  }

  const payload = req.payload

  const enrollments = await payload.find({
    collection: 'enrollments',
    where: {
      and: [
        { student: { equals: user.id } },
        { course: { equals: courseId } },
        { status: { not_equals: 'refunded' } },
      ],
    },
    limit: 1,
  })
  const enrollment = enrollments.docs[0] as unknown as EnrollmentDoc | undefined
  if (!enrollment) {
    throw new AppError('INSUFFICIENT_PERMISSION', 'You are not enrolled in this course')
  }

  if (enrollment.status === 'completed') {
    return sendSuccess(enrollment)
  }

  const updated = await payload.update({
    collection: 'enrollments',
    id: enrollment.id,
    data: { status: 'completed', completedAt: new Date().toISOString(), progressPercent: 100 },
    overrideAccess: true,
  })

  return sendSuccess(updated)
}

export const completeEndpoint: Endpoint = {
  path: '/courses/:courseId/complete',
  method: 'post',
  handler: asyncHandler(handler),
}
