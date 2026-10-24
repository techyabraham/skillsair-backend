import type { Endpoint, PayloadRequest } from 'payload'
import { asyncHandler, getParam, sendSuccess } from '../../middleware/validate.js'
import { resolveAuthUser } from '../../middleware/authenticate.js'
import { relationId, requireCourseAccess } from '../../lib/course-access.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'
import { CACHE_KEYS, cachedJson, courseCacheGeneration } from '../../lib/cache.js'

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

  const structure = await cachedJson(`${CACHE_KEYS.curriculum(courseId)}:${await courseCacheGeneration(courseId)}`, 600, () => loadStructure(req, courseId))
  const curriculum = structure.map((section) => ({
    ...section,
    lessons: section.lessons.map(({ content, driveFileId, attachments, resources, ...lesson }) =>
      hasCourseAccess || lesson.isFree ? { ...lesson, content, driveFileId, attachments, resources } : lesson,
    ),
  }))

  return sendSuccess({ sections: curriculum })
}

interface StructureLesson {
  id: number
  title: string
  slug?: string | null
  order: number
  duration?: number | null
  isFree?: boolean | null
  isPublished?: boolean | null
  hasCaptions: boolean
  content?: unknown
  driveFileId?: string | null
  attachments?: unknown
  resources: Array<{ title?: string; mimeType: string | null }>
}

/** Every published lesson with its full fields (cached; the handler removes what a visitor may not see). */
async function loadStructure(req: PayloadRequest, courseId: string): Promise<Array<{ id: number; title: string; order: number; lessons: StructureLesson[] }>> {
  const sections = await req.payload.find({
    collection: 'sections',
    where: { course: { equals: courseId } },
    sort: 'order',
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })

  return Promise.all(sections.docs.map(async (section) => {
    const lessons = await req.payload.find({
      collection: 'lessons',
      where: { and: [{ section: { equals: section.id } }, { isPublished: { equals: true } }] },
      sort: 'order',
      limit: 5000,
      depth: 1,
      overrideAccess: true,
    })
    return {
      id: Number(section.id),
      title: section.title,
      order: section.order,
      lessons: lessons.docs.map((lesson): StructureLesson => {
        return {
          id: Number(lesson.id),
          title: lesson.title,
          slug: lesson.slug,
          order: lesson.order,
          duration: lesson.duration,
          isFree: lesson.isFree,
          isPublished: lesson.isPublished,
          hasCaptions: Boolean((lesson as unknown as { hasCaptions?: boolean | null }).hasCaptions),
          content: lesson.content,
          driveFileId: lesson.driveFileId,
          attachments: lesson.attachments,
          // Drive documents: titles and types only; files open through /api/stream/:lessonId/resources/:index.
          resources: ((lesson as unknown as { resources?: Array<{ title?: string; mimeType?: string | null }> | null }).resources ?? []).map((resource) => ({ title: resource.title, mimeType: resource.mimeType ?? null })),
        }
      }),
    }
  }))
}

export const courseCurriculumEndpoint: Endpoint = {
  // This is registered on the Courses collection, so Payload mounts it at
  // /api/courses/:courseId/curriculum.
  path: '/:courseId/curriculum',
  method: 'get',
  handler: asyncHandler(handler),
}
