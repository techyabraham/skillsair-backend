import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { DISPLAY_TITLES } from '../hooks/display-title.js'

export const AccessExtensions: CollectionConfig = {
  slug: 'access-extensions', labels: { singular: 'Access extension', plural: 'Access extensions' },
  admin: {
    group: STUDIO_GROUP.learners,
    useAsTitle: 'displayTitle',
    defaultColumns: ['student', 'course', 'daysAdded', 'newExpiryDate', 'extendedBy'],
  },
  access: {
    read: ({ req }) => {
      if (req.user?.role === 'admin') return true
      if (req.user) return { student: { equals: req.user.id } }
      return false
    },
    create: ({ req }) => req.user?.role === 'admin',
    update: () => false,
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    DISPLAY_TITLES.accessExtensions,
    { name: 'student', type: 'relationship', relationTo: 'users', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses' },
    { name: 'extendedBy', type: 'relationship', relationTo: 'users', required: true },
    { name: 'daysAdded', type: 'number', required: true, min: 1 },
    { name: 'reason', type: 'text', required: true },
    { name: 'previousExpiryDate', type: 'date' },
    { name: 'newExpiryDate', type: 'date', required: true },
  ],
  timestamps: true,
}
