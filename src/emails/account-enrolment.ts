import { defineEmail } from './define.js'
import { accountButton, accountFooter, accountInline, accountSite, wrapAccountHtml } from './account-layout.js'

export interface AccountEnrolmentData {
  firstName: string
  courseName: string
  courseUrl: string
}

/** Sent when someone is enrolled on a programme (the old account layout). */
export const accountEnrolment = defineEmail({
  id: 'account-enrolment',
  kind: 'transactional',
  track: 'T',
  stepId: 'account_enrolment',
  sample: { firstName: 'Tobi', courseName: 'Data Analysis', courseUrl: 'https://skillsair.com/dashboard/courses/data-analysis/learn' } as AccountEnrolmentData,
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'You are enrolled in {{courseName}}' },
    greeting: { label: 'Greeting', default: 'Hi {{firstName}},' },
    enrolled: { label: 'Opening line', default: "You're now enrolled in **{{courseName}}**. Start learning whenever you're ready." },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Start learning' },
    textSummary: { label: 'Plain-text version (the button and link follow)', default: 'Hi {{firstName}}, you are enrolled in {{courseName}}.' },
  },
  vars: (data) => ({ firstName: data.firstName, courseName: data.courseName }),
  varDocs: { firstName: 'Their first name', courseName: 'The programme they’re enrolled on' },
  subject: (_data, c) => c.subject(),
  preheader: () => '',
  account: (data, c) => ({
    html: wrapAccountHtml(
      `
    <p>${accountInline(c.greeting())}</p>
    <p>${accountInline(c.enrolled())}</p>
    ${accountButton(c.ctaLabel(), data.courseUrl)}
  `,
      accountFooter(accountSite()),
    ),
    text: `${c.textSummary()} ${c.ctaLabel()}: ${data.courseUrl}`,
  }),
})
