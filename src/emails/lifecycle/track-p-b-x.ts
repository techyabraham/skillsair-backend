import { lines } from '../define.js'
import { blocks, greeting, LOCK_LINE, lifecycleEmail, naira } from './shared.js'
import type { MessageData } from '../../lib/lifecycle/context.js'

/** Track A-post: weekly nurture after the window closes (three value emails to one offer). */

/** "₦40,000 a month, or ₦100,000 once" when there's a monthly standard fee, else "₦100,000". */
const standardOptions = (d: MessageData, withMonthly: string) => (d.standardMonthlyPrice ? withMonthly : naira(d.standardPrice))

export const P1 = lifecycleEmail({
  id: 'P1',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P1',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'The scholarship closed. Now what?' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Two options, and one of them is free.' },
    intro: { label: 'Opening line', default: 'The Access Scholarship window has closed, so {{programme}} is back to the standard fee for now.' },
    optionsIntro: { label: 'Before the options', default: 'You have two options:' },
    option1: { label: 'Option 1', default: "Wait for the next window. Tap below and I'll tell you the moment it opens, before anyone else." },
    option2: { label: 'Option 2', default: 'Start now at the standard fee ({{standardOptions}}).', vars: { standardOptions: 'The standard fee, e.g. ₦40,000 a month, or ₦100,000 once' } },
    standardOptions: { label: 'Standard fee with a monthly option', default: '{{standardMonthly}} a month, or {{standardPrice}} once', help: 'Used in option 2 when the programme has a monthly standard fee.' },
    weekly: {
      label: 'What happens next',
      default: "Most people choose option 1, and that's fine. In the meantime, I'll send you something useful about once a week. If you'd rather not get those, the unsubscribe link is at the bottom.",
    },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Tell me when it reopens' },
    ps: { label: 'P.S. (the offer link follows)', kind: 'ps', default: "Can't wait? Start now at the standard fee:" },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.intro(),
      c.optionsIntro(),
      { ordered: true, list: [c.option1(), c.option2({ standardOptions: standardOptions(d, c.standardOptions()) })] },
      c.weekly(),
    ]),
    button: { label: c.ctaLabel(), url: d.waitlistUrl },
    ps: `${c.ps()} ${d.offerUrl}`,
  }),
})

export const P2 = lifecycleEmail({
  id: 'P2',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P2',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'A free 20-minute {{field}} exercise', vars: { field: 'The school without "School of", e.g. Data (or "tech")' } },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'No sign-up, no course. Just try it.' },
    intro: { label: 'Opening line', default: 'The biggest problem I hear from people who want to get into tech: "I don\'t know if I\'ll even like it."' },
    exercise: {
      label: 'The exercise',
      default: "Here's a way to find out this week, for free. {{freeExercise}}",
      vars: { freeExercise: 'The school’s free exercise (Categories → free exercise)' },
      required: ['freeExercise'],
    },
    closing: {
      label: 'Closing line',
      default: "Do it once. If you enjoyed it, even a little, that's your sign. If you hated it, that's useful too, and you've saved yourself months.",
    },
    ps: { label: 'P.S. (the waitlist link follows)', kind: 'ps', default: 'Want to know when the scholarship reopens? Tap here:' },
  },
  subject: (d, c) => c.subject({ field: d.school ? d.school.replace(/^School of /i, '') : 'tech' }),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), c.exercise({ freeExercise: d.freeExercise ?? '' }), c.closing()]),
    ps: `${c.ps()} ${d.waitlistUrl}`,
  }),
})

export const P3 = lifecycleEmail({
  id: 'P3',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P3',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'No laptop? Read this.' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Some programmes work fully on a phone.' },
    intro: { label: 'Opening line', default: '"I don\'t have a laptop" stops a lot of people before they start. It shouldn\'t stop you.' },
    list: { label: 'Phone-friendly programmes', default: 'These SkillsAir programmes work fully on a phone: {{phoneFriendlyList}}.' },
    anywhere: {
      label: 'Learning anywhere',
      default: 'Learning on your phone also means you can study on the bus, in a queue or during a break. Ten minutes here and there adds up.',
    },
    laptopSupport: {
      label: 'Laptop support',
      default: 'And when you finish and get certified, you can apply for laptop support. Each cohort, 2 laptops go to graduates who need one most.',
    },
    ctaLabel: { label: 'Button', kind: 'button', default: 'See phone-friendly programmes' },
    ps: { label: 'P.S. (the waitlist link follows)', kind: 'ps', default: "I'll tell you first when the scholarship reopens if you tap here:" },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), c.list(), c.anywhere(), c.laptopSupport()]),
    button: { label: c.ctaLabel(), url: d.phoneFriendlyUrl },
    ps: `${c.ps()} ${d.waitlistUrl}`,
  }),
})

export const P4 = lifecycleEmail({
  id: 'P4',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P4',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'How to spot a fake tech course' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Four questions to ask before you pay anyone.' },
    intro: {
      label: 'Opening line',
      default: 'There are a lot of "tech courses" out there that take people\'s money and give nothing back. Before you pay anyone, including us, ask these four questions:',
    },
    questionsList: {
      label: 'The four questions (one per line)',
      kind: 'list',
      default: [
        'Is the company registered? (Search the name on the CAC website.)',
        'Can I see a lesson before I pay?',
        'Do they promise me a job? (If yes, be careful. Nobody can honestly promise that.)',
        'Is there a clear refund policy?',
      ].join('\n'),
    },
    answers: {
      label: 'Our answers',
      default:
        "For the record, here are our answers: SKILLS AIR LIMITED, RC 9272398. Yes, every programme has a free preview lesson. No, we don't promise jobs; certified graduates get access to internship openings from partner firms. And yes: a refund within 24 hours of paying, after you've tried at least a chapter or 5 lessons.",
    },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Watch a free lesson' },
    ps: { label: 'P.S. (the waitlist link follows)', kind: 'ps', default: "Waiting for the next scholarship? I'll message you first:" },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), { ordered: true, list: lines(c.questionsList()) }, c.answers()]),
    button: { label: c.ctaLabel(), url: d.previewUrl },
    ps: `${c.ps()} ${d.waitlistUrl}`,
  }),
})

export const P5 = lifecycleEmail({
  id: 'P5',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P5',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Still thinking about {{programme}}?' },
    preheader: { label: 'Preview text', kind: 'preheader', default: "Here's the fastest way to start." },
    intro: { label: 'Opening line', default: "It's been about a month since you applied for {{programme}}. If you still want to do it, here are your options." },
    startNow: {
      label: 'Start now',
      default: 'Start now at the standard fee: {{standardOptions}}, with the same optional certificate, the free bonus courses and internship access.',
      vars: { standardOptions: 'The standard fee, e.g. ₦40,000 a month, or ₦100,000 once' },
    },
    standardOptions: { label: 'Standard fee with a monthly option', default: '{{standardMonthly}} a month, or {{standardPrice}} once', help: 'Used when the programme has a monthly standard fee.' },
    wait: { label: 'Or wait', default: 'Or wait for the next Access Scholarship window. When it opens, people on the waitlist hear first.' },
    closing: { label: 'Closing line', default: 'Either way, the important thing is that you start. A skill you begin this month is worth more than one you plan for next year.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Tell me when it reopens' },
    ps: { label: 'P.S. (the offer link follows)', kind: 'ps', default: 'Ready now? Start at the standard fee:' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), c.startNow({ standardOptions: standardOptions(d, c.standardOptions()) }), c.wait(), c.closing()]),
    button: { label: c.ctaLabel(), url: d.waitlistUrl },
    ps: `${c.ps()} ${d.offerUrl}`,
  }),
})

/** P6 repeats monthly (up to 4 times), rotating the angle on the same career explainer. */
export const P6 = lifecycleEmail({
  id: 'P6',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P6',
  copy: {
    subject: { label: 'Subject (1st send)', kind: 'subject', default: 'A day in the life of a {{role}}' },
    subject2: { label: 'Subject (2nd send)', kind: 'subject', default: 'What a {{role}} learns first' },
    subject3: { label: 'Subject (3rd send)', kind: 'subject', default: 'How people become a {{role}}' },
    subject4: { label: 'Subject (4th send)', kind: 'subject', default: 'Is {{role}} work for you?' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'A 2-minute read.' },
    intro: {
      label: 'Opening line',
      default: "A lot of people tell me they like the idea of {{programme}}, but they're not sure what the work is actually like. So here's an honest picture.",
    },
    plan: {
      label: 'The plan',
      default: "The plan to get there is simpler than it looks: learn the basics, practise on small real tasks, then build one project you can show. That's how {{programme}} is laid out, as a guided 12-week plan with weekly goals.",
    },
    closing: { label: 'Closing line', default: 'A few months from now, you could be showing an employer what you can do, not just telling them.' },
    ps: { label: 'P.S. (the waitlist link follows)', kind: 'ps', default: "Waiting for the next scholarship window? I'll tell you first:" },
  },
  subject: (d, c) => [c.subject, c.subject2, c.subject3, c.subject4][d.occurrence % 4]!(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), d.careerExplainer, c.plan(), c.closing()]),
    ps: `${c.ps()} ${d.waitlistUrl}`,
  }),
})

/** Track B: checkout not finished (reminder → gentle push → final nudge). No discounts. */

export const B1 = lifecycleEmail({
  id: 'B1',
  kind: 'transactional',
  track: 'B',
  stepId: 'B1',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: "Your {{programme}} seat isn't confirmed yet" },
    variant1Subject: { label: 'A/B subject B', kind: 'subject', default: "Your payment didn't finish" },
    preheader: { label: 'Preview text', kind: 'preheader', default: "Your payment didn't go through. Here's how to finish." },
    variant1Preheader: { label: 'A/B preview text B', kind: 'preheader', default: 'Your {{programme}} seat is waiting. It takes 2 minutes.' },
    intro: { label: 'Opening line', default: "You started your {{monthly}} plan for {{programme}}, but the payment didn't finish, so your seat isn't confirmed yet." },
    reasonsIntro: { label: 'Before the reasons', default: 'This usually happens for one of these reasons:' },
    reasonsList: {
      label: 'Reasons (one per line)',
      kind: 'list',
      default: [
        "Your card isn't enabled for online payments. Turn it on in your bank app, then try again.",
        'The OTP expired. Just try again.',
        'Your bank declined it. Try a different debit card, or pay by bank transfer or OPay instead.',
      ].join('\n'),
    },
    reversal: {
      label: 'If money left their account',
      default: "If money left your account, don't worry. Banks normally reverse failed payments automatically. If yours hasn't, reply with your reference{{referenceInBrackets}} and we'll resolve it within 24 hours.",
      vars: { referenceInBrackets: 'The reference in brackets with a space before it, e.g. " (SA-SUB-48213)" (empty when there isn’t one)' },
    },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Finish my payment' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  variants: [{ subject: (_d, c) => c.variant1Subject(), preheader: (_d, c) => c.variant1Preheader() }],
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.intro(),
      c.reasonsIntro(),
      { list: lines(c.reasonsList()) },
      c.reversal({ referenceInBrackets: d.reference ? ` (${d.reference})` : '' }),
    ]),
    button: { label: c.ctaLabel(), url: d.checkoutUrl },
  }),
})

export const B2 = lifecycleEmail({
  id: 'B2',
  kind: 'marketing',
  track: 'B',
  stepId: 'B2',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Need a hand finishing?' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'It takes about 2 minutes by bank transfer, OPay or card.' },
    intro: { label: 'Opening line', default: "Your seat in {{programme}} is still waiting. Everything's set up. The only step left is the payment." },
    tipsIntro: { label: 'Before the tips', default: 'Two things that help people finish:' },
    tipsList: {
      label: 'Tips (one per line)',
      kind: 'list',
      default: [
        'Bank transfer is the easiest: Paystack shows you an account number to send the money to. OPay works too. Each payment covers a month, and we remind you before the next one is due.',
        'Prefer it to renew by itself? Choose Paystack and pay with a debit card that’s enabled for online payments. Someone else paying can use their own card; agree the monthly charge with them first.',
      ].join('\n'),
    },
    stuck: { label: 'Stuck?', default: "Stuck? Reply here or WhatsApp me on +234 818 212 6524 and tell me what happened. I'll walk you through it." },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Finish my payment' },
    ps: { label: 'P.S.', kind: 'ps', default: "You can cancel anytime from your dashboard, and there's a 24-hour refund once you've tried a chapter or 5 lessons." },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), c.tipsIntro(), { list: lines(c.tipsList()) }, c.stuck()]),
    button: { label: c.ctaLabel(), url: d.checkoutUrl },
    ps: c.ps(),
  }),
})

export const B3 = lifecycleEmail({
  id: 'B3',
  kind: 'marketing',
  track: 'B',
  stepId: 'B3',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Last step for {{programme}}' },
    preheader: { label: 'Preview text (window open)', kind: 'preheader', default: '{{monthly}}, locked if you finish before {{closesOn}}.' },
    preheaderClosed: { label: 'Preview text (window closed)', kind: 'preheader', default: '{{monthly}}, your locked rate.' },
    intro: { label: 'Opening line (window open)', default: "I don't want you to lose your scholarship seat over a payment hiccup." },
    introClosed: { label: 'Opening line (window closed)', default: "I don't want a payment hiccup to stop you." },
    deadline: {
      label: 'Deadline (window open)',
      default: "Finish your payment before {{closesOn}} at 11:59pm and you'll pay {{monthly}} until you finish {{programme}}. After the deadline, it's {{standardFee}}.",
    },
    finish: { label: 'Finish (window closed, no locked rate)', default: 'Finish your payment to start {{programme}}.', help: 'People with a locked rate see the shared locked-rate sentence instead.' },
    last: { label: 'Last reminder', default: "This is the last reminder I'll send about this payment." },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Finish my payment' },
    ps: { label: 'P.S.', kind: 'ps', default: 'The only other cost is an optional certificate when you finish. Nothing else to pay.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (d, c) => (d.windowOpen ? c.preheader() : c.preheaderClosed()),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      d.windowOpen ? c.intro() : c.introClosed(),
      d.windowOpen ? c.deadline() : d.priceLocked ? LOCK_LINE(d) : c.finish(),
      c.last(),
    ]),
    button: { label: c.ctaLabel(), url: d.checkoutUrl },
    ps: c.ps(),
  }),
})

/** Track X: re-permission after 90 days without engagement. */

export const X1 = lifecycleEmail({
  id: 'X1',
  kind: 'marketing',
  track: 'X',
  stepId: 'X1',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Should I keep writing to you?' },
    preheader: { label: 'Preview text', kind: 'preheader', default: "One tap to stay. Otherwise I'll stop." },
    intro: { label: 'Opening line', default: "You haven't opened my emails in a while, and I don't want to clutter your inbox." },
    choice: {
      label: 'Stay or go',
      default:
        "If you'd like to keep hearing about SkillsAir scholarships and programmes, tap the button below. If not, do nothing and I'll stop sending these. You'll still get any receipts or account emails.",
    },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Yes, keep me on the list' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), c.choice()]),
    // A click on this link is the engagement that keeps them on the list (Resend click tracking).
    button: { label: c.ctaLabel(), url: `${d.dashboardUrl.replace(/\/dashboard$/, '')}/?stay=1` },
  }),
})

export const TRACK_P_B_X = [P1, P2, P3, P4, P5, P6, B1, B2, B3, X1]
