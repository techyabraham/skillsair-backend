import type { Endpoint, PayloadRequest } from 'payload'
import { sendSuccess, asyncHandler, getParam } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'
import { courseCompletion, requireCourseAccess } from '../../lib/course-access.js'

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
  await requireCourseAccess(payload, user.id, courseId)

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
  const completion = await courseCompletion(payload, user.id, courseId)
  if ((!completion.total && !completion.totalQuizzes) || completion.completed !== completion.total || completion.passedQuizzes !== completion.totalQuizzes) {
    throw new AppError('VALIDATION_ERROR', 'Complete all published lessons and pass all quizzes before finishing the course')
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
