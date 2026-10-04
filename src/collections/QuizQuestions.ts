import type { CollectionConfig } from 'payload'

export const QuizQuestions: CollectionConfig = {
  slug: 'quiz-questions', admin: { useAsTitle: 'prompt' },
  access: {
    read: () => true,
    create: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    update: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'prompt', type: 'text', required: true },
    { name: 'options', type: 'array', required: true, minRows: 2, fields: [{ name: 'text', type: 'text', required: true }] },
    { name: 'correctIndex', type: 'number', required: true, min: 0, access: { read: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor' } },
  ], timestamps: true,
}
