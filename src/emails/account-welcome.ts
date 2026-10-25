import { defineEmail } from './define.js'
import { accountButton, accountFooter, accountInline, accountSite, wrapAccountHtml } from './account-layout.js'

export interface AccountWelcomeData {
  firstName: string
}

/** Sent when an account is created (the old account layout). */
export const accountWelcome = defineEmail({
  id: 'account-welcome',
  kind: 'transactional',
  track: 'T',
  stepId: 'account_welcome',
  sample: { firstName: 'Tobi' } as AccountWelcomeData,
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Welcome to SkillsAir, {{firstName}}!' },
    greeting: { label: 'Greeting', default: 'Hi {{firstName}},' },
    created: { label: 'Opening line', default: "Your SkillsAir account has been created. We're glad to have you with us." },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Go to your dashboard' },
    textSummary: { label: 'Plain-text version (the button and link follow)', default: 'Hi {{firstName}}, your SkillsAir account has been created.' },
  },
  vars: (data) => ({ firstName: data.firstName }),
  varDocs: { firstName: 'Their first name' },
  subject: (_data, c) => c.subject(),
  preheader: () => '',
  account: (_data, c) => {
    const url = `${accountSite()}/dashboard`
    return {
      html: wrapAccountHtml(
        `
    <p>${accountInline(c.greeting())}</p>
    <p>${accountInline(c.created())}</p>
    ${accountButton(c.ctaLabel(), url)}
  `,
        accountFooter(accountSite()),
      ),
      text: `${c.textSummary()} ${c.ctaLabel()}: ${url}`,
    }
  },
})
