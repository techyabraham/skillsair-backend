import { defineEmail, firstNameOf } from './define.js'

export interface EmailVerificationData {
  firstName: string
  verifyUrl: string
}

export const emailVerification = defineEmail({
  id: 'email-verification',
  kind: 'transactional',
  track: 'T',
  stepId: 'email_verification',
  sample: { firstName: 'Tobi', verifyUrl: 'https://skillsair.com/verify-email?token=sample' } as EmailVerificationData,
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Confirm your email for SkillsAir' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'One tap, and your account is ready. The link works for 24 hours.' },
    greeting: { label: 'Greeting', default: 'Hi {{firstName}},' },
    intro: { label: 'Opening line', default: 'Please confirm this is your email address, so we can send your receipts and course updates here.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Confirm my email' },
  },
  vars: (data) => ({ firstName: firstNameOf(data.firstName) }),
  varDocs: { firstName: 'Their first name ("there" when we don’t know it)' },
  subject: (_data, c) => c.subject(),
  preheader: (_data, c) => c.preheader(),
  body: (data, c) => ({
    blocks: [c.greeting(), c.intro()],
    button: { label: c.ctaLabel(), url: data.verifyUrl },
  }),
})
