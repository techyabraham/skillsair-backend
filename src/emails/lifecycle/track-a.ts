import { lines } from '../define.js'
import { blocks, designed, greeting, lifecycleEmail, monthly, proofSlot, standardFee } from './shared.js'

/** Track A: before the first payment, while a scholarship window is open (Soap Opera Sequence). */

export const A0 = lifecycleEmail({
  id: 'A0',
  kind: 'transactional',
  track: 'A',
  stepId: 'A0',
  copy: {
    subject: { label: 'Subject (window open)', kind: 'subject', default: '{{firstName}}, your scholarship offer is ready' },
    subjectClosed: { label: 'Subject (window closed)', kind: 'subject', default: '{{firstName}}, your SkillsAir offer' },
    variant1Subject: { label: 'A/B subject B (window open)', kind: 'subject', default: 'You qualify, {{firstName}}: {{programme}}' },
    variant1SubjectClosed: { label: 'A/B subject B (window closed)', kind: 'subject', default: '{{programme}}: your next step' },
    preheader: { label: 'Preview text (window open)', kind: 'preheader', default: '{{monthly}} for {{programme}} instead of {{standardPrice}}. Closes {{closesOn}}.' },
    preheaderClosed: { label: 'Preview text (window closed)', kind: 'preheader', default: '{{programme}}, and how to hear first when the scholarship reopens.' },
    variant1Preheader: { label: 'A/B preview text B (window open)', kind: 'preheader', default: '{{monthly}} with your Access Scholarship. Closes {{closesOn}}.' },
    variant1PreheaderClosed: { label: 'A/B preview text B (window closed)', kind: 'preheader', default: 'Your offer, and how to hear first when the scholarship reopens.' },
    intro: { label: 'Opening line (window open)', default: "It's Imisi from SkillsAir. Good news: you qualify for the Access Scholarship on {{programme}}." },
    rowStandardFee: { label: 'Price table: standard fee label', default: 'Standard fee' },
    rowScholarship: { label: 'Price table: scholarship label', default: 'With your Access Scholarship' },
    rowCertificate: { label: 'Price table: certificate label', default: 'Certificate (when you finish)' },
    rowCertificateValue: { label: 'Price table: certificate value', default: 'Optional, paid separately; needed for internship access' },
    priceCaption: {
      label: 'Under the price table',
      default: 'Billed monthly by Paystack until you finish. {{designed}}. Cancel anytime from your dashboard.',
      vars: { designed: 'How long a programme takes (the shared phrase, with a capital letter)' },
    },
    whatYouGet: { label: 'List heading', default: 'What you get:' },
    getList: {
      label: 'What you get (one item per line)',
      kind: 'list',
      default: [
        'The full {{programme}} programme, with a guided 12-week plan and weekly goals, for as long as you study',
        'When you finish: a verifiable certificate employers can check online (optional, paid separately)',
        'Free bonus courses: CV & LinkedIn, and Freelancing',
        "Access to internship openings from our partner firms once you're certified",
        'Certified graduates can apply for laptop support (2 laptops per cohort)',
      ].join('\n'),
    },
    tryFirst: { label: 'Refund promise', default: "Try it first: complete at least one chapter or 5 lessons, and if it's not for you, ask for a refund within 24 hours of paying." },
    closes: { label: 'Deadline', default: 'The scholarship closes on {{closesOn}} at 11:59pm. Join before then and your {{monthly}} rate stays locked until you finish.' },
    introClosed: { label: 'Opening line (window closed)', default: "It's Imisi from SkillsAir. Thanks for applying for {{programme}}." },
    closedFee: {
      label: 'Standard fee (window closed)',
      default: 'The Access Scholarship window is closed right now, so {{programme}} is at the standard fee: {{standardFee}}. The certificate is optional, paid separately when you finish.',
    },
    closedNext: { label: 'Next window (window closed)', default: "Scholarship windows open regularly. You're on the list, so I'll tell you the moment the next one opens." },
    ctaLabel: { label: 'Button', kind: 'button', default: 'See my offer' },
    ps: { label: 'P.S.', kind: 'ps', default: "Not sure yet? Watch a free lesson first. It's on your offer page." },
  },
  subject: (d, c) => (d.windowOpen ? c.subject() : c.subjectClosed()),
  preheader: (d, c) => (d.windowOpen ? c.preheader() : c.preheaderClosed()),
  variants: [
    {
      subject: (d, c) => (d.windowOpen ? c.variant1Subject() : c.variant1SubjectClosed()),
      preheader: (d, c) => (d.windowOpen ? c.variant1Preheader() : c.variant1PreheaderClosed()),
    },
  ],
  body: (d, c) => {
    const phrase = designed(d)
    return d.windowOpen
      ? {
          blocks: blocks([
            greeting(d),
            c.intro(),
            {
              rows: [
                { label: c.rowStandardFee(), value: standardFee(d), struck: true },
                { label: c.rowScholarship(), value: monthly(d), strong: true },
                { label: c.rowCertificate(), value: c.rowCertificateValue() },
              ],
              caption: c.priceCaption({ designed: phrase ? `${phrase[0]!.toUpperCase()}${phrase.slice(1)}` : '' }),
            },
            c.whatYouGet(),
            { list: lines(c.getList()) },
            c.tryFirst(),
            c.closes(),
          ]),
          button: { label: c.ctaLabel(), url: d.offerUrl },
          ps: c.ps(),
        }
      : {
          blocks: blocks([greeting(d), c.introClosed(), c.closedFee(), c.closedNext()]),
          button: { label: c.ctaLabel(), url: d.offerUrl },
          ps: c.ps(),
        }
  },
})

export const A1 = lifecycleEmail({
  id: 'A1',
  kind: 'marketing',
  track: 'A',
  stepId: 'A1',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Two questions everyone asks me' },
    variant1Subject: { label: 'A/B subject B', kind: 'subject', default: 'Is {{monthly}} too good to be true?' },
    preheader: { label: 'Preview text', kind: 'preheader', default: '"Why only {{monthly}}?" and "Can I do it on my phone?"' },
    variant1Preheader: { label: 'A/B preview text B', kind: 'preheader', default: 'Straight answers to the two questions everyone asks.' },
    intro: {
      label: 'Opening line',
      default: "Imisi here again. I'm the person who answers when you message SkillsAir on WhatsApp, so you'll hear from me now and then over the next few days. I'll keep it short and useful, promise.",
    },
    setup: { label: 'Before the questions', default: 'Almost everyone who applies asks me the same two things. Here are straight answers.' },
    question1: { label: 'Question 1', default: '**1. "Why only {{monthly}}? What\'s the catch?"**' },
    answer1: {
      label: 'Answer 1',
      default: "No catch. During a scholarship window, the Access Scholarship covers most of the standard fee. You pay {{monthly}} while you study, and you can cancel anytime. When you finish, there's an optional certificate, paid separately. That's all.",
    },
    question2: { label: 'Question 2', default: '**2. "Can I do it on my phone?"**' },
    answerPhone: { label: 'Answer 2 (works on a phone)', default: 'It depends on the programme. Good news: {{programme}} works fully on a phone.' },
    answerLaptop: {
      label: 'Answer 2 (needs a laptop)',
      default: 'It depends on the programme. {{programme}} needs a laptop for some of the work. If you only have a phone right now, these work fully on a phone: {{phoneFriendlyList}}.',
    },
    tomorrow: { label: 'Teaser for tomorrow', default: "Tomorrow I'll tell you why Abraham, our founder, decided to make this so affordable in the first place. It's not the reason most people guess." },
    ctaLabel: { label: 'Button', kind: 'button', default: 'See my offer' },
    ps: { label: 'P.S.', kind: 'ps', default: 'Got a different question? Just reply. I read every one.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  variants: [{ subject: (_d, c) => c.variant1Subject(), preheader: (_d, c) => c.variant1Preheader() }],
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.intro(),
      c.setup(),
      c.question1(),
      c.answer1(),
      c.question2(),
      d.phoneFriendly ? c.answerPhone() : c.answerLaptop(),
      c.tomorrow(),
    ]),
    button: { label: c.ctaLabel(), url: d.offerUrl },
    ps: c.ps(),
  }),
})

export const A2 = lifecycleEmail({
  id: 'A2',
  kind: 'marketing',
  track: 'A',
  stepId: 'A2',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Why we made it {{monthly}}' },
    preheader: { label: 'Preview text', kind: 'preheader', default: "Talent isn't the problem. Access is." },
    intro: { label: 'Opening line', default: 'Yesterday I promised you the real reason SkillsAir costs so little.' },
    story1: { label: 'Story: the founder', default: 'Abraham Akinwumi started SkillsAir because he kept seeing two problems side by side.' },
    story2: { label: 'Story: the first problem', default: 'On one side: talented young Africans who wanted to get into tech, but every good programme was either too expensive or too shallow to get anyone hired.' },
    story3: { label: 'Story: the second problem', default: "On the other side: companies who couldn't find enough skilled people to hire." },
    story4: { label: 'Story: after the founder’s memory', default: "Same country, same cities, sometimes the same street. The gap wasn't talent. It was access." },
    mission: {
      label: 'What SkillsAir does about it',
      default: "So he built SkillsAir to close it: job-ready training that young people can actually afford, with a path to internships once they're certified. The Access Scholarship is how that works in practice. For people who join during a window, it covers most of the fee, and the {{monthly}} stays the same until you finish.",
    },
    nextStep: { label: 'Closing line', default: "You applied for {{programme}}. That's the hard part done. The next step is just to start." },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Start for {{monthly}}' },
    ps: { label: 'P.S.', kind: 'ps', default: 'The only other cost is an optional certificate, paid separately when you finish and only if you want it. No other fees.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), c.story1(), c.story2(), c.story3(), d.founderAnecdote, c.story4(), c.mission(), proofSlot(d), c.nextStep()]),
    button: { label: c.ctaLabel(), url: d.offerUrl },
    ps: c.ps(),
  }),
})

export const A3 = lifecycleEmail({
  id: 'A3',
  kind: 'marketing',
  track: 'A',
  stepId: 'A3',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'What a {{role}} actually does all day' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'And why you don\'t need to feel "ready" to start.' },
    ready: {
      label: 'Nobody starts out ready',
      default: "Here's the thing most people miss. Nobody starts out feeling ready. The people doing this work today didn't wait until they were confident. They learned one skill, then the next, and the confidence came from doing it.",
    },
    built: { label: 'How the programme is built', default: "That's how {{programme}} is built. You start from the basics and follow a guided 12-week plan with weekly goals, about 8 hours a week." },
    closing: { label: 'Closing line', default: 'If you can give it 8 hours a week, you can do this.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'See my offer' },
    ps: { label: 'P.S.', kind: 'ps', default: 'Your scholarship price is {{monthly}} until {{closesOn}}. The certificate is optional, paid separately when you finish.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), d.careerExplainer, c.ready(), c.built(), c.closing()]),
    button: { label: c.ctaLabel(), url: d.offerUrl },
    ps: c.ps(),
  }),
})

export const A4 = lifecycleEmail({
  id: 'A4',
  kind: 'marketing',
  track: 'A',
  stepId: 'A4',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: '5 things people miss in your offer' },
    preheader: { label: 'Preview text', kind: 'preheader', default: "Number 3 matters most if you're worried about money." },
    intro: { label: 'Opening line', default: 'When people read their offer, they see "{{monthly}}" and stop there. Here\'s what else is in it.' },
    thingsList: {
      label: 'The 5 things (one per line)',
      kind: 'list',
      default: [
        '**Two free courses.** CV & LinkedIn, and Freelancing, so you can show your skills and start earning from them.',
        "**A certificate employers can check.** When you finish, your certificate has its own link. An employer clicks it and sees it's real.",
        "**Your price is locked.** Join during the scholarship and you pay {{monthly}} until you finish, even after the window closes. If you take a break and come back, it's still {{monthly}}.",
        "**Internship access.** Certified graduates get access to internship openings from our partner firms. The network is new and growing, so I won't overpromise, but the door is there.",
        '**Laptop support.** Each cohort, 2 laptops go to certified graduates who need one most. You apply with your story.',
      ].join('\n'),
    },
    tryFirst: { label: 'Refund promise', default: "And one more: try it first. Complete a chapter or 5 lessons. If it's not for you, ask for a refund within 24 hours of paying." },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Start for {{monthly}}' },
    ps: { label: 'P.S.', kind: 'ps', default: '{{monthly}} is about ₦67 a day. Less than you spend on data.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), { ordered: true, list: lines(c.thingsList()) }, c.tryFirst(), proofSlot(d)]),
    button: { label: c.ctaLabel(), url: d.offerUrl },
    ps: c.ps(),
  }),
})

export const A5 = lifecycleEmail({
  id: 'A5',
  kind: 'marketing',
  track: 'A',
  stepId: 'A5',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: '{{firstName}}, your seat is still open' },
    preheader: { label: 'Preview text', kind: 'preheader', default: '{{monthly}}, locked until you finish. Closes {{closesOn}}.' },
    intro: {
      label: 'Opening line',
      default: "You applied for {{programme}} because you want something to change. Maybe it's a better job, your first job in tech, or just a skill you can earn from.",
    },
    planIntro: { label: 'Before the plan', default: "Here's the plan:" },
    planList: {
      label: 'The plan (one step per line)',
      kind: 'list',
      default: [
        'Start your scholarship plan: {{monthly}} by bank transfer, OPay or card.',
        'Watch your first lesson today. About 8 hours a week gets you through in about 3 months.',
        'When you finish, pass the final exam to earn your verifiable certificate and unlock internship openings.',
      ].join('\n'),
    },
    picture: { label: 'Picture yourself', default: 'Picture yourself a few months from now, with a skill you can show, a certificate an employer can check, and a CV that says so.' },
    deadline: { label: 'Deadline', default: 'The Access Scholarship closes on {{closesOn}} at 11:59pm. After that, {{programme}} goes back to {{standardFee}}.' },
    lock: { label: 'Locked rate', default: 'Start today, and your {{monthly}} rate is locked until you finish.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Start for {{monthly}}' },
    ps: {
      label: 'P.S.',
      kind: 'ps',
      default: "If it's not for you after a chapter or 5 lessons, ask for a refund within 24 hours of paying. You can also cancel anytime from your dashboard.",
    },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), c.planIntro(), { ordered: true, list: lines(c.planList()) }, c.picture(), proofSlot(d), c.deadline(), c.lock()]),
    button: { label: c.ctaLabel(), url: d.checkoutUrl },
    ps: c.ps(),
  }),
})

export const A6 = lifecycleEmail({
  id: 'A6',
  kind: 'marketing',
  track: 'A',
  stepId: 'A6',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your scholarship closes {{closesDay}}' },
    variant1Subject: { label: 'A/B subject B', kind: 'subject', default: '2 days left at {{monthly}}' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'After that, {{programme}} is {{standardPrice}}.' },
    variant1Preheader: { label: 'A/B preview text B', kind: 'preheader', default: 'The scholarship for {{programme}} closes {{closesDay}}.' },
    intro: { label: 'Opening line', default: 'A quick heads-up: the Access Scholarship closes on {{closesOn}} at 11:59pm.' },
    until: {
      label: 'Until the deadline',
      default: 'Until then, you can start {{programme}} for {{monthly}}, and keep that rate until you finish. The certificate is optional, paid separately when you finish.',
    },
    after: { label: 'After the deadline', default: "After the deadline, it's the standard fee: {{standardFee}}." },
    nudge: { label: 'Closing line', default: "If you've been meaning to start, this is the moment." },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Lock in {{monthly}}' },
    ps: { label: 'P.S.', kind: 'ps', default: "Stuck on something? Reply to this email or WhatsApp me. I'll help you finish today." },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  variants: [{ subject: (_d, c) => c.variant1Subject(), preheader: (_d, c) => c.variant1Preheader() }],
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), c.until(), c.after(), c.nudge()]),
    button: { label: c.ctaLabel(), url: d.checkoutUrl },
    ps: c.ps(),
  }),
})

export const A7 = lifecycleEmail({
  id: 'A7',
  kind: 'marketing',
  track: 'A',
  stepId: 'A7',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Closes tonight at 11:59pm' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Last day to start {{programme}} at {{monthly}}.' },
    intro: { label: 'Opening line', default: 'Short one. The Access Scholarship closes tonight at 11:59pm.' },
    before: { label: 'Before tonight', default: 'Start before then: {{monthly}}, locked until you finish.' },
    after: { label: 'After tonight', default: 'After tonight: {{standardFee}}.' },
    howLong: { label: 'How long it takes', default: 'It takes about 2 minutes by bank transfer, OPay or card.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Start before midnight' },
    ps: { label: 'P.S.', kind: 'ps', default: "This is the last email I'll send about this window." },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), c.before(), c.after(), c.howLong()]),
    button: { label: c.ctaLabel(), url: d.checkoutUrl },
    ps: c.ps(),
  }),
})

export const W1 = lifecycleEmail({
  id: 'W1',
  kind: 'marketing',
  track: 'A',
  stepId: 'W1',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: "It's open again, {{firstName}}" },
    preheader: { label: 'Preview text', kind: 'preheader', default: '{{monthly}} for {{programme}} until {{closesOn}}.' },
    intro: { label: 'Opening line', default: 'You asked me to tell you first, so here it is: the Access Scholarship is open again.' },
    offer: {
      label: 'The offer',
      default: 'Start {{programme}} for {{monthly}} instead of {{standardPrice}}. Join before {{closesOn}} and the rate stays locked until you finish. The certificate is optional, paid separately when you finish.',
    },
    ready: { label: 'Closing line', default: 'Your personal offer is ready.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'See my offer' },
    ps: { label: 'P.S.', kind: 'ps', default: 'This window closes {{closesOn}} at 11:59pm.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), c.offer(), c.ready()]),
    button: { label: c.ctaLabel(), url: d.offerUrl },
    ps: c.ps(),
  }),
})

export const TRACK_A = [A0, A1, A2, A3, A4, A5, A6, A7, W1]
