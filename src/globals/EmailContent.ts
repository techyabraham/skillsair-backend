import type { GlobalConfig } from 'payload'

/**
 * Owner-supplied content for the lifecycle emails. Anything left empty is simply left out of
 * the emails; nothing is ever invented in its place (brief section 11).
 */
export const EmailContent: GlobalConfig = {
  slug: 'email-content',
  label: 'Email content',
  admin: { group: 'Content', description: 'Optional, true content for the lifecycle emails. Empty fields are left out of the emails.' },
  access: {
    read: ({ req }) => req.user?.role === 'admin',
    update: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    {
      name: 'founderAnecdote',
      type: 'textarea',
      maxLength: 800,
      admin: {
        description:
          'Email A2 ("Why we made it ₦2,000 a month"): one true, specific memory from Abraham, 1–3 sentences. Leave empty to omit the paragraph.',
      },
    },
    {
      name: 'proofItems',
      type: 'array',
      admin: {
        description:
          'Real proof only (a learner quote or result you have permission to use). Emails show the first approved item; with none approved, they show nothing. Never add invented testimonials or counts.',
      },
      fields: [
        { name: 'text', type: 'textarea', required: true, maxLength: 400 },
        { name: 'attribution', type: 'text', required: true, maxLength: 100, admin: { description: 'e.g. "Ada, Data Analysis graduate". Use only with their permission.' } },
        { name: 'approved', type: 'checkbox', defaultValue: false, admin: { description: 'Tick only when you have the person’s permission and the claim is true.' } },
      ],
    },
  ],
}
