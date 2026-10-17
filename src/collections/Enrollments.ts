import type { CollectionConfig } from 'payload'
import { afterEnroll } from '../hooks/courses/afterEnroll.js'
import { afterComplete } from '../hooks/courses/afterComplete.js'
import { resolveAuthUser } from '../middleware/authenticate.js'

function relationId(value: unknown): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return (value as { id: number | string }).id
  }
  return value as number | string
}

export const Enrollments: CollectionConfig = {
  slug: 'enrollments',
  admin: {
    group: 'People',
    useAsTitle: 'id',
    defaultColumns: ['student', 'course', 'status', 'progressPercent', 'enrolledAt'],
  },
  access: {
    read: async ({ req }) => {
      const user = req.user ?? await resolveAuthUser(req)
      if (user?.role === 'admin') return true
      if (user) return { student: { equals: user.id } }
      return false
    },
    create: () => false,
    update: ({ req }) => req.user?.role === 'admin',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'student', type: 'relationship', relationTo: 'users', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Completed', value: 'completed' },
        { label: 'Refunded', value: 'refunded' },
      ],
    },
    { name: 'enrolledAt', type: 'date', defaultValue: () => new Date().toISOString() },
    { name: 'completedAt', type: 'date' },
    { name: 'progressPercent', type: 'number', defaultValue: 0, min: 0, max: 100 },
    {
      name: 'lifecycleCycle',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true, description: 'Times this enrolment has lapsed before completion (each lapse restarts the win-back emails).' },
    },
    { name: 'orderId', type: 'text' },
    { name: 'subscription', type: 'relationship', relationTo: 'subscriptions' },
  ],
  hooks: {
    afterChange: [afterEnroll, afterComplete],
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        if (operation !== 'create' || !data) return data
        const studentId = relationId(data.student)
        const courseId = relationId(data.course)
        if (studentId === undefined || courseId === undefined) return data
        const existing = await req.payload.find({
          collection: 'enrollments',
          where: { and: [{ student: { equals: studentId } }, { course: { equals: courseId } }] },
          limit: 1,
        })
        const isDuplicate = existing.docs.some((doc) => doc.id !== originalDoc?.id)
        if (isDuplicate) {
          throw new Error('Student is already enrolled in this course')
        }
        return data
      },
    ],
  },
  timestamps: false,
}
