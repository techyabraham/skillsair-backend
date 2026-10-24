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
import { legacyDriveFileId } from '../../lib/legacy-video.js'
import { notePlay } from '../../lib/drive-health.js'

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await resolveAuthUser(req)
  await streamRateLimiter.check(req, user?.id)
  const lessonId = getParam(req, 'lessonId')
  if (!isValidPayloadId(lessonId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid lesson id')
  }

  const payload = req.payload

  const { lesson, courseId } = await getLessonCourse(payload, lessonId)
  const driveFileId = typeof lesson.driveFileId === 'string' && lesson.driveFileId
    ? lesson.driveFileId
    : legacyDriveFileId(lesson.content)
  if (!driveFileId) {
    throw new AppError('NOT_FOUND', 'Lesson video not found')
  }

  if (!lesson.isFree) {
    if (!user) throw new AppError('AUTH_REQUIRED', 'Sign in to view this lesson')
    await requireCourseAccess(payload, user.id, courseId)
  }

  const metadata = await getFileMetadata(driveFileId)
  const totalSize = Number(metadata.size)
  const range = parseRangeHeader(req.headers.get('range') ?? undefined, totalSize)
  // A request from the first byte is a new play (seeks start later): counted for the quota alert.
  if (range.start === 0) void notePlay()
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

/**
 * GET /api/stream/:lessonId/resources/:index: a lesson document kept in Google Drive (PDF,
 * worksheet, design file), with the same access rules as the lesson video.
 */
async function resourceHandler(req: PayloadRequest): Promise<Response> {
  const user = await resolveAuthUser(req)
  await streamRateLimiter.check(req, user?.id)
  const lessonId = getParam(req, 'lessonId')
  const index = Number(getParam(req, 'index'))
  if (!isValidPayloadId(lessonId) || !Number.isInteger(index) || index < 0) {
    throw new AppError('VALIDATION_ERROR', 'Invalid lesson resource')
  }
  const payload = req.payload
  const { lesson, courseId } = await getLessonCourse(payload, lessonId)
  const resources = (lesson as unknown as { resources?: Array<{ title?: string; driveFileId?: string }> | null }).resources ?? []
  const resource = resources[index]
  if (!resource?.driveFileId) throw new AppError('NOT_FOUND', 'Lesson resource not found')
  if (!lesson.isFree) {
    if (!user) throw new AppError('AUTH_REQUIRED', 'Sign in to open this lesson')
    await requireCourseAccess(payload, user.id, courseId)
  }

  const metadata = await getFileMetadata(resource.driveFileId)
  const totalSize = Number(metadata.size)
  const range = parseRangeHeader(req.headers.get('range') ?? undefined, totalSize)
  const { stream, status } = await streamFileRange(resource.driveFileId, range)
  const headers = new Headers()
  streamSecurityHeaders(headers)
  headers.set('Content-Type', metadata.mimeType)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`)
  headers.set('Content-Length', String(range.end - range.start + 1))
  // PDFs and images open in the browser; other files (design files, Word, zip) download.
  const inline = /^(application\/pdf|image\/)/.test(metadata.mimeType)
  const filename = (metadata.name || resource.title || 'resource').replace(/["\r\n]/g, '')
  headers.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
  stream.on('error', (err) => {
    logger.error({ err, lessonId, index }, 'resource_stream_error')
  })
  const isFullRange = range.start === 0 && range.end === totalSize - 1 && status !== 206
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { status: isFullRange ? 200 : 206, headers })
}

export const lessonResourceEndpoint: Endpoint = {
  path: '/stream/:lessonId/resources/:index',
  method: 'get',
  handler: asyncHandler(resourceHandler),
}
