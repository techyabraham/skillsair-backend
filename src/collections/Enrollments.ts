import type { CollectionConfig } from 'payload'
import { afterEnroll } from '../hooks/courses/afterEnroll.js'
import { afterComplete } from '../hooks/courses/afterComplete.js'
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

export const Enrollments: CollectionConfig = {
  slug: 'enrollments', labels: { singular: 'Enrolment', plural: 'Enrolments' },
  admin: {
    group: STUDIO_GROUP.learners,
    useAsTitle: 'displayTitle',
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
    DISPLAY_TITLES.enrollments,
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
    {
      // Guided 12-week plan (src/lib/guided-plan.ts). Guidance only: it never locks anything.
      type: 'collapsible',
      label: 'Learning plan',
      admin: { initCollapsed: true },
      fields: [
        {
          name: 'pace',
          type: 'select',
          defaultValue: 'guided',
          index: true,
          options: [
            { label: 'Guided 12-week plan', value: 'guided' },
            { label: 'Self-paced', value: 'self_paced' },
          ],
          admin: { description: 'Learners change this from their plan settings.' },
        },
        { name: 'planStartedAt', type: 'date', admin: { description: 'Week 1 of the plan starts on this day (Lagos midnight).' } },
        { name: 'planResetCount', type: 'number', defaultValue: 0, min: 0, admin: { readOnly: true } },
        { name: 'planResetAt', type: 'date', admin: { readOnly: true } },
        { name: 'paceChangedAt', type: 'date', admin: { readOnly: true } },
      ],
    },
  ],
  hooks: {
    afterChange: [afterEnroll, afterComplete],
    beforeChange: [
      ({ data, operation }) => {
        // Week 1 of the guided plan starts the day the enrolment is activated.
        if (operation === 'create' && data && !data.planStartedAt && (data.status ?? 'active') === 'active') {
          data.planStartedAt = new Date().toISOString()
        }
        return data
      },
    ],
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
