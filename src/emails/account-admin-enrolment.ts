import { defineEmail } from './define.js'
import { accountButton, accountFooter, accountInline, accountSite, wrapAccountHtml } from './account-layout.js'

export interface AccountAdminEnrolmentData {
  firstName: string
  courseName: string
  courseUrl: string
  endsOn: string
  extended: boolean
  /** Only for someone who has never signed in: where they choose a password. */
  setPasswordUrl: string
}

/** Sent when an admin enrols someone from Studio or adds time to their access (the old account layout). */
export const accountAdminEnrolment = defineEmail({
  id: 'account-admin-enrolment',
  kind: 'transactional',
  track: 'T',
  stepId: 'account_admin_enrolment',
  sample: { firstName: 'Tobi', courseName: 'Data Analysis', courseUrl: 'https://skillsair.com/dashboard/courses/data-analysis/learn', endsOn: '19 January 2027', extended: false, setPasswordUrl: 'https://skillsair.com/reset-password?token=sample' } as AccountAdminEnrolmentData,
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'You have access to {{courseName}}' },
    greeting: { label: 'Greeting', default: 'Hi {{firstName}},' },
    enrolled: { label: 'Opening line (new enrolment)', default: "You've been enrolled in **{{courseName}}**. Your access runs until **{{endsOn}}**.", required: ['endsOn'] },
    extended: { label: 'Opening line (more time added)', default: 'Your access to **{{courseName}}** now runs until **{{endsOn}}**.', required: ['endsOn'] },
    setPassword: { label: 'First sign-in', default: 'Choose a password to sign in. This link works for 14 days; after that, use "Forgot password" on the sign-in page.' },
    passwordCta: { label: 'Button (first sign-in)', kind: 'button', default: 'Set your password' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Start learning' },
    textSummary: { label: 'Plain-text version (the button and link follow)', default: 'Hi {{firstName}}, you have access to {{courseName}} until {{endsOn}}.', required: ['endsOn'] },
  },
  vars: (data) => ({ firstName: data.firstName, courseName: data.courseName, endsOn: data.endsOn }),
  varDocs: { firstName: 'Their first name', courseName: 'The programme', endsOn: 'The day their access ends' },
  subject: (_data, c) => c.subject(),
  preheader: () => '',
  account: (data, c) => ({
    html: wrapAccountHtml(
      `
    <p>${accountInline(c.greeting())}</p>
    <p>${accountInline(data.extended ? c.extended() : c.enrolled())}</p>
    ${data.setPasswordUrl ? `<p>${accountInline(c.setPassword())}</p>${accountButton(c.passwordCta(), data.setPasswordUrl)}` : accountButton(c.ctaLabel(), data.courseUrl)}
  `,
      accountFooter(accountSite()),
    ),
    text: data.setPasswordUrl ? `${c.textSummary()} ${c.setPassword()} ${c.passwordCta()}: ${data.setPasswordUrl}` : `${c.textSummary()} ${c.ctaLabel()}: ${data.courseUrl}`,
  }),
})
