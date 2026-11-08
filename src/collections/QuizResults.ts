import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { getQuizResultEndpoint, joinQuizWaitlistEndpoint } from '../endpoints/quiz/results.js'

const isAdmin = ({ req }: { req: { user?: unknown } }) => (req.user as { role?: string } | null | undefined)?.role === 'admin'

/**
 * One Career Match quiz result. Created only by POST /api/leads (source "quiz"), which validates
 * the answers and recomputes every score on the server. The public page /quiz/result/<publicId>
 * reads it through GET /api/quiz-results/:publicId (first name only, no contact details).
 */
export const QuizResults: CollectionConfig = {
  slug: 'quiz-results',
  labels: { singular: 'Quiz result', plural: 'Quiz results' },
  admin: {
    group: STUDIO_GROUP.admissions,
    useAsTitle: 'publicId',
    defaultColumns: ['firstName', 'topMatch', 'topOpenMatch', 'lead', 'createdAt'],
    description: 'Career Match quiz results. Scores are recomputed on the server from the answers.',
  },
  defaultSort: '-createdAt',
  endpoints: [getQuizResultEndpoint, joinQuizWaitlistEndpoint],
  access: { read: isAdmin, create: () => false, update: () => false, delete: isAdmin },
  fields: [
    { name: 'publicId', type: 'text', required: true, unique: true, index: true, admin: { readOnly: true, description: 'Powers https://skillsair.com/quiz/result/<id>.' } },
    { name: 'quizVersion', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'firstName', type: 'text', maxLength: 100, admin: { readOnly: true } },
    { name: 'lead', type: 'relationship', relationTo: 'leads', index: true, admin: { readOnly: true } },
    { name: 'user', type: 'relationship', relationTo: 'users', admin: { readOnly: true, description: 'Set when the email already had an account.' } },
    { name: 'topMatch', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'topOpenMatch', type: 'relationship', relationTo: 'courses', admin: { readOnly: true } },
    { name: 'answers', type: 'json', admin: { readOnly: true } },
    { name: 'tieBreaker', type: 'text', admin: { readOnly: true, description: 'The career picked on the tie-breaker screen, if it was shown.' } },
    { name: 'scores', type: 'json', admin: { readOnly: true } },
    { name: 'traits', type: 'json', admin: { readOnly: true } },
    { name: 'context', type: 'json', admin: { readOnly: true, description: 'Current situation, device and weekly hours.' } },
  ],
  timestamps: true,
}
