import type { CollectionConfig, PayloadRequest } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { bumpCourseCacheHook } from '../lib/cache.js'

const staff = ({ req }: { req: PayloadRequest }) => req.user?.role === 'admin' || req.user?.role === 'instructor'

/**
 * A question in a programme's pool. Content packs (content:import) upsert questions by `key`;
 * only `approved` questions are ever served. Answers (`correctIndexes`, `correctIndex`) and
 * `explanation` are never readable by learners: the quiz endpoints score on the server and send
 * explanations only after a chapter quiz or knowledge check is submitted.
 */
export const QuizQuestions: CollectionConfig = {
  slug: 'quiz-questions', labels: { singular: 'Question', plural: 'Questions' }, admin: { group: STUDIO_GROUP.learning, useAsTitle: 'prompt', defaultColumns: ['prompt', 'type', 'status', 'course', 'section', 'updatedAt'] },
  access: {
    read: () => true,
    create: staff,
    update: staff,
    delete: ({ req }) => req.user?.role === 'admin',
  },
  indexes: [{ fields: ['course', 'section', 'status'] }],
  hooks: {
    beforeChange: [
      ({ data }) => {
        // Keep the legacy single answer and the new list in step (older quiz code reads correctIndex).
        const indexes = Array.isArray(data.correctIndexes) ? data.correctIndexes.map(Number).filter((n: number) => Number.isInteger(n)) : []
        if (indexes.length) data.correctIndex = indexes[0]
        else if (typeof data.correctIndex === 'number') data.correctIndexes = [data.correctIndex]
        return data
      },
    ],
    afterChange: [bumpCourseCacheHook()],
    afterDelete: [bumpCourseCacheHook()],
  },
  fields: [
    { name: 'prompt', type: 'text', required: true, admin: { components: { Cell: '/src/admin/cells/cells#QuestionPromptCell' } } },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'single',
      options: [
        { label: 'One correct answer', value: 'single' },
        { label: 'Two or more correct answers', value: 'multiple' },
        { label: 'True or false', value: 'true_false' },
      ],
    },
    { name: 'options', type: 'array', required: true, minRows: 2, fields: [{ name: 'text', type: 'text', required: true }] },
    {
      name: 'correctIndexes',
      type: 'number',
      hasMany: true,
      min: 0,
      access: { read: staff },
      admin: { description: 'Positions of the correct options, counting from 0.' },
    },
    {
      // Kept for older code until the assessment engine is fully switched over; mirrors correctIndexes[0].
      name: 'correctIndex',
      type: 'number',
      min: 0,
      access: { read: staff },
      admin: { hidden: true },
    },
    { name: 'explanation', type: 'richText', editor: lexicalEditor({}), access: { read: staff }, admin: { description: 'Why the answer is right, up to 60 words, citing the lesson.' } },
    {
      type: 'row',
      fields: [
        { name: 'course', type: 'relationship', relationTo: 'courses' },
        { name: 'section', type: 'relationship', relationTo: 'sections', label: 'Chapter' },
        { name: 'lesson', type: 'relationship', relationTo: 'lessons' },
        { name: 'sourceTimestamp', type: 'text', maxLength: 12, admin: { description: 'Where in the lesson, e.g. 04:12.' } },
      ],
    },
    {
      name: 'pools',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'Knowledge check', value: 'knowledge_check' },
        { label: 'Chapter quiz', value: 'chapter' },
        { label: 'Final exam', value: 'exam' },
      ],
      access: { read: staff },
    },
    {
      type: 'row',
      fields: [
        { name: 'status', type: 'select', required: true, defaultValue: 'draft', options: [{ label: 'Draft', value: 'draft' }, { label: 'Approved', value: 'approved' }, { label: 'Retired', value: 'retired' }], admin: { description: 'Only approved questions are served.' } },
        { name: 'origin', type: 'select', required: true, defaultValue: 'manual', options: [{ label: 'Content pack', value: 'content_pack' }, { label: 'Manual', value: 'manual' }], admin: { readOnly: true } },
        { name: 'key', type: 'text', unique: true, index: true, access: { read: staff }, admin: { readOnly: true, description: 'Stable id from the content pack.' } },
      ],
    },
    {
      name: 'stats',
      type: 'group',
      access: { read: staff },
      admin: { readOnly: true, description: 'Item analysis (nightly) once served 30+ times.' },
      fields: [
        { name: 'timesServed', type: 'number', defaultValue: 0 },
        { name: 'pValue', type: 'number', admin: { description: 'Share answered correctly.' } },
        { name: 'discrimination', type: 'number', admin: { description: 'Point-biserial correlation with the total score.' } },
      ],
    },
  ], timestamps: true,
}
