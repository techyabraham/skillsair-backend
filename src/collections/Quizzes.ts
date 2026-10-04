import type { CollectionConfig } from 'payload'

export const Quizzes: CollectionConfig = {
  slug: 'quizzes', admin: { useAsTitle: 'title' },
  access: {
    read: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor' ? true : { isPublished: { equals: true } },
    create: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    update: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'questions', type: 'relationship', relationTo: 'quiz-questions', hasMany: true, required: true },
    { name: 'passingScore', type: 'number', required: true, min: 0, max: 100, defaultValue: 70 },
    { name: 'isPublished', type: 'checkbox', defaultValue: false },
  ], timestamps: true,
}
