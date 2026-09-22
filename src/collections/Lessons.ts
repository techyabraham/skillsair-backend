import type { CollectionConfig, PayloadRequest, Where } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { slugify } from '../utils/slugify.js'

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

async function recalculateCourseStats(
  courseId: number | string,
  payload: PayloadLocalApi,
): Promise<void> {
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
  slug: 'lessons',
  admin: {
    useAsTitle: 'title',
  },
  access: {
    read: async ({ req }): Promise<boolean | Where> => {
      if (req.user?.role === 'admin' || req.user?.role === 'instructor') return true
      if (!req.user) {
        return { and: [{ isFree: { equals: true } }, { isPublished: { equals: true } }] } as Where
      }
      const enrollments = await req.payload.find({
        collection: 'enrollments',
        where: { student: { equals: req.user.id }, status: { not_equals: 'refunded' } },
        limit: 1000,
        depth: 0,
      })
      const courseIds = enrollments.docs
        .map((doc) => relationId((doc as unknown as { course: unknown }).course))
        .filter((id): id is number | string => id !== undefined)
      return {
        and: [
          { isPublished: { equals: true } },
          {
            or: [
              { isFree: { equals: true } },
              courseIds.length > 0
                ? { 'section.course': { in: courseIds } }
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
    { name: 'duration', type: 'number', defaultValue: 0 },
    { name: 'order', type: 'number', required: true },
    { name: 'isFree', type: 'checkbox', defaultValue: false },
    { name: 'isPublished', type: 'checkbox', defaultValue: false },
    { name: 'section', type: 'relationship', relationTo: 'sections', required: true },
    { name: 'attachments', type: 'relationship', relationTo: 'media', hasMany: true },
  ],
  hooks: {
    afterChange: [
      async ({ doc, req }) => {
        await syncCourseStatsForLesson(doc, req.payload as unknown as PayloadLocalApi)
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        await syncCourseStatsForLesson(doc, req.payload as unknown as PayloadLocalApi)
      },
    ],
  },
  timestamps: true,
}
