import type { CollectionConfig } from 'payload'
import { resolveAuthUser } from '../middleware/authenticate.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'

/**
 * A paid certificate waiting for its final exam. Paying the certificate fee creates one
 * (`awaiting_exam`); passing the final exam issues the certificate (`passed`). The fee covers every
 * attempt. Refunding the certificate order sets `refunded`.
 */
export const CertificateEntitlements: CollectionConfig = {
  slug: 'certificate-entitlements',
  labels: { singular: 'Certificate entitlement', plural: 'Certificate entitlements' },
  admin: { group: STUDIO_GROUP.learning, useAsTitle: 'id', defaultColumns: ['student', 'course', 'status', 'paidAt', 'passedAt'] },
  access: {
    read: async ({ req }) => {
      const user = req.user ?? await resolveAuthUser(req)
      if (user?.role === 'admin') return true
      return user ? { student: { equals: user.id } } : false
    },
    create: () => false,
    update: ({ req }) => req.user?.role === 'admin',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  indexes: [{ fields: ['student', 'course', 'status'] }],
  fields: [
    { name: 'student', type: 'relationship', relationTo: 'users', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'order', type: 'relationship', relationTo: 'orders' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'awaiting_exam',
      options: [
        { label: 'Awaiting exam', value: 'awaiting_exam' },
        { label: 'Passed', value: 'passed' },
        { label: 'Refunded', value: 'refunded' },
      ],
    },
    { name: 'paidAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
    { name: 'passedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
  ],
  timestamps: true,
}
