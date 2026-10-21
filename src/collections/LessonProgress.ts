import type { CollectionConfig } from 'payload'
import { resolveAuthUser } from '../middleware/authenticate.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { DISPLAY_TITLES } from '../hooks/display-title.js'

function relationId(value: unknown): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return (value as { id: number | string }).id
  }
  return value as number | string
}

export const LessonProgress: CollectionConfig = {
  slug: 'lesson-progress', labels: { singular: 'Lesson progress', plural: 'Lesson progress' },
  admin: {
    group: STUDIO_GROUP.learners,
    useAsTitle: 'displayTitle',
    defaultColumns: ['student', 'course', 'lesson', 'isCompleted', 'lastWatchedAt'],
  },
  access: {
    read: async ({ req }) => {
      const user = req.user ?? await resolveAuthUser(req)
      if (user?.role === 'admin') return true
      if (user) return { student: { equals: user.id } }
      return false
    },
    create: ({ req }) => req.user?.role === 'admin',
    update: ({ req }) => req.user?.role === 'admin',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    DISPLAY_TITLES.lessonProgress,
    { name: 'student', type: 'relationship', relationTo: 'users', required: true },
    { name: 'lesson', type: 'relationship', relationTo: 'lessons', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'isCompleted', type: 'checkbox', defaultValue: false },
    { name: 'watchedSeconds', type: 'number', defaultValue: 0, min: 0 },
    { name: 'lastWatchedAt', type: 'date' },
    { name: 'completedAt', type: 'date' },
  ],
  hooks: {
    afterChange: [
      async ({ doc, previousDoc, req }) => {
        const studentId = relationId(doc.student)
        if (studentId === undefined) return doc
        if (doc.isCompleted && !previousDoc?.isCompleted) {
          const { onLifecycleEvent } = await import('../lib/lifecycle/events.js')
          await onLifecycleEvent(req.payload, { type: 'lesson_completed', userId: Number(studentId), courseId: Number(relationId(doc.course)) })
        }
        try {
          const student = await req.payload.findByID({ collection: 'users', id: studentId, depth: 0, overrideAccess: true })
          const last = Date.parse(String((student as { lifecycle?: { lastLearningAt?: string | null } }).lifecycle?.lastLearningAt ?? ''))
          // Progress saves often while a video plays; one update every 15 minutes is enough.
          if (!Number.isFinite(last) || Date.now() - last > 15 * 60 * 1000) {
            await req.payload.update({ collection: 'users', id: studentId, data: { lifecycle: { lastLearningAt: new Date().toISOString() } }, depth: 0, overrideAccess: true })
          }
        } catch (err) {
          req.payload.logger.error({ err, studentId }, 'last_learning_update_failed')
        }
        return doc
      },
    ],
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        if (operation !== 'create' || !data) return data
        const studentId = relationId(data.student)
        const lessonId = relationId(data.lesson)
        if (studentId === undefined || lessonId === undefined) return data
        const existing = await req.payload.find({
          collection: 'lesson-progress',
          where: { and: [{ student: { equals: studentId } }, { lesson: { equals: lessonId } }] },
          limit: 1,
        })
        const isDuplicate = existing.docs.some((doc) => doc.id !== originalDoc?.id)
        if (isDuplicate) {
          throw new Error('Progress record already exists for this student and lesson')
        }
        return data
      },
    ],
  },
  timestamps: true,
}
