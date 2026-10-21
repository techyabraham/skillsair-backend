import type { CollectionConfig } from 'payload'
import { resolveAuthUser } from '../middleware/authenticate.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { DISPLAY_TITLES } from '../hooks/display-title.js'

export const Subscriptions: CollectionConfig = {
  slug: 'subscriptions', labels: { singular: 'Subscription', plural: 'Subscriptions' },
  admin: {
    group: STUDIO_GROUP.revenue,
    useAsTitle: 'displayTitle',
    defaultColumns: ['displayTitle', 'user', 'plan', 'status', 'currentPeriodEnd'],
    components: { beforeListTable: ['/src/admin/lists/strips#SubscriptionsStrip'] },
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
    DISPLAY_TITLES.subscriptions,
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, label: 'Learner', admin: { components: { Cell: '/src/admin/cells/cells#PersonCell' } } },
    { name: 'plan', type: 'relationship', relationTo: 'plans', required: true, admin: { components: { Cell: '/src/admin/cells/cells#PlanKindCell' } } },
    { name: 'course', type: 'relationship', relationTo: 'courses', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      admin: { components: { Cell: '/src/admin/cells/cells#SubscriptionStatusCell' } },
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Past due (renewal failed, in grace)', value: 'past_due' },
        { label: 'Cancelled', value: 'cancelled' },
        { label: 'Expired', value: 'expired' },
      ],
    },
    { name: 'paystackSubscriptionCode', type: 'text' },
    { name: 'paystackEmailToken', type: 'text' },
    { name: 'initialOrderReference', type: 'text', unique: true },
    { name: 'lastInvoiceCode', type: 'text' },
    { name: 'currentPeriodStart', type: 'date' },
    { name: 'currentPeriodEnd', type: 'date', admin: { components: { Cell: '/src/admin/cells/cells#RenewalCell' } } },
    { name: 'cancelledAt', type: 'date' },
    { name: 'failedAttempts', type: 'number', defaultValue: 0 },
    { name: 'lastFailedAt', type: 'date' },
    {
      name: 'priceLocked',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'On the ₦2,000-a-month Access Scholarship plan: the learner keeps that rate for this programme.' },
    },
    {
      name: 'billing',
      type: 'select',
      required: true,
      defaultValue: 'card',
      label: 'How they pay',
      options: [
        { label: 'Card (Paystack renews it each month)', value: 'card' },
        { label: 'Bank transfer or OPay (pays each month themselves)', value: 'manual' },
      ],
      admin: {
        description:
          'Transfer and OPay payments can’t renew automatically: each payment adds one month, the learner is reminded before it ends, and access continues for the grace days after.',
      },
    },
  ],
  timestamps: true,
}
