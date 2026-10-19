import { defineEmail, firstNameOf } from './define.js'

export interface PasswordResetData {
  firstName: string
  resetUrl: string
}

/** Account email. Still sent to suppressed addresses, because the person asked for it. */
export const passwordReset = defineEmail<PasswordResetData>({
  id: 'password-reset',
  kind: 'transactional',
  track: 'T',
  stepId: 'password_reset',
  sample: { firstName: 'Tobi', resetUrl: 'https://skillsair.com/reset-password?token=sample' },
  subject: () => 'Reset your SkillsAir password',
  preheader: () => 'This link works for 1 hour.',
  body: (data) => ({
    blocks: [
      `Hi ${firstNameOf(data.firstName)},`,
      'We received a request to reset your SkillsAir password. Use the button below within 1 hour.',
      "If you didn't ask for this, you can ignore this email. Your password won't change.",
    ],
    button: { label: 'Reset my password', url: data.resetUrl },
  }),
})
