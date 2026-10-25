import type { GlobalConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { bumpOverrideVersion } from '../emails/override-version.js'

/**
 * Owner-supplied content for the lifecycle emails. Anything left empty is simply left out of
 * the emails; nothing is ever invented in its place (brief section 11).
 */
export const EmailContent: GlobalConfig = {
  slug: 'email-content',
  label: 'Email content',
  admin: { group: STUDIO_GROUP.messaging, description: 'Optional, true content for the lifecycle emails. Empty fields are left out of the emails.' },
  access: {
    read: ({ req }) => req.user?.role === 'admin',
    update: ({ req }) => req.user?.role === 'admin',
  },
  hooks: {
    // Email settings are read from memory by every process; tell them to reload.
    afterChange: [async () => void (await bumpOverrideVersion())],
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
    {
      name: 'emailSettings',
      type: 'group',
      label: 'Email settings',
      admin: { description: 'Shown on every email. Leave a field empty to use the original. Edit, preview and publish these in Studio → Emails → Email settings.' },
      fields: [
        { name: 'senderName', type: 'text', maxLength: 60, admin: { description: 'Default: EMAIL_FROM_NAME, or “Imisi from SkillsAir”.' }, validate: (value: unknown) => (typeof value === 'string' && /[<>"@\\]/.test(value) ? 'The sender name can’t contain < > " @ or a backslash.' : true) },
        { name: 'signOffName', type: 'text', maxLength: 60, admin: { description: 'Default: “Imisi, SkillsAir”.' } },
        {
          name: 'signOffHelp',
          type: 'text',
          maxLength: 200,
          admin: { description: 'Must keep a phone number or “Reply to this email”.' },
          validate: (value: unknown) => (typeof value === 'string' && value.trim() && !/\+?\d[\d\s]{7,}\d/.test(value) && !/reply to this email/i.test(value) ? 'Keep a phone number or “Reply to this email”.' : true),
        },
        {
          name: 'companyLine',
          type: 'text',
          maxLength: 200,
          admin: { description: 'Required legal text. It can be edited but must keep “RC 9272398”.' },
          validate: (value: unknown) => (typeof value === 'string' && value.trim() && !value.includes('RC 9272398') ? 'The company line must keep “RC 9272398”.' : true),
        },
      ],
    },
  ],
}
