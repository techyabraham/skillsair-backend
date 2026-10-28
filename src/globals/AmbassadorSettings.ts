import type { GlobalConfig } from 'payload'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { adminOnly, integerBetween, koboAtLeast, rateBps } from '../collections/ambassadors/shared.js'
import { AMBASSADOR_SETTINGS_DEFAULTS, clearAmbassadorSettingsCache } from '../lib/ambassadors/settings.js'

/**
 * Ambassador programme settings (AMBASSADORS.md section 4). Read through getAmbassadorSettings()
 * in src/lib/ambassadors/settings.ts, which applies the same defaults to any empty field.
 */
const D = AMBASSADOR_SETTINGS_DEFAULTS

export const AmbassadorSettings: GlobalConfig = {
  slug: 'ambassador-settings',
  label: 'Ambassador settings',
  admin: { group: STUDIO_GROUP.ambassadors },
  access: { read: adminOnly, update: adminOnly },
  hooks: { afterChange: [() => clearAmbassadorSettingsCache()] },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'programOpen', type: 'checkbox', defaultValue: D.programOpen, label: 'Applications are open' },
        {
          name: 'defaultApplicationStatus',
          type: 'select',
          defaultValue: D.defaultApplicationStatus,
          options: [
            { label: 'Pending (an admin approves each application)', value: 'pending' },
            { label: 'Active (verifying the email activates)', value: 'active' },
          ],
        },
      ],
    },
    {
      name: 'commissionRateBps',
      type: 'number',
      defaultValue: D.commissionRateBps,
      label: 'Commission rate (basis points)',
      validate: rateBps,
      admin: { description: 'Applies to new commissions only. 5000 = 50%.' },
    },
    {
      name: 'commissionableTypes',
      type: 'select',
      hasMany: true,
      defaultValue: [...D.commissionableTypes],
      options: [
        { label: 'Course purchases', value: 'course' },
        { label: 'First subscription payment', value: 'subscription' },
        { label: 'Subscription renewals', value: 'renewal' },
        { label: 'Certificates', value: 'certificate' },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'approvalDelayDays', type: 'number', defaultValue: D.approvalDelayDays, validate: integerBetween(0, 60), admin: { description: 'Days before a commission can be withdrawn.' } },
        { name: 'cookieDays', type: 'number', defaultValue: D.cookieDays, validate: integerBetween(1, 365), admin: { description: 'How long the browser keeps a referral.' } },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'attributionModel',
          type: 'select',
          defaultValue: D.attributionModel,
          options: [
            { label: 'First click wins', value: 'first_click' },
            { label: 'Last click wins', value: 'last_click' },
          ],
        },
        {
          name: 'attributionLifetimeDays',
          type: 'number',
          validate: integerBetween(1, 36_500),
          admin: { description: 'Empty: once attributed, a learner stays with their ambassador for good.' },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'minPayoutKobo', type: 'number', defaultValue: D.minPayoutKobo, validate: koboAtLeast(0, false), admin: { description: 'Kobo. 500000 = ₦5,000.' } },
        { name: 'payoutsEnabled', type: 'checkbox', defaultValue: D.payoutsEnabled },
        {
          name: 'payoutMode',
          type: 'select',
          defaultValue: D.payoutMode,
          options: [
            { label: 'Manual review (an admin approves each payout)', value: 'manual_review' },
            { label: 'Automatic (within the caps)', value: 'automatic' },
          ],
        },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'perTransferCapKobo', type: 'number', defaultValue: D.perTransferCapKobo, validate: koboAtLeast(0, false), admin: { description: 'Kobo. 20000000 = ₦200,000.' } },
        { name: 'dailyCapKobo', type: 'number', defaultValue: D.dailyCapKobo, validate: koboAtLeast(0, false), admin: { description: 'Kobo. 100000000 = ₦1,000,000.' } },
        { name: 'newBankHoldHours', type: 'number', defaultValue: D.newBankHoldHours, validate: integerBetween(0, 720), admin: { description: 'Hours a replacement bank account waits before withdrawals.' } },
      ],
    },
    { name: 'showReferredEmails', type: 'checkbox', defaultValue: D.showReferredEmails, admin: { description: 'Ambassadors see the email address of people they referred.' } },
    {
      name: 'heardAboutOptions',
      type: 'array',
      defaultValue: D.heardAboutOptions.map((option) => ({ option })),
      fields: [{ name: 'option', type: 'text', required: true, maxLength: 100 }],
    },
    {
      name: 'shareMessage',
      type: 'text',
      defaultValue: D.shareMessage,
      maxLength: 500,
      admin: { description: '{link} is replaced by the ambassador’s referral link.' },
    },
  ],
}
