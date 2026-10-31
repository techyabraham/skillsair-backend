import type { CollectionConfig, FieldAccess } from 'payload'
import { encryptField, decryptField, validateEncryptedE164 } from '../utils/sanitize.js'
import { usersBeforeCreate } from '../hooks/users/beforeCreate.js'
import { usersAfterCreate } from '../hooks/users/afterCreate.js'
import { resolveAuthUser } from '../middleware/authenticate.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'

const isAdmin: FieldAccess = ({ req }) => {
  const user = req.user as unknown as { role?: string } | null | undefined
  return user?.role === 'admin'
}

export const Users: CollectionConfig = {
  slug: 'users', labels: { singular: 'Learner', plural: 'Learners' },
  auth: {
    tokenExpiration: 7 * 24 * 60 * 60,
    maxLoginAttempts: 10,
    lockTime: 60 * 60 * 1000,
    cookies: { secure: process.env.NODE_ENV === 'production', sameSite: 'Lax' },
  },
  admin: {
    group: STUDIO_GROUP.learners,
    useAsTitle: 'email',
    defaultColumns: ['firstName', 'role', 'activeSubscriptions', 'lastLoginAt', 'createdAt'],
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
    { name: 'learner360', type: 'ui', admin: { disableListColumn: true, components: { Field: '/src/admin/edit/learner#Learner360' } } },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Details',
          fields: [
            {
              name: 'firstName',
              type: 'text',
              required: true,
              maxLength: 100,
              admin: { components: { Cell: '/src/admin/cells/cells#LearnerCell' } },
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
              admin: { components: { Cell: '/src/admin/cells/cells#RoleCell' } },
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
              name: 'activeSubscriptions',
              type: 'ui',
              label: 'Subscriptions',
              admin: { components: { Cell: '/src/admin/cells/cells#ActiveSubscriptionsCell' } },
            },
            {
              name: 'lastLoginAt',
              type: 'date',
              admin: { components: { Cell: '/src/admin/cells/cells#RelativeDateCell' } },
              access: { create: isAdmin, update: isAdmin },
            },
          ],
        },
        {
          label: 'Access and consent',
          fields: [
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
              admin: { description: 'Everyone receives marketing until they opt out. Opted out stops it; Unknown does not.' },
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
              // Accessibility accommodation: timed quizzes and exams allow this many times the time limit.
              name: 'examTimeMultiplier',
              type: 'number',
              min: 1,
              max: 3,
              defaultValue: 1,
              label: 'Exam time (×)',
              access: { create: isAdmin, update: isAdmin },
              admin: { description: 'Extra time for timed quizzes and exams, e.g. 1.5 for half as much again. Granted by an admin.' },
            },
            {
              // Video player choices (captions on/off, caption size, speed), set from the player.
              name: 'preferences',
              type: 'json',
              admin: { readOnly: true },
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
          ],
        },
        {
          label: 'Lifecycle emails',
          fields: [
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
        },
        {
          label: 'Migration',
          fields: [
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
          ],
        },
      ],
    },
  ],
  timestamps: true,
}
