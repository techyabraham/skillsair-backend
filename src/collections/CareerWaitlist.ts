import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { notifyWaitlistEndpoint } from '../endpoints/quiz/waitlist-notify.js'

const isAdmin = ({ req }: { req: { user?: unknown } }) => (req.user as { role?: string } | null | undefined)?.role === 'admin'

/**
 * Demand for careers SkillsAir doesn't run yet: one row per applicant per career, joined with
 * one tap on the quiz result page. Counts per career are shown above the list; when a career's
 * programme is published, "Notify" sends the launch message (consenting applicants only) and
 * stamps notifiedAt. Nothing is sent automatically.
 */
export const CareerWaitlist: CollectionConfig = {
  slug: 'career-waitlist',
  labels: { singular: 'Career waitlist entry', plural: 'Career waitlist' },
  admin: {
    group: STUDIO_GROUP.admissions,
    defaultColumns: ['career', 'lead', 'joinedAt', 'notifiedAt', 'source'],
    components: { beforeListTable: ['/src/admin/lists/career-waitlist#CareerWaitlistStrip'] },
    description: 'Who wants a programme SkillsAir does not run yet. Use the counts to decide what to launch next.',
  },
  defaultSort: '-joinedAt',
  endpoints: [notifyWaitlistEndpoint],
  access: { read: isAdmin, create: () => false, update: isAdmin, delete: isAdmin },
  indexes: [{ fields: ['lead', 'career'], unique: true }],
  fields: [
    { name: 'lead', type: 'relationship', relationTo: 'leads', required: true, index: true },
    { name: 'career', type: 'text', required: true, index: true, admin: { description: 'Career id from the quiz, e.g. ethical-hacking.' } },
    { name: 'joinedAt', type: 'date', required: true },
    {
      name: 'source',
      type: 'select',
      required: true,
      defaultValue: 'quiz',
      options: [
        { label: 'Quiz', value: 'quiz' },
        { label: 'Other', value: 'other' },
      ],
    },
    { name: 'notifiedAt', type: 'date', index: true, admin: { description: 'When the launch message was sent.' } },
  ],
  timestamps: true,
}
