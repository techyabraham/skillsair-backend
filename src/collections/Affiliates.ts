import type { CollectionConfig } from 'payload'
import { encryptField, decryptField } from '../utils/sanitize.js'

export const Affiliates: CollectionConfig = {
  slug: 'affiliates',
  admin: {
    useAsTitle: 'id',
  },
  access: {
    read: ({ req }) => {
      if (req.user?.role === 'admin') return true
      if (req.user) return { user: { equals: req.user.id } }
      return false
    },
    create: ({ req }) => req.user?.role === 'admin',
    update: ({ req, id }) => {
      if (req.user?.role === 'admin') return true
      if (req.user && String(req.user.id) === String(id)) return true
      return false
    },
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
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
