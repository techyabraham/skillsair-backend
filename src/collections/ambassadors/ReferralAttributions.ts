import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../../admin/studio-config.js'
import { adminOnly } from './shared.js'

/**
 * Who referred whom. A row starts on an application (lead) when someone applies through a referral
 * link, and moves onto their account (referredUser) when they sign up; or starts on the account when
 * they sign up or pay first. Each lead and each user has at most one row.
 */
export const ReferralAttributions: CollectionConfig = {
  slug: 'referral-attributions',
  labels: { singular: 'Referral attribution', plural: 'Referral attributions' },
  admin: {
    group: STUDIO_GROUP.ambassadors,
    defaultColumns: ['referredUser', 'lead', 'ambassador', 'source', 'attributedAt'],
  },
  access: { read: adminOnly, create: adminOnly, update: adminOnly, delete: adminOnly },
  hooks: {
    beforeValidate: [
      ({ data, originalDoc }) => {
        const merged = { ...(originalDoc ?? {}), ...(data ?? {}) } as { referredUser?: unknown; lead?: unknown }
        if (!merged.referredUser && !merged.lead) throw new Error('An attribution needs a referred user or an application')
        return data
      },
    ],
  },
  fields: [
    {
      name: 'referredUser',
      type: 'relationship',
      relationTo: 'users',
      unique: true,
      admin: { description: 'Empty while the person has applied but not created an account.' },
    },
    { name: 'lead', type: 'relationship', relationTo: 'leads', unique: true, label: 'Application', admin: { description: 'The application they made through the referral link, if any.' } },
    { name: 'ambassador', type: 'relationship', relationTo: 'ambassadors', required: true, index: true },
    { name: 'firstClickAt', type: 'date' },
    { name: 'attributedAt', type: 'date', required: true },
    {
      name: 'source',
      type: 'select',
      options: [
        { label: 'Referral cookie at application', value: 'cookie_apply' },
        { label: 'Referral cookie at sign-up', value: 'cookie_register' },
        { label: 'Referral cookie at checkout', value: 'cookie_checkout' },
        { label: 'Admin', value: 'admin' },
      ],
    },
    { name: 'lockedUntil', type: 'date', admin: { description: 'Empty means the attribution is permanent.' } },
  ],
  timestamps: true,
}
