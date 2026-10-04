import type { Endpoint, PayloadRequest } from 'payload'
import { Readable } from 'node:stream'
import { asyncHandler, getParam } from '../../middleware/validate.js'
import { resolveAuthUser } from '../../middleware/authenticate.js'
import { streamRateLimiter } from '../../lib/rate-limiter.js'
import { streamSecurityHeaders } from '../../middleware/security-headers.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { getFileMetadata, streamFileRange, parseRangeHeader } from '../../lib/google-drive.js'
import { getLessonCourse, requireCourseAccess } from '../../lib/course-access.js'
import { AppError } from '../../types/index.js'
import { logger } from '../../lib/logger.js'

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await resolveAuthUser(req)
  await streamRateLimiter.check(req, user?.id)
  const lessonId = getParam(req, 'lessonId')
  if (!isValidPayloadId(lessonId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid lesson id')
  }

  const payload = req.payload

  const { lesson, courseId } = await getLessonCourse(payload, lessonId)
  if (!lesson.driveFileId) {
    throw new AppError('NOT_FOUND', 'Lesson video not found')
  }

  if (!lesson.isFree) {
    if (!user) throw new AppError('AUTH_REQUIRED', 'Sign in to view this lesson')
    await requireCourseAccess(payload, user.id, courseId)
  }

  const driveFileId = lesson.driveFileId
  const metadata = await getFileMetadata(driveFileId)
  const totalSize = Number(metadata.size)
  const range = parseRangeHeader(req.headers.get('range') ?? undefined, totalSize)
  const { stream, status } = await streamFileRange(driveFileId, range)

  const headers = new Headers()
  streamSecurityHeaders(headers)
  headers.set('Content-Type', metadata.mimeType)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`)
  headers.set('Content-Length', String(range.end - range.start + 1))

  stream.on('error', (err) => {
    logger.error({ err, lessonId }, 'video_stream_error')
  })

  const isFullRange = range.start === 0 && range.end === totalSize - 1 && status !== 206
  const responseStatus = isFullRange ? 200 : 206

  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: responseStatus,
    headers,
  })
}

export const videoStreamEndpoint: Endpoint = {
  path: '/stream/:lessonId',
  method: 'get',
  handler: asyncHandler(handler),
}
