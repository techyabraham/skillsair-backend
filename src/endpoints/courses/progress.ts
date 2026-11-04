import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, getParam, readJsonBody } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'
import { getLessonCourse, refreshEnrollmentProgress, requireCourseAccess } from '../../lib/course-access.js'
import { driveVideoSeconds, requiredWatchSeconds, roughLength } from '../../lib/lesson-viewing.js'
import { logger } from '../../lib/logger.js'

/**
 * watchedDelta: seconds watched since the player last reported, added to what is stored, so time
 * watched on another visit or device counts. watchedSeconds (a total for one visit) is the older
 * form; the larger of it and the stored total is kept.
 */
const progressSchema = z.object({
  watchedSeconds: z.number().min(0).optional(),
  watchedDelta: z.number().min(0).max(6 * 60 * 60).optional(),
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
  const existing = existingProgress.docs[0]
  const previousSeconds = Number(existing?.watchedSeconds ?? 0)
  let duration = Number(lesson.duration ?? 0)
  const added = body.watchedDelta !== undefined ? previousSeconds + body.watchedDelta : Math.max(previousSeconds, body.watchedSeconds ?? 0)
  // Never more than the video's length (rewatching doesn't pile up), unless the length is unknown.
  let watchedSeconds = Math.max(previousSeconds, duration > 0 ? Math.min(added, Math.max(duration, previousSeconds)) : added)

  // A stored length can be wrong (lessons imported from WordPress kept Tutor's): before refusing a
  // completion, check the video's real length on Drive and correct the lesson if it differs.
  const driveFileId = (lesson as { driveFileId?: string | null }).driveFileId
  if (body.isCompleted && !existing?.isCompleted && duration > 0 && watchedSeconds < requiredWatchSeconds(duration) && driveFileId) {
    const real = await driveVideoSeconds(driveFileId).catch(() => null)
    if (real && Math.abs(real - duration) > 1) {
      logger.info({ lessonId: Number(lessonId), from: duration, to: real }, 'lesson_duration_corrected')
      await payload.update({ collection: 'lessons', id: lesson.id, data: { duration: real }, overrideAccess: true })
        .catch((err: unknown) => logger.warn({ err, lessonId: Number(lessonId) }, 'lesson_duration_correct_failed'))
      duration = real
      watchedSeconds = Math.max(previousSeconds, Math.min(added, Math.max(duration, previousSeconds)))
    }
  }
  const required = requiredWatchSeconds(duration)
  const unmet = Boolean(body.isCompleted) && !existing?.isCompleted && watchedSeconds < required

  // Player heartbeats (every 30 s while a video plays, isCompleted false) only move watchedSeconds
  // forward: no write when nothing changed and no enrolment recalculation, which completions do.
  const heartbeat = !body.isCompleted || unmet
  if (heartbeat && existing && (existing.isCompleted || watchedSeconds <= previousSeconds)) {
    if (unmet) throw notWatched(required - watchedSeconds)
    return sendSuccess({ progress: existing, enrollment: null })
  }
  const progressData = {
    watchedSeconds,
    lastWatchedAt: now,
    ...(body.isCompleted && !unmet ? { isCompleted: true, completedAt: existing?.completedAt ?? now } : {}),
  }

  let progressDoc
  if (existing) {
    progressDoc = await payload.update({
      collection: 'lesson-progress',
      id: existing.id as number,
      data: progressData,
      overrideAccess: true,
    })
  } else {
    progressDoc = await payload.create({
      collection: 'lesson-progress',
      data: {
        student: user.id,
        lesson: Number(lessonId),
        course: Number(courseId),
        ...progressData,
      },
      overrideAccess: true,
    })
  }
  // The time just watched is saved above, so it counts next time; then say how much is left.
  if (unmet) throw notWatched(required - watchedSeconds)

  const updatedEnrollment = heartbeat ? null : await refreshEnrollmentProgress(payload, enrollment.id, user.id, courseId)

  return sendSuccess({ progress: progressDoc, enrollment: updatedEnrollment })
}

function notWatched(remainingSeconds: number): AppError {
  const left = Math.max(1, Math.ceil(remainingSeconds))
  return new AppError('VALIDATION_ERROR', `Watch the rest of this video first (${roughLength(left)} left), then mark it complete.`, { remainingSeconds: String(left) })
}

export const progressEndpoint: Endpoint = {
  path: '/courses/:courseId/lessons/:lessonId/progress',
  method: 'post',
  handler: asyncHandler(handler),
}
