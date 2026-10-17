import type { CollectionConfig } from 'payload'
import { resolveAuthUser } from '../middleware/authenticate.js'

export const Subscriptions: CollectionConfig = {
  slug: 'subscriptions',
  admin: {
    group: 'Commerce',
    useAsTitle: 'id',
    defaultColumns: ['user', 'course', 'plan', 'status', 'currentPeriodEnd'],
  },
  access: {
    read: async ({ req }) => {
      const user = req.user ?? await resolveAuthUser(req)
      if (user?.role === 'admin') return true
      if (user) return { user: { equals: user.id } }
      return false
    },
    create: () => false,
    update: () => false,
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true },
    { name: 'plan', type: 'relationship', relationTo: 'plans', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Past due (renewal failed, in grace)', value: 'past_due' },
        { label: 'Cancelled', value: 'cancelled' },
        { label: 'Expired', value: 'expired' },
      ],
    },
    { name: 'paystackSubscriptionCode', type: 'text' },
    { name: 'paystackEmailToken', type: 'text' },
    { name: 'initialOrderReference', type: 'text', unique: true },
    { name: 'lastInvoiceCode', type: 'text' },
    { name: 'currentPeriodStart', type: 'date' },
    { name: 'currentPeriodEnd', type: 'date' },
    { name: 'cancelledAt', type: 'date' },
    { name: 'failedAttempts', type: 'number', defaultValue: 0 },
    { name: 'lastFailedAt', type: 'date' },
    {
      name: 'priceLocked',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'On the ₦2,000-a-month Access Scholarship plan: the learner keeps that rate for this programme.' },
    },
  ],
  timestamps: true,
}
