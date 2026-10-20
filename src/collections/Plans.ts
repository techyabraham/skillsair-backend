import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'

export const Plans: CollectionConfig = {
  slug: 'plans', labels: { singular: 'Plan', plural: 'Plans' },
  admin: {
    group: STUDIO_GROUP.revenue,
    useAsTitle: 'name',
    defaultColumns: ['name', 'course', 'kind', 'price', 'paystackPlanCode', 'isActive'],
  },
  access: {
    read: () => true,
    create: ({ req }) => req.user?.role === 'admin',
    update: ({ req }) => req.user?.role === 'admin',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'price', type: 'number', required: true, min: 0, admin: { components: { Cell: '/src/admin/cells/cells#PlanPriceCell' } } },
    {
      name: 'interval',
      type: 'select',
      required: true,
      options: [
        { label: 'Monthly', value: 'monthly' },
        { label: 'Annually', value: 'annually' },
      ],
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'standard',
      options: [
        { label: 'Access Scholarship (only while a window is open)', value: 'scholarship' },
        { label: 'Standard', value: 'standard' },
      ],
      admin: {
        description:
          'Scholarship plans (₦2,000 a month) can only be started while a scholarship window is open. Learners who subscribed keep their rate.',
        components: { Cell: '/src/admin/cells/cells#PlanKindValueCell' },
      },
    },
    { name: 'paystackPlanCode', type: 'text', admin: { components: { Cell: '/src/admin/cells/cells#PaystackCodeCell' } } },
    {
      name: 'features',
      type: 'array',
      fields: [{ name: 'feature', type: 'text', required: true }],
    },
    { name: 'isActive', type: 'checkbox', defaultValue: true },
  ],
  timestamps: true,
}
