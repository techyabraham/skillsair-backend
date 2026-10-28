import type { CollectionConfig } from 'payload'
import { resolveAuthUser } from '../middleware/authenticate.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'

export const Orders: CollectionConfig = {
  slug: 'orders', labels: { singular: 'Order', plural: 'Orders' },
  admin: {
    group: STUDIO_GROUP.revenue,
    useAsTitle: 'reference',
    defaultColumns: ['reference', 'user', 'type', 'amount', 'status', 'createdAt'],
    components: { beforeListTable: ['/src/admin/lists/strips#OrdersStrip'], edit: { beforeDocumentControls: ['/src/admin/edit/AmbassadorOrderRefund#AmbassadorOrderRefund'] } },
  },
  access: {
    read: async ({ req }) => {
      const user = req.user ?? await resolveAuthUser(req)
      if (user?.role === 'admin') return true
      if (user) return { user: { equals: user.id } }
      return false
    },
    create: () => false,
    update: () => false,
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, label: 'Learner', admin: { components: { Cell: '/src/admin/cells/cells#PersonCell' } } },
    {
      name: 'type',
      type: 'select',
      required: true,
      admin: { components: { Cell: '/src/admin/cells/cells#OrderTypeCell' } },
      options: [
        { label: 'Course Purchase', value: 'course' },
        { label: 'Subscription', value: 'subscription' },
        { label: 'Certificate', value: 'certificate' },
      ],
    },
    { name: 'course', type: 'relationship', relationTo: 'courses' },
    { name: 'plan', type: 'relationship', relationTo: 'plans' },
    { name: 'amount', type: 'number', required: true, min: 0, admin: { components: { Cell: '/src/admin/cells/cells#MoneyCell' } } },
    { name: 'currency', type: 'text', required: true, defaultValue: 'NGN' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      admin: { components: { Cell: '/src/admin/cells/cells#OrderStatusCell' } },
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Success', value: 'success' },
        { label: 'Failed', value: 'failed' },
        { label: 'Refunded', value: 'refunded' },
      ],
    },
    { name: 'reference', type: 'text', required: true, unique: true, admin: { components: { Cell: '/src/admin/cells/cells#ReferenceCell' } } },
    { name: 'paystackTransactionId', type: 'text' },
    { name: 'paidAt', type: 'date' },
    { name: 'fulfilledAt', type: 'date', admin: { readOnly: true } },
    { name: 'metadata', type: 'json' },
  ],
  timestamps: true,
}
