import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'

export const NewsletterSubscribers: CollectionConfig = {
  slug: 'newsletter-subscribers', labels: { singular: 'Newsletter subscriber', plural: 'Newsletter subscribers' },
  admin: {
    group: STUDIO_GROUP.messaging,
    useAsTitle: 'email',
    defaultColumns: ['email', 'status', 'subscribedAt', 'createdAt'],
  },
  access: {
    read: ({ req }) => req.user?.role === 'admin',
    create: ({ req }) => req.user?.role === 'admin',
    update: ({ req }) => req.user?.role === 'admin',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    {
      name: 'email',
      type: 'email',
      required: true,
      unique: true,
      hooks: {
        beforeValidate: [({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value],
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'subscribed',
      options: [
        { label: 'Subscribed', value: 'subscribed' },
        { label: 'Unsubscribed', value: 'unsubscribed' },
      ],
    },
    { name: 'subscribedAt', type: 'date', defaultValue: () => new Date().toISOString() },
    { name: 'source', type: 'text', defaultValue: 'website' },
  ],
  timestamps: true,
}
