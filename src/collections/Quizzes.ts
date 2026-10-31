import type { CollectionConfig, PayloadRequest, Where } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { relationId } from '../lib/course-access.js'
import { startQuizEndpoint } from '../endpoints/assessments/index.js'
import { bumpCourseCacheHook } from '../lib/cache.js'

const staff = ({ req }: { req: PayloadRequest }) => req.user?.role === 'admin' || req.user?.role === 'instructor'

/**
 * Three kinds of assessment:
 *   - knowledge_check: 2–3 ungraded questions shown when a lesson's video ends (needs `lesson`)
 *   - chapter: the end-of-chapter quiz, required for completion (needs `section`; one per section)
 *   - final_exam: unlocks once the certificate is paid for, earns it (one per course)
 * Questions are drawn per attempt from the course's approved question pool (`quiz-questions.pools`);
 * `questions` lists hand-picked questions for quizzes that don't draw from the pool.
 */
export const Quizzes: CollectionConfig = {
  slug: 'quizzes', labels: { singular: 'Quiz', plural: 'Quizzes' }, admin: { group: STUDIO_GROUP.learning, useAsTitle: 'title', defaultColumns: ['title', 'kind', 'course', 'questions', 'averageScore', 'isPublished', 'updatedAt'] },
  endpoints: [startQuizEndpoint],
  access: {
    read: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor' ? true : { isPublished: { equals: true } },
    create: staff,
    update: staff,
    delete: ({ req }) => req.user?.role === 'admin',
  },
  hooks: {
    beforeValidate: [
      async ({ data, req, originalDoc }) => {
        // One chapter quiz per section and one final exam per course (also a unique index in the database).
        const merged = { ...(originalDoc ?? {}), ...(data ?? {}) } as Record<string, unknown>
        const kind = merged.kind ?? 'chapter'
        const where: Where | null = kind === 'chapter' && merged.section
          ? { and: [{ kind: { equals: 'chapter' } }, { section: { equals: relationId(merged.section) as number } }] }
          : kind === 'final_exam' && merged.course
            ? { and: [{ kind: { equals: 'final_exam' } }, { course: { equals: relationId(merged.course) as number } }] }
            : null
        if (!where) return data
        const existing = await req.payload.find({ collection: 'quizzes', where: originalDoc?.id ? { and: [where, { id: { not_equals: originalDoc.id } }] } : where, limit: 1, depth: 0, overrideAccess: true, req })
        if (existing.totalDocs) throw new Error(kind === 'chapter' ? 'This chapter already has a chapter quiz.' : 'This programme already has a final exam.')
        return data
      },
    ],
    afterChange: [bumpCourseCacheHook()],
    afterDelete: [bumpCourseCacheHook()],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'chapter',
      options: [
        { label: 'Knowledge check (in a lesson)', value: 'knowledge_check' },
        { label: 'Chapter quiz', value: 'chapter' },
        { label: 'Final exam', value: 'final_exam' },
      ],
    },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    {
      name: 'section',
      type: 'relationship',
      relationTo: 'sections',
      admin: { condition: (data) => data?.kind === 'chapter', description: 'The chapter this quiz closes.' },
      validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) => (siblingData?.kind === 'chapter' && !value ? 'A chapter quiz needs its chapter.' : true),
    },
    {
      name: 'lesson',
      type: 'relationship',
      relationTo: 'lessons',
      admin: { condition: (data) => data?.kind === 'knowledge_check', description: 'The lesson whose video ends with this check.' },
      validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) => (siblingData?.kind === 'knowledge_check' && !value ? 'A knowledge check needs its lesson.' : true),
    },
    { name: 'questions', type: 'relationship', relationTo: 'quiz-questions', hasMany: true, admin: { description: 'Optional: fixed questions. Leave empty to draw from the approved question pool.', components: { Cell: '/src/admin/cells/cells#QuestionCountCell' } } },
    { name: 'passingScore', type: 'number', required: true, min: 0, max: 100, defaultValue: 70 },
    {
      type: 'row',
      fields: [
        { name: 'drawCount', type: 'number', min: 1, admin: { description: 'Questions per attempt. Empty: all.' } },
        { name: 'timeLimitMinutes', type: 'number', min: 1, admin: { description: 'Empty: untimed.' } },
        { name: 'maxAttempts', type: 'number', min: 1, admin: { description: 'Attempts before a cooldown. Empty: unlimited.' } },
        { name: 'cooldownHours', type: 'number', min: 0, admin: { description: 'Wait after using up the attempts.' } },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'shuffle', type: 'checkbox', defaultValue: true, admin: { description: 'Shuffle questions and options per attempt.' } },
        { name: 'weightByChapter', type: 'checkbox', defaultValue: false, admin: { description: 'Final exam: draw by chapter length, at least 2 per chapter.' } },
      ],
    },
    { name: 'isPublished', type: 'checkbox', defaultValue: false, admin: { components: { Cell: '/src/admin/cells/cells#PublishStatusCell' } } },
    { name: 'averageScore', type: 'ui', label: 'Average score', admin: { components: { Cell: '/src/admin/cells/cells#QuizAverageCell' } } },
  ], timestamps: true,
}
