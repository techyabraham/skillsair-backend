import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../../admin/studio-config.js'
import { adminOnly, matches } from './shared.js'

export const ReferralClicks: CollectionConfig = {
  slug: 'referral-clicks',
  labels: { singular: 'Referral click', plural: 'Referral clicks' },
  admin: {
    group: STUDIO_GROUP.ambassadors,
    defaultColumns: ['ambassador', 'landingPath', 'referrerHost', 'utmSource', 'isUnique', 'createdAt'],
  },
  access: { read: adminOnly, create: adminOnly, update: adminOnly, delete: adminOnly },
  indexes: [{ fields: ['ambassador', 'createdAt'] }],
  fields: [
    { name: 'ambassador', type: 'relationship', relationTo: 'ambassadors', index: true },
    { name: 'visitorHash', type: 'text', validate: matches(/^[a-f0-9]{64}$/, 'A sha256 hex digest', false) },
    { name: 'landingPath', type: 'text', maxLength: 300 },
    { name: 'referrerHost', type: 'text', maxLength: 200 },
    { name: 'utmSource', type: 'text', maxLength: 100 },
    { name: 'utmMedium', type: 'text', maxLength: 100 },
    { name: 'utmCampaign', type: 'text', maxLength: 100 },
    { name: 'isUnique', type: 'checkbox', defaultValue: false },
  ],
  timestamps: true,
}
