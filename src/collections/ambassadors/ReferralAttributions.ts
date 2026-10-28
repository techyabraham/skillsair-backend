import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../../admin/studio-config.js'
import { adminOnly } from './shared.js'

export const ReferralAttributions: CollectionConfig = {
  slug: 'referral-attributions',
  labels: { singular: 'Referral attribution', plural: 'Referral attributions' },
  admin: {
    group: STUDIO_GROUP.ambassadors,
    defaultColumns: ['referredUser', 'ambassador', 'source', 'attributedAt', 'lockedUntil'],
  },
  access: { read: adminOnly, create: adminOnly, update: adminOnly, delete: adminOnly },
  fields: [
    { name: 'referredUser', type: 'relationship', relationTo: 'users', required: true, unique: true },
    { name: 'ambassador', type: 'relationship', relationTo: 'ambassadors', required: true, index: true },
    { name: 'firstClickAt', type: 'date' },
    { name: 'attributedAt', type: 'date', required: true },
    {
      name: 'source',
      type: 'select',
      options: [
        { label: 'Referral cookie at sign-up', value: 'cookie_register' },
        { label: 'Referral cookie at checkout', value: 'cookie_checkout' },
        { label: 'Legacy WordPress link', value: 'legacy_wp' },
        { label: 'Admin', value: 'admin' },
        { label: 'WordPress import', value: 'wp_import' },
      ],
    },
    { name: 'lockedUntil', type: 'date', admin: { description: 'Empty means the attribution is permanent.' } },
  ],
  timestamps: true,
}
