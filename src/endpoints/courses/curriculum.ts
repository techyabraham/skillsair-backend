import type { Endpoint, PayloadRequest } from 'payload'
import { asyncHandler, getParam, sendSuccess } from '../../middleware/validate.js'
import { resolveAuthUser } from '../../middleware/authenticate.js'
import { relationId, requireCourseAccess } from '../../lib/course-access.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'

async function handler(req: PayloadRequest): Promise<Response> {
  const courseId = getParam(req, 'courseId')
  if (!isValidPayloadId(courseId)) throw new AppError('VALIDATION_ERROR', 'Invalid course id')

  const course = await req.payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!course || course.status !== 'published') throw new AppError('NOT_FOUND', 'Course not found')

  const user = await resolveAuthUser(req)
  let hasCourseAccess = false
  if (user) {
    try {
      await requireCourseAccess(req.payload, user.id, courseId)
      hasCourseAccess = true
    } catch {
      hasCourseAccess = false
    }
  }

  const sections = await req.payload.find({
    collection: 'sections',
    where: { course: { equals: courseId } },
    sort: 'order',
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })

  const curriculum = await Promise.all(sections.docs.map(async (section) => {
    const lessons = await req.payload.find({
      collection: 'lessons',
      where: { and: [{ section: { equals: section.id } }, { isPublished: { equals: true } }] },
      sort: 'order',
      limit: 5000,
      depth: 1,
      overrideAccess: true,
    })
    return {
      id: section.id,
      title: section.title,
      order: section.order,
      lessons: lessons.docs.map((lesson) => {
        const canConsume = hasCourseAccess || Boolean(lesson.isFree)
        return {
          id: lesson.id,
          title: lesson.title,
          slug: lesson.slug,
          order: lesson.order,
          duration: lesson.duration,
          isFree: lesson.isFree,
          isPublished: lesson.isPublished,
          ...(canConsume ? {
            content: lesson.content,
            driveFileId: lesson.driveFileId,
            attachments: lesson.attachments,
          } : {}),
        }
      }),
    }
  }))

  return sendSuccess({ sections: curriculum })
}

export const courseCurriculumEndpoint: Endpoint = {
  // This is registered on the Courses collection, so Payload mounts it at
  // /api/courses/:courseId/curriculum.
  path: '/:courseId/curriculum',
  method: 'get',
  handler: asyncHandler(handler),
}
