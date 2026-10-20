import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { DISPLAY_TITLES } from '../hooks/display-title.js'

export const Reviews: CollectionConfig = {
  slug: 'reviews', labels: { singular: 'Review', plural: 'Reviews' }, admin: { group: STUDIO_GROUP.learners, useAsTitle: 'displayTitle', defaultColumns: ['course', 'student', 'rating', 'createdAt'] },
  access: {
    read: () => true, create: () => false,
    update: ({ req }) => req.user?.role === 'admin', delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    DISPLAY_TITLES.reviews,
    { name: 'student', type: 'relationship', relationTo: 'users', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'rating', type: 'number', required: true, min: 1, max: 5 },
    { name: 'body', type: 'textarea', required: true, maxLength: 3000 },
  ], timestamps: true,
}
