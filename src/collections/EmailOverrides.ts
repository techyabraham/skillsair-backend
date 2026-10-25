import type { Access, CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'

const adminOnly: Access = ({ req }) => req.user?.role === 'admin'

/**
 * Studio email wording (brief section 4.1): one row per template id, `_shared` or `_settings`.
 * `published` is what learners receive (null = the code defaults); `draft` is pending. Written by
 * src/emails/override-service.ts only, so every publish is validated and recorded in history.
 */
export const EmailOverrides: CollectionConfig = {
  slug: 'email-overrides',
  labels: { singular: 'Email override', plural: 'Email overrides' },
  admin: {
    group: STUDIO_GROUP.messaging,
    useAsTitle: 'templateId',
    defaultColumns: ['templateId', 'publishedAt', 'draftUpdatedAt'],
    description: 'Edited email wording. Edit, preview and publish in Studio → Emails.',
  },
  access: { read: adminOnly, create: adminOnly, update: adminOnly, delete: adminOnly },
  hooks: {
    beforeChange: [
      ({ req, data, originalDoc }) => {
        // The published wording changes only through the service (validated, with a history row).
        const changesPublished = JSON.stringify(data?.published ?? null) !== JSON.stringify(originalDoc?.published ?? null)
        if (changesPublished && !req.context?.emailOverrideService) throw new APIError('Publish email wording from Studio → Emails, so it’s checked and recorded.', 400)
        return data
      },
    ],
  },
  fields: [
    { name: 'templateId', type: 'text', required: true, unique: true, index: true, admin: { description: 'A template id, `_shared` or `_settings`.' } },
    { name: 'published', type: 'json', admin: { description: 'The live wording. Empty means the original wording.' } },
    { name: 'draft', type: 'json', admin: { description: 'Saved but not published.' } },
    { name: 'publishedAt', type: 'date' },
    { name: 'publishedBy', type: 'relationship', relationTo: 'users' },
    { name: 'draftUpdatedAt', type: 'date' },
    { name: 'draftUpdatedBy', type: 'relationship', relationTo: 'users' },
    { name: 'notes', type: 'textarea', maxLength: 2000, admin: { description: 'Internal notes.' } },
  ],
}

/** Append-only: one row per publish, reset or restore. */
export const EmailOverrideHistory: CollectionConfig = {
  slug: 'email-override-history',
  labels: { singular: 'Email override history', plural: 'Email override history' },
  admin: {
    group: STUDIO_GROUP.messaging,
    useAsTitle: 'templateId',
    defaultColumns: ['templateId', 'action', 'author', 'createdAt'],
    description: 'Every publish, reset and restore of email wording. Read-only.',
  },
  defaultSort: '-createdAt',
  access: { read: adminOnly, create: adminOnly, update: () => false, delete: adminOnly },
  fields: [
    { name: 'templateId', type: 'text', required: true, index: true },
    {
      name: 'action',
      type: 'select',
      required: true,
      options: [
        { label: 'Published', value: 'publish' },
        { label: 'Reset to original', value: 'reset' },
        { label: 'Restored to draft', value: 'restore_to_draft' },
      ],
    },
    { name: 'snapshot', type: 'json', admin: { description: 'The published wording after this action.' } },
    { name: 'author', type: 'relationship', relationTo: 'users' },
  ],
}
