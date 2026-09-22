import type { CollectionConfig } from 'payload'
import { afterPayment } from '../hooks/orders/afterPayment.js'

export const Orders: CollectionConfig = {
  slug: 'orders',
  admin: {
    useAsTitle: 'reference',
  },
  hooks: {
    afterChange: [afterPayment],
  },
  access: {
    read: ({ req }) => {
      if (req.user?.role === 'admin') return true
      if (req.user) return { user: { equals: req.user.id } }
      return false
    },
    create: () => false,
    update: () => false,
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Course Purchase', value: 'course' },
        { label: 'Subscription', value: 'subscription' },
        { label: 'Certificate', value: 'certificate' },
      ],
    },
    { name: 'course', type: 'relationship', relationTo: 'courses' },
    { name: 'plan', type: 'relationship', relationTo: 'plans' },
    { name: 'amount', type: 'number', required: true, min: 0 },
    { name: 'currency', type: 'text', required: true, defaultValue: 'NGN' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Success', value: 'success' },
        { label: 'Failed', value: 'failed' },
        { label: 'Refunded', value: 'refunded' },
      ],
    },
    { name: 'reference', type: 'text', required: true, unique: true },
    { name: 'paystackTransactionId', type: 'text' },
    { name: 'paidAt', type: 'date' },
    { name: 'metadata', type: 'json' },
  ],
  timestamps: true,
}
