import type { CollectionConfig } from 'payload'

export const Discussions: CollectionConfig = {
  slug: 'discussions', admin: { group: 'Learning', useAsTitle: 'id', defaultColumns: ['course', 'lesson', 'author', 'parent', 'createdAt'] },
  access: {
    read: () => true, create: () => false,
    update: ({ req }) => req.user?.role === 'admin', delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'author', type: 'relationship', relationTo: 'users', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'lesson', type: 'relationship', relationTo: 'lessons' },
    { name: 'parent', type: 'relationship', relationTo: 'discussions' },
    { name: 'externalId', type: 'text', unique: true, admin: { readOnly: true } },
    { name: 'body', type: 'textarea', required: true, maxLength: 5000 },
  ], timestamps: true,
}
