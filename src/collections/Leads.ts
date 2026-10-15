import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { decryptField, encryptField, isValidE164Phone, validateEncryptedE164 } from '../utils/sanitize.js'
import { generateResumeCode, hashPhone } from '../lib/leads.js'
import { createLeadEndpoint } from '../endpoints/leads/create.js'
import { getMyLeadEndpoint, updateMyLeadEndpoint } from '../endpoints/leads/me.js'
import { resumeLeadEndpoint } from '../endpoints/leads/resume.js'
import { leadDoneEndpoint, leadUnsubscribeEndpoint, leadWhatsAppReplyEndpoint } from '../endpoints/leads/admin-actions.js'

const isAdmin = ({ req }: { req: { user?: unknown } }) =>
  (req.user as { role?: string } | null | undefined)?.role === 'admin'

const prepareLead: CollectionBeforeValidateHook = ({ data, operation }) => {
  if (!data) return data
  if (typeof data.email === 'string') data.email = data.email.trim().toLowerCase()
  // Hash the plaintext number before the field hook encrypts it.
  if (typeof data.phone === 'string' && isValidE164Phone(data.phone)) data.phoneHash = hashPhone(data.phone)
  if (operation === 'create' && !data.resumeCode) data.resumeCode = generateResumeCode()
  return data
}

export const Leads: CollectionConfig = {
  slug: 'leads',
  admin: {
    group: 'People',
    useAsTitle: 'firstName',
    defaultColumns: ['firstName', 'course', 'score', 'needsHuman', 'status', 'createdAt'],
    listSearchableFields: ['firstName', 'email'],
    description:
      "Applicants captured by the Apply flow. Imisi's queue: filter Needs human = true and sort by Score (highest first).",
  },
  defaultSort: '-score',
  // Public lead endpoints (POST /api/leads, GET/PATCH /api/leads/me, GET /api/leads/resume/:code).
  // Collection endpoints are matched before Payload's default REST routes for this slug.
  endpoints: [
    createLeadEndpoint,
    getMyLeadEndpoint,
    updateMyLeadEndpoint,
    resumeLeadEndpoint,
    leadUnsubscribeEndpoint,
    leadWhatsAppReplyEndpoint,
    leadDoneEndpoint,
  ],
  access: {
    // Leads are only created through the validated public endpoint (which uses overrideAccess).
    read: isAdmin,
    create: () => false,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    beforeValidate: [prepareLead],
  },
  fields: [
    {
      name: 'queueActions',
      type: 'ui',
      admin: { components: { Field: '/src/admin/LeadQueueActions#LeadQueueActions' } },
    },
    {
      type: 'row',
      fields: [
        { name: 'firstName', type: 'text', required: true, maxLength: 100 },
        { name: 'email', type: 'email', required: true, unique: true, index: true },
      ],
    },
    {
      name: 'phone',
      type: 'text',
      required: true,
      validate: (value: unknown) => validateEncryptedE164(value, { required: true }),
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
    { name: 'phoneHash', type: 'text', index: true, admin: { readOnly: true, hidden: true } },
    {
      type: 'collapsible',
      label: 'Interest',
      fields: [
        { name: 'school', type: 'relationship', relationTo: 'categories' },
        { name: 'course', type: 'relationship', relationTo: 'courses' },
        {
          name: 'currentStatus',
          type: 'select',
          options: [
            { label: 'Student', value: 'student' },
            { label: 'Graduate or NYSC', value: 'graduate_nysc' },
            { label: 'Working, want to switch', value: 'working_switch' },
            { label: 'Not working', value: 'not_working' },
          ],
        },
        {
          name: 'device',
          type: 'select',
          options: [
            { label: 'Laptop', value: 'laptop' },
            { label: 'Phone only for now', value: 'phone_only' },
            { label: 'Both', value: 'both' },
          ],
        },
        {
          name: 'weeklyHours',
          type: 'select',
          options: [
            { label: 'Under 5 hours', value: 'under_5' },
            { label: '5–8 hours', value: '5_8' },
            { label: '8+ hours', value: '8_plus' },
          ],
        },
        { name: 'message', type: 'textarea', maxLength: 2000 },
      ],
    },
    {
      type: 'collapsible',
      label: 'Source',
      fields: [
        {
          name: 'source',
          type: 'select',
          required: true,
          defaultValue: 'apply',
          options: [
            { label: 'Apply', value: 'apply' },
            { label: 'Quiz', value: 'quiz' },
            { label: 'Curriculum request', value: 'curriculum_request' },
            { label: 'Contact', value: 'contact' },
            { label: 'Employer', value: 'employer' },
            { label: 'Other', value: 'other' },
          ],
        },
        {
          name: 'utm',
          type: 'group',
          fields: [
            { name: 'source', type: 'text' },
            { name: 'medium', type: 'text' },
            { name: 'campaign', type: 'text' },
            { name: 'content', type: 'text' },
            { name: 'term', type: 'text' },
          ],
        },
        { name: 'referrer', type: 'text' },
        { name: 'landingPath', type: 'text' },
      ],
    },
    {
      type: 'collapsible',
      label: 'Consent',
      fields: [
        { name: 'marketingConsent', type: 'checkbox', defaultValue: false },
        { name: 'marketingConsentAt', type: 'date' },
        {
          name: 'marketingConsentText',
          type: 'textarea',
          admin: { description: 'The exact wording the person agreed to.' },
        },
        { name: 'optedOutAt', type: 'date' },
      ],
    },
    {
      type: 'collapsible',
      label: 'Lifecycle',
      fields: [
        {
          name: 'status',
          type: 'select',
          required: true,
          defaultValue: 'new',
          options: [
            { label: 'New', value: 'new' },
            { label: 'Contacted', value: 'contacted' },
            { label: 'Offer viewed', value: 'offer_viewed' },
            { label: 'Account created', value: 'account_created' },
            { label: 'Paid', value: 'paid' },
            { label: 'Lost', value: 'lost' },
          ],
        },
        { name: 'waitlist', type: 'checkbox', defaultValue: false },
        { name: 'score', type: 'number', defaultValue: 0, min: 0, max: 100, index: true },
        { name: 'needsHuman', type: 'checkbox', defaultValue: false, index: true },
        { name: 'lastEventAt', type: 'date' },
        { name: 'offerViewCount', type: 'number', defaultValue: 0 },
        {
          name: 'resumeCode',
          type: 'text',
          unique: true,
          index: true,
          admin: { readOnly: true, description: 'Powers https://skillsair.com/r/<code>.' },
        },
      ],
    },
    {
      type: 'collapsible',
      label: 'WhatsApp',
      admin: { initCollapsed: true },
      fields: [
        { name: 'lastInboundAt', type: 'date', admin: { description: 'Opens the 24-hour customer-service window.' } },
        {
          name: 'whatsappLog',
          type: 'array',
          admin: { readOnly: true, description: 'The last 50 messages.' },
          fields: [
            {
              name: 'direction',
              type: 'select',
              required: true,
              options: [
                { label: 'Inbound', value: 'in' },
                { label: 'Outbound', value: 'out' },
              ],
            },
            { name: 'type', type: 'text', required: true },
            { name: 'template', type: 'text' },
            { name: 'body', type: 'textarea' },
            { name: 'at', type: 'date', required: true },
          ],
        },
        {
          name: 'followUpsSent',
          type: 'array',
          admin: { readOnly: true },
          fields: [
            { name: 'key', type: 'text', required: true },
            { name: 'sentAt', type: 'date', required: true },
          ],
        },
      ],
    },
    { name: 'user', type: 'relationship', relationTo: 'users' },
    { name: 'notes', type: 'textarea' },
  ],
  timestamps: true,
}
