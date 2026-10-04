import type { CollectionConfig } from 'payload'

export const Reviews: CollectionConfig = {
  slug: 'reviews', admin: { useAsTitle: 'id' },
  access: {
    read: () => true, create: () => false,
    update: ({ req }) => req.user?.role === 'admin', delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'student', type: 'relationship', relationTo: 'users', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'rating', type: 'number', required: true, min: 1, max: 5 },
    { name: 'body', type: 'textarea', required: true, maxLength: 3000 },
  ], timestamps: true,
}
