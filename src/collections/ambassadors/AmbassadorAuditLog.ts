import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../../admin/studio-config.js'
import { adminOnly, nobody } from './shared.js'

/** Who changed ambassador money or status, and how. Written by src/lib/ambassadors/audit.ts; never updated or deleted. */
export const AmbassadorAuditLog: CollectionConfig = {
  slug: 'ambassador-audit-log',
  labels: { singular: 'Audit entry', plural: 'Audit log' },
  admin: {
    group: STUDIO_GROUP.ambassadors,
    useAsTitle: 'action',
    defaultColumns: ['action', 'actor', 'targetCollection', 'targetId', 'createdAt'],
  },
  access: { read: adminOnly, create: nobody, update: nobody, delete: nobody },
  fields: [
    { name: 'actor', type: 'relationship', relationTo: 'users' },
    { name: 'action', type: 'text', maxLength: 100 },
    { name: 'targetCollection', type: 'text', maxLength: 100 },
    { name: 'targetId', type: 'text', maxLength: 100 },
    { name: 'before', type: 'json' },
    { name: 'after', type: 'json' },
    { name: 'ip', type: 'text', maxLength: 64 },
  ],
  timestamps: true,
}
