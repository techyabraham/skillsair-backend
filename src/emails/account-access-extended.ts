import { defineEmail } from './define.js'
import { accountFooter, accountInline, accountSite, wrapAccountHtml } from './account-layout.js'

export interface AccountAccessExtendedData {
  firstName: string
  newExpiryDate: string
  daysAdded: number
  reason: string
}

/** Sent when an admin extends someone's access (the old account layout). */
export const accountAccessExtended = defineEmail({
  id: 'account-access-extended',
  kind: 'transactional',
  track: 'T',
  stepId: 'account_access_extended',
  sample: { firstName: 'Tobi', newExpiryDate: '19 January 2027', daysAdded: 14, reason: 'Extra time after a power outage' } as AccountAccessExtendedData,
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your SkillsAir access has been extended' },
    greeting: { label: 'Greeting', default: 'Hi {{firstName}},' },
    extended: { label: 'How long', default: 'Your access has been extended by **{{daysAdded}} days**.', required: ['daysAdded'] },
    newExpiry: { label: 'New expiry', default: 'New expiry: **{{newExpiryDate}}**', required: ['newExpiryDate'] },
    reason: { label: 'Reason', default: 'Reason: {{reason}}' },
    text: {
      label: 'Plain-text version',
      default: 'Hi {{firstName}}, your access has been extended by {{daysAdded}} days. New expiry: {{newExpiryDate}}. Reason: {{reason}}',
      required: ['daysAdded', 'newExpiryDate'],
    },
  },
  vars: (data) => ({ firstName: data.firstName, newExpiryDate: data.newExpiryDate, daysAdded: data.daysAdded, reason: data.reason }),
  varDocs: { firstName: 'Their first name', newExpiryDate: 'The new expiry date', daysAdded: 'Days added, as a number', reason: 'The reason the admin gave' },
  subject: (_data, c) => c.subject(),
  preheader: () => '',
  account: (_data, c) => ({
    html: wrapAccountHtml(
      `
    <p>${accountInline(c.greeting())}</p>
    <p>${accountInline(c.extended())}</p>
    <p>${accountInline(c.newExpiry())}</p>
    <p>${accountInline(c.reason())}</p>
  `,
      accountFooter(accountSite()),
    ),
    text: c.text(),
  }),
})
