import { defineEmail, firstNameOf } from './define.js'

export interface WaitlistOpenEmailData {
  firstName: string
  /** The career they joined the waitlist for, e.g. "Ethical Hacking". */
  career: string
  /** Apply link for the newly published programme. */
  applyUrl: string
}

/**
 * "{{career}} is open": sent only when an admin presses Notify on the Career waitlist, and only
 * to applicants with marketing consent. Marketing stream, with unsubscribe links.
 */
export const waitlistOpen = defineEmail({
  id: 'waitlist-open',
  kind: 'marketing',
  track: 'W',
  stepId: 'career-waitlist',
  sample: { firstName: 'Tobi', career: 'Ethical Hacking', applyUrl: 'https://skillsair.com/apply?programme=ethical-hacking' } as WaitlistOpenEmailData,
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: '{{career}} is open at SkillsAir' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'You asked us to tell you. Here it is.' },
    greeting: { label: 'Greeting', default: 'Hi {{firstName}},' },
    intro: { label: 'Opening line', default: 'You joined the waitlist for **{{career}}** after the Career Match quiz. It’s open now, and you can apply today.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Apply for {{career}}' },
  },
  vars: (data) => ({ firstName: firstNameOf(data.firstName), career: data.career }),
  varDocs: { firstName: 'Their first name ("there" when we don’t know it)', career: 'The career they waited for' },
  subject: (_data, c) => c.subject(),
  preheader: (_data, c) => c.preheader(),
  body: (data, c) => ({ blocks: [c.greeting(), c.intro()], button: { label: c.ctaLabel(), url: data.applyUrl } }),
})
