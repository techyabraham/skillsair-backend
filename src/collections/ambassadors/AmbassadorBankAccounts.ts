import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../../admin/studio-config.js'
import { decryptField, encryptField } from '../../utils/sanitize.js'
import { adminOnly, adminOnlyField, encryptedAccountNumber, matches } from './shared.js'

export const AmbassadorBankAccounts: CollectionConfig = {
  slug: 'ambassador-bank-accounts',
  labels: { singular: 'Bank account', plural: 'Bank accounts' },
  admin: {
    group: STUDIO_GROUP.ambassadors,
    useAsTitle: 'accountName',
    defaultColumns: ['ambassador', 'bankName', 'accountName', 'accountLast4', 'isCurrent', 'holdUntil'],
  },
  access: { read: adminOnly, create: adminOnly, update: adminOnly, delete: adminOnly },
  fields: [
    { name: 'ambassador', type: 'relationship', relationTo: 'ambassadors', required: true, index: true },
    { name: 'bankCode', type: 'text', required: true, maxLength: 20 },
    { name: 'bankName', type: 'text', required: true, maxLength: 200 },
    {
      name: 'accountName',
      type: 'text',
      required: true,
      maxLength: 200,
      admin: { description: 'Exactly as Paystack returned it when the account was resolved.' },
    },
    {
      // Encrypted at rest. Never shown in Studio lists or forms: revealing it is an audited action.
      name: 'accountNumber',
      type: 'text',
      required: true,
      validate: encryptedAccountNumber,
      access: { read: adminOnlyField },
      admin: { hidden: true, disableListColumn: true, disableListFilter: true },
      hooks: {
        beforeChange: [({ value }) => (value ? encryptField(String(value)) : value)],
        afterRead: [
          ({ value }) => {
            if (!value || typeof value !== 'string') return value
            try {
              return decryptField(value)
            } catch {
              return value
            }
          },
        ],
      },
    },
    {
      name: 'accountLast4',
      type: 'text',
      required: true,
      label: 'Account (last 4)',
      validate: matches(/^\d{4}$/, 'Last 4 digits of the account number', true),
    },
    { name: 'resolvedAt', type: 'date', required: true },
    { name: 'paystackRecipientCode', type: 'text', maxLength: 100 },
    { name: 'isCurrent', type: 'checkbox', defaultValue: false, admin: { description: 'At most one current account per ambassador (enforced by the service).' } },
    { name: 'holdUntil', type: 'date', admin: { description: 'Withdrawals to a replacement account wait until this time.' } },
  ],
  timestamps: true,
}
