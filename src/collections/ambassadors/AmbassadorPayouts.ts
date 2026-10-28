import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../../admin/studio-config.js'
import { adminOnly, adminOnlyField, koboAtLeast, nobody } from './shared.js'

/** Withdrawal requests. Written only by server code (overrideAccess), never through Payload's API. */
export const AmbassadorPayouts: CollectionConfig = {
  slug: 'ambassador-payouts',
  labels: { singular: 'Payout', plural: 'Payouts' },
  admin: {
    group: STUDIO_GROUP.ambassadors,
    useAsTitle: 'reference',
    defaultColumns: ['reference', 'ambassador', 'amountKobo', 'status', 'accountLast4', 'createdAt'],
  },
  access: { read: adminOnly, create: nobody, update: nobody, delete: nobody },
  fields: [
    { name: 'ambassador', type: 'relationship', relationTo: 'ambassadors', required: true, index: true },
    { name: 'amountKobo', type: 'number', required: true, validate: koboAtLeast(1, true) },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'requested',
      index: true,
      options: [
        { label: 'Requested', value: 'requested' },
        { label: 'Approved', value: 'approved' },
        { label: 'Processing', value: 'processing' },
        { label: 'Success', value: 'success' },
        { label: 'Failed', value: 'failed' },
        { label: 'Rejected', value: 'rejected' },
      ],
    },
    { name: 'bankAccount', type: 'relationship', relationTo: 'ambassador-bank-accounts' },
    // Snapshots taken when the payout was requested.
    { name: 'bankName', type: 'text', maxLength: 200 },
    { name: 'accountName', type: 'text', maxLength: 200 },
    { name: 'accountLast4', type: 'text', maxLength: 4 },
    { name: 'recipientCode', type: 'text', maxLength: 100 },
    { name: 'reference', type: 'text', unique: true, maxLength: 100, admin: { description: 'Paystack transfer reference (amb_...).' } },
    { name: 'requestId', type: 'text', unique: true, maxLength: 200, admin: { description: 'The Idempotency-Key the portal sent.' } },
    { name: 'paystackTransferCode', type: 'text', maxLength: 100 },
    { name: 'failureReason', type: 'text', maxLength: 500 },
    { name: 'reviewedBy', type: 'relationship', relationTo: 'users' },
    { name: 'reviewedAt', type: 'date' },
    { name: 'processedAt', type: 'date' },
    { name: 'providerPayload', type: 'json', access: { read: adminOnlyField } },
  ],
  timestamps: true,
}
