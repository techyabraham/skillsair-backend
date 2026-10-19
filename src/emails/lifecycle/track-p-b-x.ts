import { blocks, certificate, LOCK_LINE, lifecycleEmail, monthly, naira, standardFee } from './shared.js'

/** Track A-post: weekly nurture after the window closes (three value emails to one offer). */

export const P1 = lifecycleEmail({
  id: 'P1',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P1',
  subject: () => 'The scholarship closed. Now what?',
  preheader: () => 'Two options, and one of them is free.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `The Access Scholarship window has closed, so ${d.programme} is back to the standard fee for now.`,
      'You have two options:',
      {
        ordered: true,
        list: [
          "Wait for the next window. Tap below and I'll tell you the moment it opens, before anyone else.",
          `Start now at the standard fee (${d.standardMonthlyPrice ? `${naira(d.standardMonthlyPrice)} a month, or ${naira(d.standardPrice)} once` : naira(d.standardPrice)}).`,
        ],
      },
      "Most people choose option 1, and that's fine. In the meantime, I'll send you something useful about once a week. If you'd rather not get those, the unsubscribe link is at the bottom.",
    ]),
    button: { label: 'Tell me when it reopens', url: d.waitlistUrl },
    ps: `Can't wait? Start now at the standard fee: ${d.offerUrl}`,
  }),
})

export const P2 = lifecycleEmail({
  id: 'P2',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P2',
  subject: (d) => `A free 20-minute ${d.school ? d.school.replace(/^School of /i, '') : 'tech'} exercise`,
  preheader: () => 'No sign-up, no course. Just try it.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      'The biggest problem I hear from people who want to get into tech: "I don\'t know if I\'ll even like it."',
      `Here's a way to find out this week, for free. ${d.freeExercise ?? ''}`,
      "Do it once. If you enjoyed it, even a little, that's your sign. If you hated it, that's useful too, and you've saved yourself months.",
    ]),
    ps: `Want to know when the scholarship reopens? Tap here: ${d.waitlistUrl}`,
  }),
})

export const P3 = lifecycleEmail({
  id: 'P3',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P3',
  subject: () => 'No laptop? Read this.',
  preheader: () => 'Some programmes work fully on a phone.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      '"I don\'t have a laptop" stops a lot of people before they start. It shouldn\'t stop you.',
      `These SkillsAir programmes work fully on a phone: ${d.phoneFriendlyList}.`,
      'Learning on your phone also means you can study on the bus, in a queue or during a break. Ten minutes here and there adds up.',
      'And when you finish and get certified, you can apply for laptop support. Each cohort, 2 laptops go to graduates who need one most.',
    ]),
    button: { label: 'See phone-friendly programmes', url: d.phoneFriendlyUrl },
    ps: `I'll tell you first when the scholarship reopens if you tap here: ${d.waitlistUrl}`,
  }),
})

export const P4 = lifecycleEmail({
  id: 'P4',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P4',
  subject: () => 'How to spot a fake tech course',
  preheader: () => 'Four questions to ask before you pay anyone.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      'There are a lot of "tech courses" out there that take people\'s money and give nothing back. Before you pay anyone, including us, ask these four questions:',
      {
        ordered: true,
        list: [
          'Is the company registered? (Search the name on the CAC website.)',
          'Can I see a lesson before I pay?',
          "Do they promise me a job? (If yes, be careful. Nobody can honestly promise that.)",
          'Is there a clear refund policy?',
        ],
      },
      "For the record, here are our answers: SKILLS AIR LIMITED, RC 9272398. Yes, every programme has a free preview lesson. No, we don't promise jobs; certified graduates get access to internship openings from partner firms. And yes: a refund within 24 hours of paying, after you've tried at least a chapter or 5 lessons.",
    ]),
    button: { label: 'Watch a free lesson', url: d.previewUrl },
    ps: `Waiting for the next scholarship? I'll message you first: ${d.waitlistUrl}`,
  }),
})

export const P5 = lifecycleEmail({
  id: 'P5',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P5',
  subject: (d) => `Still thinking about ${d.programme}?`,
  preheader: () => "Here's the fastest way to start.",
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `It's been about a month since you applied for ${d.programme}. If you still want to do it, here are your options.`,
      `Start now at the standard fee: ${d.standardMonthlyPrice ? `${naira(d.standardMonthlyPrice)} a month, or ${naira(d.standardPrice)} once` : naira(d.standardPrice)}, with the same optional certificate, the free bonus courses and internship access.`,
      'Or wait for the next Access Scholarship window. When it opens, people on the waitlist hear first.',
      'Either way, the important thing is that you start. A skill you begin this month is worth more than one you plan for next year.',
    ]),
    button: { label: 'Tell me when it reopens', url: d.waitlistUrl },
    ps: `Ready now? Start at the standard fee: ${d.offerUrl}`,
  }),
})

/** P6 repeats monthly (up to 4 times), rotating the angle on the same career explainer. */
const P6_SUBJECTS = [
  (role: string) => `A day in the life of a ${role}`,
  (role: string) => `What a ${role} learns first`,
  (role: string) => `How people become a ${role}`,
  (role: string) => `Is ${role} work for you?`,
]

export const P6 = lifecycleEmail({
  id: 'P6',
  kind: 'marketing',
  track: 'Apost',
  stepId: 'P6',
  subject: (d) => (P6_SUBJECTS[d.occurrence % P6_SUBJECTS.length] as (role: string) => string)(d.role),
  preheader: () => 'A 2-minute read.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `A lot of people tell me they like the idea of ${d.programme}, but they're not sure what the work is actually like. So here's an honest picture.`,
      d.careerExplainer,
      `The plan to get there is simpler than it looks: learn the basics, practise on small real tasks, then build one project you can show. That's how ${d.programme} is laid out, at your own pace.`,
      'A few months from now, you could be showing an employer what you can do, not just telling them.',
    ]),
    ps: `Waiting for the next scholarship window? I'll tell you first: ${d.waitlistUrl}`,
  }),
})

/** Track B: checkout not finished (reminder → gentle push → final nudge). No discounts. */

export const B1 = lifecycleEmail({
  id: 'B1',
  kind: 'transactional',
  track: 'B',
  stepId: 'B1',
  subject: (d) => `Your ${d.programme} seat isn't confirmed yet`,
  preheader: () => "Your payment didn't go through. Here's how to finish.",
  variants: [{ subject: () => "Your payment didn't finish", preheader: (d) => `Your ${d.programme} seat is waiting. It takes 2 minutes.` }],
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `You started your ${monthly(d)} plan for ${d.programme}, but the payment didn't finish, so your seat isn't confirmed yet.`,
      'This usually happens for one of these reasons:',
      {
        list: [
          "Your card isn't enabled for online payments. Turn it on in your bank app, then try again.",
          'The OTP expired. Just try again.',
          'Your bank declined it. Try a different debit card.',
        ],
      },
      `If money left your account, don't worry. Banks normally reverse failed payments automatically. If yours hasn't, reply with your reference${d.reference ? ` (${d.reference})` : ''} and we'll resolve it within 24 hours.`,
    ]),
    button: { label: 'Finish my payment', url: d.checkoutUrl },
  }),
})

export const B2 = lifecycleEmail({
  id: 'B2',
  kind: 'marketing',
  track: 'B',
  stepId: 'B2',
  subject: () => 'Need a hand finishing?',
  preheader: () => 'It takes about 2 minutes once your card is ready.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `Your seat in ${d.programme} is still waiting. Everything's set up. The only step left is the payment.`,
      'Two things that help people finish:',
      {
        list: [
          "Monthly plans renew from a card, so use a debit card that's enabled for online payments.",
          'Someone else paying? They can use their own card at checkout. The monthly charge will renew from that card, so agree it with them first.',
        ],
      },
      "Stuck? Reply here or WhatsApp me on +234 818 212 6524 and tell me what happened. I'll walk you through it.",
    ]),
    button: { label: 'Finish my payment', url: d.checkoutUrl },
    ps: "You can cancel anytime from your dashboard, and there's a 24-hour refund once you've tried a chapter or 5 lessons.",
  }),
})

export const B3 = lifecycleEmail({
  id: 'B3',
  kind: 'marketing',
  track: 'B',
  stepId: 'B3',
  subject: (d) => `Last step for ${d.programme}`,
  preheader: (d) => (d.windowOpen ? `${monthly(d)}, locked if you finish before ${d.closesOn}.` : `${monthly(d)}, your locked rate.`),
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      d.windowOpen
        ? "I don't want you to lose your scholarship seat over a payment hiccup."
        : "I don't want a payment hiccup to stop you.",
      d.windowOpen
        ? `Finish your payment before ${d.closesOn} at 11:59pm and you'll pay ${monthly(d)} until you finish ${d.programme}. After the deadline, it's ${standardFee(d)}.`
        : d.priceLocked
          ? LOCK_LINE(d)
          : `Finish your payment to start ${d.programme}.`,
      "This is the last reminder I'll send about this payment.",
    ]),
    button: { label: 'Finish my payment', url: d.checkoutUrl },
    ps: 'The only other cost is an optional certificate when you finish. Nothing else to pay.',
  }),
})

/** Track X: re-permission after 90 days without engagement. */

export const X1 = lifecycleEmail({
  id: 'X1',
  kind: 'marketing',
  track: 'X',
  stepId: 'X1',
  subject: () => 'Should I keep writing to you?',
  preheader: () => "One tap to stay. Otherwise I'll stop.",
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      "You haven't opened my emails in a while, and I don't want to clutter your inbox.",
      "If you'd like to keep hearing about SkillsAir scholarships and programmes, tap the button below. If not, do nothing and I'll stop sending these. You'll still get any receipts or account emails.",
    ]),
    // A click on this link is the engagement that keeps them on the list (Resend click tracking).
    button: { label: 'Yes, keep me on the list', url: `${d.dashboardUrl.replace(/\/dashboard$/, '')}/?stay=1` },
  }),
})

export const TRACK_P_B_X = [P1, P2, P3, P4, P5, P6, B1, B2, B3, X1]
