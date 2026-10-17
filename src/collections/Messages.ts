import type { CollectionConfig } from 'payload'

/**
 * Every lifecycle message SkillsAir sends (or decides not to send), by email or WhatsApp.
 * Written only by server code (src/lib/lifecycle/send.ts); read-only in the admin.
 * `idempotencyKey` (`${track}:${stepId}:${subjectId}:${cycle}`) is unique, so a step can
 * never go to the same person twice in the same cycle, even when webhooks retry.
 */
export const Messages: CollectionConfig = {
  slug: 'messages',
  admin: {
    group: 'People',
    useAsTitle: 'idempotencyKey',
    defaultColumns: ['person', 'track', 'stepId', 'channel', 'status', 'sentAt'],
    description: 'Lifecycle emails and WhatsApp messages. Read-only.',
  },
  access: {
    read: ({ req }) => req.user?.role === 'admin',
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  indexes: [{ fields: ['personKey', 'sentAt'] }],
  fields: [
    { name: 'person', type: 'relationship', relationTo: ['users', 'leads'], required: true },
    {
      name: 'personKey',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true, description: '"user:<id>" or "lead:<id>", for fast cap and history lookups.' },
    },
    {
      name: 'channel',
      type: 'select',
      required: true,
      options: [
        { label: 'Email', value: 'email' },
        { label: 'WhatsApp', value: 'whatsapp' },
      ],
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      options: [
        { label: 'Transactional', value: 'transactional' },
        { label: 'Service', value: 'service' },
        { label: 'Marketing', value: 'marketing' },
      ],
    },
    { name: 'track', type: 'text', required: true, index: true },
    { name: 'stepId', type: 'text', required: true, index: true },
    { name: 'template', type: 'text', required: true },
    { name: 'subjectId', type: 'text', admin: { description: 'Enrolment, order, subscription or lead id the step is about.' } },
    { name: 'cycle', type: 'number', defaultValue: 0 },
    { name: 'idempotencyKey', type: 'text', required: true, unique: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'Sent', value: 'sent' },
        { label: 'Skipped', value: 'skipped' },
        { label: 'Failed', value: 'failed' },
      ],
    },
    { name: 'skipReason', type: 'text' },
    { name: 'providerId', type: 'text', index: true, admin: { description: 'Resend email id or Meta message id.' } },
    { name: 'sentAt', type: 'date', required: true, index: true },
    { name: 'openedAt', type: 'date' },
    { name: 'clickedAt', type: 'date' },
    { name: 'convertedAt', type: 'date' },
    { name: 'variant', type: 'text' },
  ],
  timestamps: true,
}
