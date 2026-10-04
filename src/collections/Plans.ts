import type { CollectionConfig } from 'payload'

export const Plans: CollectionConfig = {
  slug: 'plans',
  admin: {
    useAsTitle: 'name',
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
    { name: 'price', type: 'number', required: true, min: 0 },
    {
      name: 'interval',
      type: 'select',
      required: true,
      options: [
        { label: 'Monthly', value: 'monthly' },
        { label: 'Annually', value: 'annually' },
      ],
    },
    { name: 'paystackPlanCode', type: 'text' },
    {
      name: 'features',
      type: 'array',
      fields: [{ name: 'feature', type: 'text', required: true }],
    },
    { name: 'isActive', type: 'checkbox', defaultValue: true },
  ],
  timestamps: true,
}
