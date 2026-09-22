import type { CollectionConfig } from 'payload'

export const Certificates: CollectionConfig = {
  slug: 'certificates',
  admin: {
    useAsTitle: 'certificateCode',
  },
  access: {
    read: ({ req }) => {
      if (req.user?.role === 'admin') return true
      if (req.user) return { student: { equals: req.user.id } }
      return false
    },
    create: () => false,
    update: () => false,
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'student', type: 'relationship', relationTo: 'users', required: true },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    { name: 'certificateCode', type: 'text', required: true, unique: true },
    { name: 'pdfUrl', type: 'text', required: true },
    { name: 'issuedAt', type: 'date', defaultValue: () => new Date().toISOString() },
  ],
  timestamps: true,
}
