import type { CollectionConfig, PayloadRequest, Where } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { slugify } from '../utils/slugify.js'
import { resolveAuthUser } from '../middleware/authenticate.js'
import { requireCourseAccess } from '../lib/course-access.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { lessonTranscriptEndpoint } from '../endpoints/stream/captions.js'
import { bumpCourseCache } from '../lib/cache.js'
import { afterCommit } from '../lib/after-commit.js'

interface SectionWithCourse {
  course: number | string | { id: number | string }
}

function relationId(value: unknown): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return (value as { id: number | string }).id
  }
  return value as number | string
}

interface PayloadLocalApi {
  find: (args: {
    collection: string
    where?: Record<string, unknown>
    limit?: number
    depth?: number
  }) => Promise<{ docs: Array<Record<string, unknown>>; totalDocs: number }>
  findByID: (args: { collection: string; id: number | string; depth?: number }) => Promise<Record<string, unknown>>
  update: (args: {
    collection: string
    id: number | string
    data: Record<string, unknown>
    overrideAccess?: boolean
  }) => Promise<unknown>
}

export async function recalculateCourseStats(
  courseId: number | string,
  payload: PayloadLocalApi,
): Promise<void> {
  // Lesson changes (and the once-per-course recalculation after imports) retire cached curricula.
  await bumpCourseCache(courseId)
  const sections = await payload.find({
    collection: 'sections',
    where: { course: { equals: courseId } },
    limit: 1000,
    depth: 0,
  })
  const sectionIds = sections.docs.map((doc) => doc.id as number | string)
  if (sectionIds.length === 0) {
    await payload.update({
      collection: 'courses',
      id: courseId,
      data: { totalLessons: 0, totalDuration: 0 },
      overrideAccess: true,
    })
    return
  }
  const lessons = await payload.find({
    collection: 'lessons',
    where: { section: { in: sectionIds } },
    limit: 5000,
    depth: 0,
  })
  const totalLessons = lessons.totalDocs
  const totalDuration = lessons.docs.reduce((sum, doc) => {
    const duration = typeof doc.duration === 'number' ? doc.duration : 0
    return sum + duration
  }, 0)
  await payload.update({
    collection: 'courses',
    id: courseId,
    data: { totalLessons, totalDuration },
    overrideAccess: true,
  })
}

async function syncCourseStatsForLesson(
  lessonDoc: Record<string, unknown>,
  payload: PayloadLocalApi,
): Promise<void> {
  const sectionId = relationId(lessonDoc.section)
  if (sectionId === undefined) return
  const section = (await payload.findByID({
    collection: 'sections',
    id: sectionId,
    depth: 0,
  })) as unknown as SectionWithCourse
  const courseId = relationId(section.course)
  if (courseId === undefined) return
  await recalculateCourseStats(courseId, payload)
}

export const Lessons: CollectionConfig = {
  slug: 'lessons', labels: { singular: 'Lesson', plural: 'Lessons' },
  endpoints: [lessonTranscriptEndpoint],
  admin: {
    group: STUDIO_GROUP.learning,
    useAsTitle: 'title',
    defaultColumns: ['title', 'section', 'isFree', 'duration', 'isPublished', 'updatedAt'],
  },
  access: {
    read: async ({ req }): Promise<boolean | Where> => {
      const currentUser = req.user ?? await resolveAuthUser(req)
      if (currentUser?.role === 'admin' || currentUser?.role === 'instructor') return true
      if (!currentUser) {
        return { and: [{ isFree: { equals: true } }, { isPublished: { equals: true } }] } as Where
      }
      const enrollments = await req.payload.find({
        collection: 'enrollments',
        where: { student: { equals: currentUser.id }, status: { not_equals: 'refunded' } },
        limit: 1000,
        depth: 0,
      })
      const courseIds = enrollments.docs
        .map((doc) => relationId((doc as unknown as { course: unknown }).course))
        .filter((id): id is number | string => id !== undefined)
      const accessibleCourseIds = (await Promise.all(courseIds.map(async (id) => {
        try { await requireCourseAccess(req.payload, currentUser.id, id); return id }
        catch { return undefined }
      }))).filter((id): id is number | string => id !== undefined)
      return {
        and: [
          { isPublished: { equals: true } },
          {
            or: [
              { isFree: { equals: true } },
              accessibleCourseIds.length > 0
                ? { 'section.course': { in: accessibleCourseIds } }
                : { isFree: { equals: true } },
            ],
          },
        ],
      } as Where
    },
    create: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    update: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    delete: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
  },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 200 },
    {
      name: 'slug',
      type: 'text',
      hooks: {
        beforeValidate: [
          ({ value, data }) => {
            if (value) return value
            const title = typeof data?.title === 'string' ? data.title : ''
            return slugify(title)
          },
        ],
      },
      validate: async (
        value: unknown,
        { data, req, id }: { data?: Record<string, unknown> | null; req: PayloadRequest; id?: string | number | null },
      ): Promise<string | true> => {
        if (!value || typeof value !== 'string' || !data?.section) return true
        const sectionId = relationId(data.section)
        if (sectionId === undefined) return true
        const section = (await req.payload.findByID({
          collection: 'sections',
          id: sectionId,
          depth: 0,
        })) as unknown as SectionWithCourse
        const courseId = relationId(section.course)
        const siblingSections = await req.payload.find({
          collection: 'sections',
          where: { course: { equals: courseId } },
          limit: 1000,
          depth: 0,
        })
        const sectionIds = siblingSections.docs.map((doc) => doc.id)
        const duplicates = await req.payload.find({
          collection: 'lessons',
          where: {
            and: [
              { slug: { equals: value } },
              { section: { in: sectionIds } },
              ...(id ? [{ id: { not_equals: id } }] : []),
            ],
          },
          limit: 1,
        })
        if (duplicates.totalDocs > 0) {
          return 'Lesson slug must be unique within the course'
        }
        return true
      },
    },
    {
      name: 'content',
      type: 'richText',
      editor: lexicalEditor({}),
    },
    { name: 'driveFileId', type: 'text' },
    {
      // Set by captions:import from the subtitle file next to the video in Drive. Captions and the
      // transcript are served through access-checked endpoints, never the public lesson API.
      name: 'captions',
      type: 'array',
      access: { read: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor' },
      admin: { readOnly: true, description: 'Imported from the .srt next to the video (captions:import).' },
      fields: [
        { name: 'language', type: 'text', required: true, defaultValue: 'en' },
        { name: 'label', type: 'text', required: true, defaultValue: 'English' },
        // Long lectures' subtitles pass Payload's default 40,000-character limit; the column is unbounded.
        { name: 'vtt', type: 'textarea', required: true, maxLength: 2_000_000 },
        { name: 'sourceFileId', type: 'text' },
        { name: 'sourceModifiedTime', type: 'text' },
      ],
    },
    {
      name: 'transcript',
      type: 'textarea',
      maxLength: 2_000_000,
      access: { read: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor' },
      admin: { readOnly: true, description: 'Plain text with [mm:ss] markers, from the captions.' },
    },
    { name: 'hasCaptions', type: 'checkbox', defaultValue: false, admin: { readOnly: true } },
    {
      // Documents kept in Google Drive (PDFs, worksheets, design files), streamed through the
      // backend with the same access checks as the lesson video.
      name: 'resources',
      type: 'array',
      labels: { singular: 'Resource', plural: 'Resources' },
      admin: { description: 'Lesson materials stored in Google Drive. Learners open them from the lesson page.' },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'driveFileId', type: 'text', required: true },
        { name: 'mimeType', type: 'text' },
      ],
    },
    { name: 'duration', type: 'number', defaultValue: 0, admin: { description: 'In seconds.', components: { Cell: '/src/admin/cells/cells#DurationCell' } } },
    { name: 'order', type: 'number', required: true },
    { name: 'isFree', type: 'checkbox', defaultValue: false, admin: { components: { Cell: '/src/admin/cells/cells#LessonTypeCell' } } },
    { name: 'isPublished', type: 'checkbox', defaultValue: false, admin: { components: { Cell: '/src/admin/cells/cells#PublishStatusCell' } } },
    { name: 'section', type: 'relationship', relationTo: 'sections', required: true, admin: { components: { Cell: '/src/admin/cells/cells#LessonPlaceCell' } } },
    { name: 'attachments', type: 'relationship', relationTo: 'media', hasMany: true },
  ],
  hooks: {
    afterChange: [
      async ({ doc, req }) => {
        // Bulk imports skip this per lesson and recalculate once per course at the end.
        if ((req.context as { skipCourseStats?: boolean } | undefined)?.skipCourseStats) return
        afterCommit('course_stats', () => syncCourseStatsForLesson(doc, req.payload as unknown as PayloadLocalApi))
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        afterCommit('course_stats', () => syncCourseStatsForLesson(doc, req.payload as unknown as PayloadLocalApi))
      },
    ],
  },
  timestamps: true,
}
