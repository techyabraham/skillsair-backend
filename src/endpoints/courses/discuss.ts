import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { getLessonCourse, relationId, requireCourseAccess } from '../../lib/course-access.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'

const schema = z.object({ body: z.string().trim().min(1).max(5000), lessonId: z.string().optional(), parentId: z.string().optional() })

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const courseId = getParam(req, 'courseId')
  if (!isValidPayloadId(courseId)) throw new AppError('VALIDATION_ERROR', 'Invalid course id')
  const body = parseBody(schema, await readJsonBody(req))
  await requireCourseAccess(req.payload, user.id, courseId)
  if (body.lessonId) {
    if (!isValidPayloadId(body.lessonId)) throw new AppError('VALIDATION_ERROR', 'Invalid lesson id')
    const lesson = await getLessonCourse(req.payload, body.lessonId)
    if (String(lesson.courseId) !== String(courseId)) throw new AppError('VALIDATION_ERROR', 'Lesson does not belong to this course')
  }
  if (body.parentId) {
    if (!isValidPayloadId(body.parentId)) throw new AppError('VALIDATION_ERROR', 'Invalid parent id')
    const parent = await req.payload.findByID({ collection: 'discussions', id: body.parentId, depth: 0, overrideAccess: true }).catch(() => null)
    if (!parent || String(relationId(parent.course)) !== String(courseId)) throw new AppError('VALIDATION_ERROR', 'Reply must belong to this course')
  }
  const post = await req.payload.create({ collection: 'discussions', data: { author: user.id, course: courseId, body: body.body, lesson: body.lessonId, parent: body.parentId }, overrideAccess: true })
  return sendSuccess(post, undefined, 201)
}

export const discussEndpoint: Endpoint = { path: '/courses/:courseId/discussions', method: 'post', handler: asyncHandler(handler) }
