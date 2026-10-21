import type { CollectionConfig } from 'payload'
import { resolveAuthUser } from '../middleware/authenticate.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'

export const Certificates: CollectionConfig = {
  slug: 'certificates', labels: { singular: 'Certificate', plural: 'Certificates' },
  admin: {
    group: STUDIO_GROUP.learning,
    useAsTitle: 'certificateCode',
    defaultColumns: ['certificateCode', 'student', 'course', 'issuedAt'],
  },
  access: {
    read: async ({ req }) => {
      const user = req.user ?? await resolveAuthUser(req)
      if (user?.role === 'admin') return true
      if (user) return { student: { equals: user.id } }
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
