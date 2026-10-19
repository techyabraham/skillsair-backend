import type { CollectionConfig, FieldAccess } from 'payload'
import { encryptField, decryptField, validateEncryptedE164 } from '../utils/sanitize.js'
import { usersBeforeCreate } from '../hooks/users/beforeCreate.js'
import { usersAfterCreate } from '../hooks/users/afterCreate.js'
import { resolveAuthUser } from '../middleware/authenticate.js'

const isAdmin: FieldAccess = ({ req }) => {
  const user = req.user as unknown as { role?: string } | null | undefined
  return user?.role === 'admin'
}

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    tokenExpiration: 7 * 24 * 60 * 60,
    maxLoginAttempts: 10,
    lockTime: 60 * 60 * 1000,
    cookies: { secure: process.env.NODE_ENV === 'production', sameSite: 'Lax' },
  },
  admin: {
    group: 'People',
    useAsTitle: 'email',
    defaultColumns: ['email', 'firstName', 'lastName', 'role', 'isActive', 'createdAt'],
  },
  access: {
    read: async ({ req, id }) => {
      const user = req.user ?? await resolveAuthUser(req)
      if (user?.role === 'admin') return true
      if (user && String(user.id) === String(id)) return true
      if (user) return { id: { equals: user.id } }
      return false
    },
    create: ({ req }) => req.user?.role === 'admin',
    update: ({ req, id }) => {
      if (req.user?.role === 'admin') return true
      if (req.user && String(req.user.id) === String(id)) return true
      return false
    },
    delete: ({ req }) => req.user?.role === 'admin',
  },
  hooks: {
    beforeChange: [usersBeforeCreate],
    afterChange: [usersAfterCreate],
  },
  fields: [
    {
      name: 'firstName',
      type: 'text',
      required: true,
      maxLength: 100,
    },
    {
      name: 'lastName',
      type: 'text',
      required: true,
      maxLength: 100,
    },
    {
      name: 'phone',
      type: 'text',
      validate: (value: unknown) => validateEncryptedE164(value),
      hooks: {
        beforeChange: [({ value }) => (value ? encryptField(String(value)) : value)],
        afterRead: [({ value }) => {
          if (!value || typeof value !== 'string') return value
          try {
            return decryptField(value)
          } catch {
            return value
          }
        }],
      },
    },
    {
      name: 'avatar',
      type: 'relationship',
      relationTo: 'media',
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'student',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Instructor', value: 'instructor' },
        { label: 'Student', value: 'student' },
      ],
      access: {
        create: isAdmin,
        update: isAdmin,
      },
    },
    {
      name: 'isVerified',
      type: 'checkbox',
      defaultValue: false,
      access: { create: isAdmin, update: isAdmin },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      access: { create: isAdmin, update: isAdmin },
    },
    {
      name: 'isStudent',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Audience flag for people identified as SkillsAir students; separate from backend role permissions.',
      },
      access: { create: isAdmin, update: isAdmin },
    },
    {
      name: 'wordpressUserId',
      type: 'text',
      unique: true,
      admin: { description: 'Original WordPress user ID, retained for migration reconciliation.' },
      access: { create: isAdmin, update: isAdmin },
    },
    {
      name: 'wordpressRoles',
      type: 'array',
      admin: { description: 'Original WordPress roles; these do not grant permissions in SkillsAir.' },
      access: { create: isAdmin, update: isAdmin },
      fields: [{ name: 'role', type: 'text', required: true }],
    },
    {
      name: 'marketingConsent',
      type: 'select',
      required: true,
      defaultValue: 'unknown',
      options: [
        { label: 'Unknown', value: 'unknown' },
        { label: 'Opted in', value: 'opted_in' },
        { label: 'Opted out', value: 'opted_out' },
      ],
      admin: { description: 'Imported preference only. Unknown is not permission to send marketing email.' },
      access: { create: isAdmin, update: isAdmin },
    },
    {
      name: 'marketingConsentAt',
      type: 'date',
      access: { create: isAdmin, update: isAdmin },
    },
    {
      name: 'marketingConsentSource',
      type: 'text',
      access: { create: isAdmin, update: isAdmin },
    },
    {
      name: 'referralCode',
      type: 'text',
      unique: true,
      admin: { readOnly: true },
      access: { create: isAdmin, update: isAdmin },
    },
    {
      name: 'referredBy',
      type: 'relationship',
      relationTo: 'users',
      access: { update: isAdmin },
    },
    {
      name: 'accessExpiresAt',
      type: 'date',
      access: { create: isAdmin, update: isAdmin },
    },
    {
      name: 'accessExtensions',
      type: 'array',
      admin: { readOnly: true },
      access: { create: isAdmin, update: isAdmin },
      fields: [
        { name: 'extendedAt', type: 'date', required: true },
        { name: 'extendedBy', type: 'relationship', relationTo: 'users', required: true },
        { name: 'daysAdded', type: 'number', required: true },
        { name: 'reason', type: 'text', required: true },
        { name: 'newExpiryDate', type: 'date', required: true },
      ],
    },
    {
      name: 'lastLoginAt',
      type: 'date',
      access: { create: isAdmin, update: isAdmin },
    },
    {
      name: 'lifecycle',
      type: 'group',
      admin: { description: 'Lifecycle email state. Preferences are changed by the learner from the email preference centre.' },
      access: { create: isAdmin, update: isAdmin },
      fields: [
        { name: 'lastLearningAt', type: 'date', admin: { description: 'Last lesson progress; drives inactivity nudges.' } },
        {
          name: 'emailPrefs',
          type: 'group',
          fields: [
            { name: 'offers', type: 'checkbox', defaultValue: false, admin: { description: 'Offers and scholarship news. Also needs marketing consent.' } },
            { name: 'learningReminders', type: 'checkbox', defaultValue: true },
          ],
        },
        {
          name: 'emailSuppressed',
          type: 'select',
          options: [
            { label: 'Hard bounce', value: 'bounced' },
            { label: 'Spam complaint', value: 'complained' },
          ],
          admin: { description: 'Set by the Resend webhook. No email of any kind is sent, except a password reset.' },
        },
        { name: 'lastEngagedAt', type: 'date', admin: { description: 'Last email click, WhatsApp reply or site visit.' } },
        { name: 'sunsetAt', type: 'date', admin: { description: 'Marketing stopped after 90 days without engagement.' } },
      ],
    },
  ],
  timestamps: true,
}
