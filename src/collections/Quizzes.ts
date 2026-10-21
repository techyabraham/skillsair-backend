import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'

export const Quizzes: CollectionConfig = {
  slug: 'quizzes', labels: { singular: 'Quiz', plural: 'Quizzes' }, admin: { group: STUDIO_GROUP.learning, useAsTitle: 'title', defaultColumns: ['title', 'course', 'questions', 'averageScore', 'isPublished', 'updatedAt'] },
  access: {
    read: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor' ? true : { isPublished: { equals: true } },
    create: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    update: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'questions', type: 'relationship', relationTo: 'quiz-questions', hasMany: true, required: true, admin: { components: { Cell: '/src/admin/cells/cells#QuestionCountCell' } } },
    { name: 'passingScore', type: 'number', required: true, min: 0, max: 100, defaultValue: 70 },
    { name: 'isPublished', type: 'checkbox', defaultValue: false, admin: { components: { Cell: '/src/admin/cells/cells#PublishStatusCell' } } },
    { name: 'averageScore', type: 'ui', label: 'Average score', admin: { components: { Cell: '/src/admin/cells/cells#QuizAverageCell' } } },
  ], timestamps: true,
}
