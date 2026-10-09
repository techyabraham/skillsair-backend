import type { CollectionConfig, FieldAccess } from 'payload'
import { isValidE164Phone, encryptField, decryptField } from '../utils/sanitize.js'
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
    useAsTitle: 'email',
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
      validate: (value: unknown) => {
        if (!value) return true
        if (typeof value !== 'string' || !isValidE164Phone(value)) {
          return 'Phone number must be in E.164 format (e.g. +2348012345678)'
        }
        return true
      },
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
  ],
  timestamps: true,
}
