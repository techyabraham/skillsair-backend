import type { CollectionConfig } from 'payload'

export const Referrals: CollectionConfig = {
  slug: 'referrals',
  admin: {
    useAsTitle: 'id',
  },
  access: {
    read: ({ req }) => {
      if (req.user?.role === 'admin') return true
      if (req.user) return { referrer: { equals: req.user.id } }
      return false
    },
    create: () => false,
    update: ({ req }) => req.user?.role === 'admin',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'referrer', type: 'relationship', relationTo: 'users', required: true },
    { name: 'referredUser', type: 'relationship', relationTo: 'users', required: true },
    { name: 'referralCode', type: 'text', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'registered',
      options: [
        { label: 'Registered', value: 'registered' },
        { label: 'Converted', value: 'converted' },
      ],
    },
    { name: 'order', type: 'relationship', relationTo: 'orders' },
    { name: 'commissionAmount', type: 'number', defaultValue: 0, min: 0 },
    { name: 'commissionPaid', type: 'checkbox', defaultValue: false },
    { name: 'convertedAt', type: 'date' },
  ],
  timestamps: true,
}
