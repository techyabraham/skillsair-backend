import type { CollectionConfig } from 'payload'
import { resolveAuthUser } from '../middleware/authenticate.js'

function relationId(value: unknown): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return (value as { id: number | string }).id
  }
  return value as number | string
}

export const LessonProgress: CollectionConfig = {
  slug: 'lesson-progress',
  admin: {
    group: 'People',
    useAsTitle: 'id',
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
    { name: 'student', type: 'relationship', relationTo: 'users', required: true },
    { name: 'lesson', type: 'relationship', relationTo: 'lessons', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'isCompleted', type: 'checkbox', defaultValue: false },
    { name: 'watchedSeconds', type: 'number', defaultValue: 0, min: 0 },
    { name: 'lastWatchedAt', type: 'date' },
    { name: 'completedAt', type: 'date' },
  ],
  hooks: {
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
