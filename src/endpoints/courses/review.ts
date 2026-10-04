import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { requireCourseAccess } from '../../lib/course-access.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'

const schema = z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().min(3).max(3000) })

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const courseId = getParam(req, 'courseId')
  if (!isValidPayloadId(courseId)) throw new AppError('VALIDATION_ERROR', 'Invalid course id')
  const body = parseBody(schema, await readJsonBody(req))
  await requireCourseAccess(req.payload, user.id, courseId)
  const existing = await req.payload.find({ collection: 'reviews', where: { and: [{ student: { equals: user.id } }, { course: { equals: courseId } }] }, limit: 1, overrideAccess: true })
  if (existing.totalDocs) throw new AppError('ALREADY_EXISTS', 'You already reviewed this course')
  const review = await req.payload.create({ collection: 'reviews', data: { student: user.id, course: courseId, ...body }, overrideAccess: true })
  return sendSuccess(review, undefined, 201)
}

export const reviewEndpoint: Endpoint = { path: '/courses/:courseId/reviews', method: 'post', handler: asyncHandler(handler) }
