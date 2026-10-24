import type { CollectionConfig } from 'payload'
import { resolveAuthUser } from '../middleware/authenticate.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { DISPLAY_TITLES } from '../hooks/display-title.js'
import { saveAnswersEndpoint, submitAttemptEndpoint } from '../endpoints/assessments/index.js'

/**
 * One attempt at a quiz or exam. An attempt is created `in_progress` when it starts (with the
 * questions and option order it was served and, for timed quizzes, `expiresAt`), autosaves
 * `answers`, and is scored on the server when submitted or when it expires. A learner has at most
 * one in-progress attempt per quiz (unique index in the database).
 */
export const QuizAttempts: CollectionConfig = {
  slug: 'quiz-attempts', labels: { singular: 'Quiz attempt', plural: 'Quiz attempts' }, admin: { group: STUDIO_GROUP.learners, useAsTitle: 'displayTitle', defaultColumns: ['student', 'quiz', 'status', 'score', 'passed', 'createdAt'] },
  access: {
    read: async ({ req }) => {
      const user = req.user ?? await resolveAuthUser(req)
      return user?.role === 'admin' ? true : user ? { student: { equals: user.id } } : false
    },
    create: () => false, update: () => false, delete: ({ req }) => req.user?.role === 'admin',
  },
  indexes: [{ fields: ['student', 'quiz', 'status'] }],
  endpoints: [saveAnswersEndpoint, submitAttemptEndpoint],
  fields: [
    DISPLAY_TITLES.quizAttempts,
    { name: 'student', type: 'relationship', relationTo: 'users', required: true },
    { name: 'quiz', type: 'relationship', relationTo: 'quizzes', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'submitted',
      options: [
        { label: 'In progress', value: 'in_progress' },
        { label: 'Submitted', value: 'submitted' },
        { label: 'Expired', value: 'expired' },
      ],
    },
    { name: 'attemptNumber', type: 'number', min: 1 },
    { name: 'score', type: 'number', min: 0, max: 100, admin: { description: 'Set when submitted.' } },
    { name: 'passed', type: 'checkbox' },
    { name: 'answers', type: 'json' },
    { name: 'servedQuestionIds', type: 'json', admin: { description: 'Question ids in the order served.' } },
    { name: 'servedOptionOrder', type: 'json', admin: { description: 'Per question, the original option positions in the order shown.' } },
    { name: 'perSectionScores', type: 'json' },
    {
      type: 'row',
      fields: [
        { name: 'startedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
        { name: 'expiresAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
        { name: 'submittedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
      ],
    },
  ], timestamps: true,
}
