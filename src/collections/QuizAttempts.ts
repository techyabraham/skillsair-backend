import type { CollectionConfig } from 'payload'
import { resolveAuthUser } from '../middleware/authenticate.js'

export const QuizAttempts: CollectionConfig = {
  slug: 'quiz-attempts', admin: { useAsTitle: 'id' },
  access: {
    read: async ({ req }) => {
      const user = req.user ?? await resolveAuthUser(req)
      return user?.role === 'admin' ? true : user ? { student: { equals: user.id } } : false
    },
    create: () => false, update: () => false, delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'student', type: 'relationship', relationTo: 'users', required: true },
    { name: 'quiz', type: 'relationship', relationTo: 'quizzes', required: true },
    { name: 'score', type: 'number', required: true, min: 0, max: 100 },
    { name: 'passed', type: 'checkbox', required: true },
    { name: 'answers', type: 'json' },
  ], timestamps: true,
}
