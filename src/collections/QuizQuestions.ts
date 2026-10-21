import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'

export const QuizQuestions: CollectionConfig = {
  slug: 'quiz-questions', labels: { singular: 'Question', plural: 'Questions' }, admin: { group: STUDIO_GROUP.learning, useAsTitle: 'prompt', defaultColumns: ['prompt', 'correctIndex', 'createdAt'] },
  access: {
    read: () => true,
    create: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    update: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'prompt', type: 'text', required: true, admin: { components: { Cell: '/src/admin/cells/cells#QuestionPromptCell' } } },
    { name: 'options', type: 'array', required: true, minRows: 2, fields: [{ name: 'text', type: 'text', required: true }] },
    { name: 'correctIndex', type: 'number', required: true, min: 0, access: { read: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor' } },
  ], timestamps: true,
}
