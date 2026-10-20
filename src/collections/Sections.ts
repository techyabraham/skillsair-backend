import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'

export const Sections: CollectionConfig = {
  slug: 'sections', labels: { singular: 'Section', plural: 'Sections' },
  admin: {
    group: STUDIO_GROUP.learning,
    useAsTitle: 'title',
    defaultColumns: ['order', 'title', 'course', 'lessonCount', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    update: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    delete: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'order', type: 'number', required: true, admin: { components: { Cell: '/src/admin/cells/cells#OrderNumberCell' } } },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'lessonCount', type: 'ui', label: 'Lessons', admin: { components: { Cell: '/src/admin/cells/cells#SectionLessonCountCell' } } },
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
