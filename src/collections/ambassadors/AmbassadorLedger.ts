import type { CollectionConfig } from 'payload'
import { STUDIO_GROUP } from '../../admin/studio-config.js'
import { adminOnly, koboAtLeast, nobody, rateBps, signedKobo } from './shared.js'

/**
 * Append-only money ledger (AMBASSADORS.md M4-M7). Nobody writes it through Payload's API, admins
 * included: rows are created and their status changed only by src/lib/ambassadors/ledger.ts.
 */
export const AmbassadorLedger: CollectionConfig = {
  slug: 'ambassador-ledger',
  labels: { singular: 'Ledger entry', plural: 'Ledger' },
  admin: {
    group: STUDIO_GROUP.ambassadors,
    useAsTitle: 'idempotencyKey',
    defaultColumns: ['idempotencyKey', 'ambassador', 'type', 'status', 'amountKobo', 'availableAt', 'createdAt'],
  },
  access: { read: adminOnly, create: nobody, update: nobody, delete: nobody },
  indexes: [{ fields: ['ambassador', 'type', 'status'] }],
  fields: [
    { name: 'ambassador', type: 'relationship', relationTo: 'ambassadors', required: true, index: true },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Commission', value: 'commission' },
        { label: 'Reversal', value: 'reversal' },
        { label: 'Adjustment', value: 'adjustment' },
        { label: 'Payout', value: 'payout' },
        { label: 'Payout reversal', value: 'payout_reversal' },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Void', value: 'void' },
        { label: 'Reserved', value: 'reserved' },
        { label: 'Paid', value: 'paid' },
      ],
    },
    { name: 'amountKobo', type: 'number', required: true, validate: signedKobo(true), admin: { description: 'Signed integer kobo.' } },
    { name: 'saleKobo', type: 'number', validate: koboAtLeast(0, false) },
    { name: 'rateBps', type: 'number', validate: rateBps },
    { name: 'order', type: 'relationship', relationTo: 'orders' },
    { name: 'subscription', type: 'relationship', relationTo: 'subscriptions' },
    { name: 'invoiceCode', type: 'text', maxLength: 100 },
    { name: 'payout', type: 'relationship', relationTo: 'ambassador-payouts' },
    { name: 'referredUser', type: 'relationship', relationTo: 'users' },
    {
      name: 'productType',
      type: 'select',
      options: [
        { label: 'Course', value: 'course' },
        { label: 'Subscription', value: 'subscription' },
        { label: 'Renewal', value: 'renewal' },
        { label: 'Certificate', value: 'certificate' },
        { label: 'None', value: 'none' },
      ],
    },
    { name: 'productTitle', type: 'text', maxLength: 300 },
    { name: 'availableAt', type: 'date', index: true },
    { name: 'idempotencyKey', type: 'text', required: true, unique: true, maxLength: 200 },
    { name: 'note', type: 'text', maxLength: 500 },
    { name: 'createdBy', type: 'relationship', relationTo: 'users' },
  ],
  timestamps: true,
}
