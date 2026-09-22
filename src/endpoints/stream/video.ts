import type { Endpoint, PayloadRequest } from 'payload'
import { Readable } from 'node:stream'
import { asyncHandler, getParam } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { streamRateLimiter } from '../../lib/rate-limiter.js'
import { streamSecurityHeaders } from '../../middleware/security-headers.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { getFileMetadata, streamFileRange, parseRangeHeader } from '../../lib/google-drive.js'
import { isPast } from '../../utils/date-helpers.js'
import { AppError } from '../../types/index.js'
import { logger } from '../../lib/logger.js'

interface LessonDoc {
  id: number
  driveFileId: string | null | undefined
  isFree: boolean
  isPublished: boolean
  section: number | string | { id: number | string; course?: unknown }
}

interface SectionDoc {
  course: number | string | { id: number | string }
}

interface UserDoc {
  accessExpiresAt: string | null | undefined
}

function relationId(value: unknown): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return (value as { id: number | string }).id
  }
  return value as number | string
}

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  await streamRateLimiter.check(req, user.id)
  const lessonId = getParam(req, 'lessonId')
  if (!isValidPayloadId(lessonId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid lesson id')
  }

  const payload = req.payload

  const lesson = (await payload
    .findByID({ collection: 'lessons', id: lessonId, depth: 0 })
    .catch(() => null)) as unknown as LessonDoc | null
  if (!lesson || !lesson.isPublished || !lesson.driveFileId) {
    throw new AppError('NOT_FOUND', 'Lesson video not found')
  }

  if (!lesson.isFree) {
    const sectionId = relationId(lesson.section)
    const section = (await payload.findByID({
      collection: 'sections',
      id: sectionId as number | string,
      depth: 0,
    })) as unknown as SectionDoc
    const courseId = relationId(section.course)

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
    if (enrollments.totalDocs === 0) {
      throw new AppError('INSUFFICIENT_PERMISSION', 'You are not enrolled in this course')
    }

    const userDoc = (await payload.findByID({
      collection: 'users',
      id: user.id,
      depth: 0,
    })) as unknown as UserDoc
    if (userDoc.accessExpiresAt && isPast(userDoc.accessExpiresAt)) {
      throw new AppError('ACCESS_EXPIRED', 'Your access to this content has expired')
    }
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
