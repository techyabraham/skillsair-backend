import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, getParam, readJsonBody } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'
import { getLessonCourse, refreshEnrollmentProgress, requireCourseAccess } from '../../lib/course-access.js'

const progressSchema = z.object({
  watchedSeconds: z.number().min(0),
  isCompleted: z.boolean().optional(),
})

interface EnrollmentDoc {
  id: number
  status: 'active' | 'completed' | 'refunded'
  progressPercent: number
}

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const courseId = getParam(req, 'courseId')
  const lessonId = getParam(req, 'lessonId')
  if (!isValidPayloadId(courseId) || !isValidPayloadId(lessonId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid course or lesson id')
  }
  const body = parseBody(progressSchema, await readJsonBody(req))

  const payload = req.payload
  const { courseId: actualCourseId, lesson } = await getLessonCourse(payload, lessonId)
  if (String(actualCourseId) !== String(courseId)) throw new AppError('VALIDATION_ERROR', 'Lesson does not belong to this course')
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

  const existingProgress = await payload.find({
    collection: 'lesson-progress',
    where: { and: [{ student: { equals: user.id } }, { lesson: { equals: lessonId } }] },
    limit: 1,
  })

  const now = new Date().toISOString()
  const previousSeconds = Number(existingProgress.docs[0]?.watchedSeconds ?? 0)
  const watchedSeconds = Math.max(previousSeconds, body.watchedSeconds)
  const duration = Number(lesson.duration ?? 0)
  if (body.isCompleted && duration > 0 && watchedSeconds < Math.max(0, duration - 5)) {
    throw new AppError('VALIDATION_ERROR', 'Lesson viewing requirement has not been met')
  }
  const progressData = {
    watchedSeconds,
    lastWatchedAt: now,
    ...(body.isCompleted ? { isCompleted: true, completedAt: now } : {}),
  }

  let progressDoc
  if (existingProgress.totalDocs > 0) {
    const existingId = existingProgress.docs[0]?.id as number
    progressDoc = await payload.update({
      collection: 'lesson-progress',
      id: existingId,
      data: progressData,
      overrideAccess: true,
    })
  } else {
    progressDoc = await payload.create({
      collection: 'lesson-progress',
      data: {
        student: user.id,
        lesson: lessonId,
        course: courseId,
        ...progressData,
      },
      overrideAccess: true,
    })
  }

  const updatedEnrollment = await refreshEnrollmentProgress(payload, enrollment.id, user.id, courseId)

  return sendSuccess({ progress: progressDoc, enrollment: updatedEnrollment })
}

export const progressEndpoint: Endpoint = {
  path: '/courses/:courseId/lessons/:lessonId/progress',
  method: 'post',
  handler: asyncHandler(handler),
}
