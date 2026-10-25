import { defineEmail, firstNameOf } from './define.js'

export interface PasswordResetData {
  firstName: string
  resetUrl: string
}

/** Account email. Still sent to suppressed addresses, because the person asked for it. */
export const passwordReset = defineEmail({
  id: 'password-reset',
  kind: 'transactional',
  track: 'T',
  stepId: 'password_reset',
  sample: { firstName: 'Tobi', resetUrl: 'https://skillsair.com/reset-password?token=sample' } as PasswordResetData,
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Reset your SkillsAir password' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'This link works for 1 hour.' },
    greeting: { label: 'Greeting', default: 'Hi {{firstName}},' },
    intro: { label: 'Opening line', default: 'We received a request to reset your SkillsAir password. Use the button below within 1 hour.' },
    ignore: { label: 'If they didn’t ask', default: "If you didn't ask for this, you can ignore this email. Your password won't change." },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Reset my password' },
  },
  vars: (data) => ({ firstName: firstNameOf(data.firstName) }),
  varDocs: { firstName: 'Their first name ("there" when we don’t know it)' },
  subject: (_data, c) => c.subject(),
  preheader: (_data, c) => c.preheader(),
  body: (data, c) => ({
    blocks: [c.greeting(), c.intro(), c.ignore()],
    button: { label: c.ctaLabel(), url: data.resetUrl },
  }),
})
