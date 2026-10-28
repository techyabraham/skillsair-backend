import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../../admin/studio-config.js'
import { AMBASSADOR_CODE, AMBASSADOR_USERNAME, adminOnly, matches } from './shared.js'

export const Ambassadors: CollectionConfig = {
  slug: 'ambassadors',
  labels: { singular: 'Ambassador', plural: 'Ambassadors' },
  admin: {
    group: STUDIO_GROUP.ambassadors,
    useAsTitle: 'code',
    defaultColumns: ['code', 'username', 'user', 'status', 'source', 'createdAt'],
  },
  access: { read: adminOnly, create: adminOnly, update: adminOnly, delete: adminOnly },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, unique: true, index: true },
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      validate: matches(AMBASSADOR_CODE, 'Code must be 8 capital letters or digits', true),
      admin: { description: 'Referral code: https://skillsair.com/?skr=<code>' },
    },
    {
      name: 'username',
      type: 'text',
      required: true,
      unique: true,
      validate: matches(AMBASSADOR_USERNAME, 'Username: 3 to 30 lowercase letters, digits, dots or underscores', true),
      hooks: { beforeValidate: [({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)] },
      admin: { description: 'Public handle shown in the portal. Sign-in stays the email address.' },
    },
    {
      name: 'legacyWpRef',
      type: 'text',
      unique: true,
      label: 'Legacy WordPress ref',
      validate: matches(/^\d+$/, 'Digits only (the WordPress user id)', false),
      admin: { description: 'Old links ?ref=<WordPress user id> resolve to this ambassador.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Active', value: 'active' },
        { label: 'Blocked', value: 'blocked' },
      ],
    },
    {
      name: 'source',
      type: 'select',
      required: true,
      options: [
        { label: 'Applied', value: 'self' },
        { label: 'Added by an admin', value: 'admin' },
        { label: 'WordPress import', value: 'wp_import' },
      ],
    },
    { name: 'emailVerifiedAt', type: 'date' },
    { name: 'promotionPlan', type: 'textarea', maxLength: 2000 },
    { name: 'about', type: 'textarea', maxLength: 2000 },
    { name: 'heardAbout', type: 'text', maxLength: 200 },
    { name: 'approvedAt', type: 'date' },
    { name: 'approvedBy', type: 'relationship', relationTo: 'users' },
    { name: 'blockedAt', type: 'date' },
    { name: 'blockedReason', type: 'text', maxLength: 500 },
    {
      name: 'riskFlags',
      type: 'array',
      fields: [
        {
          name: 'kind',
          type: 'select',
          required: true,
          options: [
            { label: 'Shared bank account', value: 'shared_bank' },
            { label: 'Self-referral suspected', value: 'self_referral_suspected' },
            { label: 'Velocity', value: 'velocity' },
            { label: 'Manual', value: 'manual' },
          ],
        },
        { name: 'note', type: 'text', maxLength: 500 },
        { name: 'openedAt', type: 'date' },
        { name: 'resolvedAt', type: 'date' },
        { name: 'resolvedBy', type: 'relationship', relationTo: 'users' },
      ],
    },
  ],
  timestamps: true,
}
