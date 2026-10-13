import type { CollectionConfig } from 'payload'

export const AccessExtensions: CollectionConfig = {
  slug: 'access-extensions',
  admin: {
    group: 'People',
    useAsTitle: 'id',
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
