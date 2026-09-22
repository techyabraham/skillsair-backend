import type { Endpoint, PayloadRequest } from 'payload'
import { sendSuccess, asyncHandler, getParam } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'

interface CourseDoc {
  id: number
  status: 'draft' | 'published'
  price: number
}

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const courseId = getParam(req, 'courseId')
  if (!isValidPayloadId(courseId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid course id')
  }

  const payload = req.payload
  const course = (await payload
    .findByID({ collection: 'courses', id: courseId, depth: 0 })
    .catch(() => null)) as unknown as CourseDoc | null

  if (!course || course.status !== 'published') {
    throw new AppError('NOT_FOUND', 'Course not found')
  }
  if (course.price > 0) {
    throw new AppError('PAYMENT_REQUIRED', 'This course requires payment before enrollment')
  }

  const existing = await payload.find({
    collection: 'enrollments',
    where: { and: [{ student: { equals: user.id } }, { course: { equals: course.id } }] },
    limit: 1,
  })
  if (existing.totalDocs > 0) {
    throw new AppError('ALREADY_EXISTS', 'You are already enrolled in this course')
  }

  const enrollment = await payload.create({
    collection: 'enrollments',
    data: {
      student: user.id,
      course: course.id,
      status: 'active',
    },
    overrideAccess: true,
  })

  return sendSuccess(enrollment, undefined, 201)
}

export const enrollEndpoint: Endpoint = {
  path: '/courses/:courseId/enroll',
  method: 'post',
  handler: asyncHandler(handler),
}
