import { defineEmail, firstNameOf } from './define.js'

export interface EmailVerificationData {
  firstName: string
  verifyUrl: string
}

export const emailVerification = defineEmail<EmailVerificationData>({
  id: 'email-verification',
  kind: 'transactional',
  track: 'T',
  stepId: 'email_verification',
  sample: { firstName: 'Tobi', verifyUrl: 'https://skillsair.com/verify-email?token=sample' },
  subject: () => 'Confirm your email for SkillsAir',
  preheader: () => 'One tap, and your account is ready. The link works for 24 hours.',
  body: (data) => ({
    blocks: [`Hi ${firstNameOf(data.firstName)},`, 'Please confirm this is your email address, so we can send your receipts and course updates here.'],
    button: { label: 'Confirm my email', url: data.verifyUrl },
  }),
})
