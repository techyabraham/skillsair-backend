import type { CollectionConfig } from 'payload'
import { encryptField, decryptField } from '../utils/sanitize.js'
import { resolveAuthUser } from '../middleware/authenticate.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { DISPLAY_TITLES } from '../hooks/display-title.js'

export const Affiliates: CollectionConfig = {
  slug: 'affiliates', labels: { singular: 'Affiliate', plural: 'Affiliates' },
  admin: {
    group: STUDIO_GROUP.revenue,
    useAsTitle: 'displayTitle',
    defaultColumns: ['user', 'affiliateCode', 'isApproved', 'createdAt'],
  },
  access: {
    read: ({ req }) => {
      if (req.user?.role === 'admin') return true
      if (req.user) return { user: { equals: req.user.id } }
      return false
    },
    create: ({ req }) => req.user?.role === 'admin',
    // Admins only: payout details and earnings are never edited by the affiliate themselves.
    update: async ({ req }) => {
      const user = req.user ?? await resolveAuthUser(req)
      return user?.role === 'admin'
    },
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    DISPLAY_TITLES.affiliates,
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, unique: true },
    { name: 'affiliateCode', type: 'text', required: true, unique: true },
    { name: 'isApproved', type: 'checkbox', defaultValue: false },
    { name: 'commissionRate', type: 'number', defaultValue: 10, min: 0, max: 100 },
    { name: 'totalClicks', type: 'number', defaultValue: 0 },
    { name: 'totalConversions', type: 'number', defaultValue: 0 },
    { name: 'totalEarnings', type: 'number', defaultValue: 0 },
    { name: 'pendingEarnings', type: 'number', defaultValue: 0 },
    { name: 'accountName', type: 'text' },
    {
      name: 'bankName',
      type: 'text',
      hooks: {
        beforeChange: [({ value }) => (value ? encryptField(String(value)) : value)],
        afterRead: [
          ({ value }) => {
            if (!value || typeof value !== 'string') return value
            try {
              return decryptField(value)
            } catch {
              return value
            }
          },
        ],
      },
    },
    {
      name: 'accountNumber',
      type: 'text',
      hooks: {
        beforeChange: [({ value }) => (value ? encryptField(String(value)) : value)],
        afterRead: [
          ({ value }) => {
            if (!value || typeof value !== 'string') return value
            try {
              return decryptField(value)
            } catch {
              return value
            }
          },
        ],
      },
    },
  ],
  timestamps: true,
}
