import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { DISPLAY_TITLES } from '../hooks/display-title.js'

export const Discussions: CollectionConfig = {
  slug: 'discussions', labels: { singular: 'Discussion', plural: 'Discussions' }, admin: { group: STUDIO_GROUP.learners, useAsTitle: 'displayTitle', defaultColumns: ['course', 'lesson', 'author', 'parent', 'createdAt'] },
  access: {
    read: () => true, create: () => false,
    update: ({ req }) => req.user?.role === 'admin', delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    DISPLAY_TITLES.discussions,
    { name: 'author', type: 'relationship', relationTo: 'users', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'lesson', type: 'relationship', relationTo: 'lessons' },
    { name: 'parent', type: 'relationship', relationTo: 'discussions' },
    { name: 'externalId', type: 'text', unique: true, admin: { readOnly: true } },
    { name: 'body', type: 'textarea', required: true, maxLength: 5000 },
  ], timestamps: true,
}
