import type { CollectionConfig } from 'payload'

export const Sections: CollectionConfig = {
  slug: 'sections',
  admin: {
    group: 'Learning',
    useAsTitle: 'title',
    defaultColumns: ['title', 'course', 'order', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    update: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    delete: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'order', type: 'number', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    {
      name: 'lessons',
      type: 'join',
      collection: 'lessons',
      on: 'section',
      defaultSort: 'order',
      admin: { allowCreate: true, defaultColumns: ['title', 'order', 'duration', 'isPublished'] },
    },
  ],
  timestamps: true,
}
