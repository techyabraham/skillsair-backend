import type { Endpoint, PayloadRequest } from 'payload'
import { asyncHandler, getParam, sendSuccess } from '../../middleware/validate.js'
import { resolveAuthUser } from '../../middleware/authenticate.js'
import { captionsRateLimiter } from '../../lib/rate-limiter.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { getLessonCourse, requireCourseAccess } from '../../lib/course-access.js'
import { CACHE_KEYS, cacheGet, cacheSet } from '../../lib/cache.js'
import { parseTranscript } from '../../lib/captions.js'
import { AppError } from '../../types/index.js'

const DAY = 86_400

/** Same rules as the lesson video: free lessons for everyone, the rest for learners with access. */
async function authorizeLesson(req: PayloadRequest, lessonId: string) {
  const user = await resolveAuthUser(req)
  await captionsRateLimiter.check(req, user?.id)
  if (!isValidPayloadId(lessonId)) throw new AppError('VALIDATION_ERROR', 'Invalid lesson id')
  const { lesson, courseId } = await getLessonCourse(req.payload, lessonId)
  if (!lesson.isFree) {
    if (!user) throw new AppError('AUTH_REQUIRED', 'Sign in to view this lesson')
    await requireCourseAccess(req.payload, user.id, courseId)
  }
  return lesson as unknown as { id: number; captions?: Array<{ language: string; vtt: string }> | null; transcript?: string | null }
}

/** GET /api/stream/:lessonId/captions/:file (e.g. en.vtt): WebVTT captions for the lesson video. */
async function captionsHandler(req: PayloadRequest): Promise<Response> {
  const lessonId = getParam(req, 'lessonId')
  const file = getParam(req, 'file')
  const language = /^([a-z]{2,3}(?:-[A-Za-z]{2})?)\.vtt$/.exec(file)?.[1]
  if (!language) throw new AppError('NOT_FOUND', 'Captions not found')
  // Access is checked on every request; only the caption text is cached.
  const cacheKey = CACHE_KEYS.captions(lessonId, language)
  const cachedVtt = await cacheGet(cacheKey)
  const lesson = await authorizeLesson(req, lessonId)
  let vtt = cachedVtt
  if (!vtt) {
    vtt = lesson.captions?.find((caption) => caption.language === language)?.vtt ?? null
    if (!vtt) throw new AppError('NOT_FOUND', 'Captions not found')
    await cacheSet(cacheKey, vtt, DAY)
  }
  return new Response(vtt, {
    status: 200,
    headers: {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** GET /api/lessons/:id/transcript: the transcript as timestamped lines. */
async function transcriptHandler(req: PayloadRequest): Promise<Response> {
  const lessonId = getParam(req, 'id')
  const lesson = await authorizeLesson(req, lessonId)
  const cacheKey = CACHE_KEYS.transcript(lessonId)
  const cached = await cacheGet(cacheKey)
  const text = cached ?? lesson.transcript ?? ''
  if (!cached && text) await cacheSet(cacheKey, text, DAY)
  return sendSuccess({ lessonId: Number(lessonId), lines: parseTranscript(text) })
}

export const lessonCaptionsEndpoint: Endpoint = {
  path: '/stream/:lessonId/captions/:file',
  method: 'get',
  handler: asyncHandler(captionsHandler),
}

/** Registered on the Lessons collection, so it's served at /api/lessons/:id/transcript. */
export const lessonTranscriptEndpoint: Endpoint = {
  path: '/:id/transcript',
  method: 'get',
  handler: asyncHandler(transcriptHandler),
}
