import { blocks, certificate, DESIGNED, lifecycleEmail, monthly, naira, proofSlot, standardFee } from './shared.js'

/** Track A: before the first payment, while a scholarship window is open (Soap Opera Sequence). */

export const A0 = lifecycleEmail({
  id: 'A0',
  kind: 'transactional',
  track: 'A',
  stepId: 'A0',
  subject: (d) => (d.windowOpen ? `${d.firstName}, your scholarship offer is ready` : `${d.firstName}, your SkillsAir offer`),
  preheader: (d) =>
    d.windowOpen
      ? `${monthly(d)} for ${d.programme} instead of ${naira(d.standardPrice)}. Closes ${d.closesOn}.`
      : `${d.programme}, and how to hear first when the scholarship reopens.`,
  body: (d) =>
    d.windowOpen
      ? {
          blocks: blocks([
            `Hi ${d.firstName},`,
            `It's Imisi from SkillsAir. Good news: you qualify for the Access Scholarship on ${d.programme}.`,
            {
              rows: [
                { label: 'Standard fee', value: standardFee(d), struck: true },
                { label: 'With your Access Scholarship', value: monthly(d), strong: true },
                { label: 'Certificate (when you finish)', value: `${certificate(d)}, optional; needed for internship access` },
              ],
              caption: `Billed monthly by Paystack until you finish. ${DESIGNED[0]!.toUpperCase()}${DESIGNED.slice(1)}. Cancel anytime from your dashboard.`,
            },
            'What you get:',
            {
              list: [
                `The full ${d.programme} programme, at your own pace, for as long as you study`,
                `When you finish: a verifiable certificate employers can check online (${certificate(d)})`,
                'Free bonus courses: CV & LinkedIn, and Freelancing',
                "Access to internship openings from our partner firms once you're certified",
                'Certified graduates can apply for laptop support (2 laptops per cohort)',
              ],
            },
            "Try it first: complete at least one chapter or 5 lessons, and if it's not for you, ask for a refund within 24 hours of paying.",
            `The scholarship closes on ${d.closesOn} at 11:59pm. Join before then and your ${monthly(d)} rate stays locked until you finish.`,
          ]),
          button: { label: 'See my offer', url: d.offerUrl },
          ps: "Not sure yet? Watch a free lesson first. It's on your offer page.",
        }
      : {
          blocks: blocks([
            `Hi ${d.firstName},`,
            `It's Imisi from SkillsAir. Thanks for applying for ${d.programme}.`,
            `The Access Scholarship window is closed right now, so ${d.programme} is at the standard fee: ${standardFee(d)}. The certificate is ${certificate(d)} when you finish.`,
            "Scholarship windows open regularly. You're on the list, so I'll tell you the moment the next one opens.",
          ]),
          button: { label: 'See my offer', url: d.offerUrl },
          ps: "Not sure yet? Watch a free lesson first. It's on your offer page.",
        },
})

export const A1 = lifecycleEmail({
  id: 'A1',
  kind: 'marketing',
  track: 'A',
  stepId: 'A1',
  subject: () => 'Two questions everyone asks me',
  preheader: (d) => `"Why only ${monthly(d)}?" and "Can I do it on my phone?"`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      "Imisi here again. I'm the person who answers when you message SkillsAir on WhatsApp, so you'll hear from me now and then over the next few days. I'll keep it short and useful, promise.",
      'Almost everyone who applies asks me the same two things. Here are straight answers.',
      `**1. "Why only ${monthly(d)}? What's the catch?"**`,
      `No catch. During a scholarship window, the Access Scholarship covers most of the standard fee. You pay ${monthly(d)} while you study, and you can cancel anytime. When you finish, the certificate is ${certificate(d)} if you want it. That's all.`,
      '**2. "Can I do it on my phone?"**',
      d.phoneFriendly
        ? `It depends on the programme. Good news: ${d.programme} works fully on a phone.`
        : `It depends on the programme. ${d.programme} needs a laptop for some of the work. If you only have a phone right now, these work fully on a phone: ${d.phoneFriendlyList}.`,
      "Tomorrow I'll tell you why Abraham, our founder, decided to make this so affordable in the first place. It's not the reason most people guess.",
    ]),
    button: { label: 'See my offer', url: d.offerUrl },
    ps: 'Got a different question? Just reply. I read every one.',
  }),
})

export const A2 = lifecycleEmail({
  id: 'A2',
  kind: 'marketing',
  track: 'A',
  stepId: 'A2',
  subject: (d) => `Why we made it ${monthly(d)}`,
  preheader: () => "Talent isn't the problem. Access is.",
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      'Yesterday I promised you the real reason SkillsAir costs so little.',
      'Abraham Akinwumi started SkillsAir because he kept seeing two problems side by side.',
      'On one side: talented young Africans who wanted to get into tech, but every good programme was either too expensive or too shallow to get anyone hired.',
      "On the other side: companies who couldn't find enough skilled people to hire.",
      d.founderAnecdote,
      "Same country, same cities, sometimes the same street. The gap wasn't talent. It was access.",
      `So he built SkillsAir to close it: job-ready training that young people can actually afford, with a path to internships once they're certified. The Access Scholarship is how that works in practice. For people who join during a window, it covers most of the fee, and the ${monthly(d)} stays the same until you finish.`,
      proofSlot(d),
      `You applied for ${d.programme}. That's the hard part done. The next step is just to start.`,
    ]),
    button: { label: `Start for ${monthly(d)}`, url: d.offerUrl },
    ps: `The certificate is ${certificate(d)}, paid only when you finish and only if you want it. No other fees.`,
  }),
})

export const A3 = lifecycleEmail({
  id: 'A3',
  kind: 'marketing',
  track: 'A',
  stepId: 'A3',
  subject: (d) => `What a ${d.role} actually does all day`,
  preheader: () => 'And why you don\'t need to feel "ready" to start.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      d.careerExplainer,
      "Here's the thing most people miss. Nobody starts out feeling ready. The people doing this work today didn't wait until they were confident. They learned one skill, then the next, and the confidence came from doing it.",
      `That's how ${d.programme} is built. You start from the basics, at your own pace, about 8 hours a week. It's designed to take about 3 months.`,
      'If you can give it 8 hours a week, you can do this.',
    ]),
    button: { label: 'See my offer', url: d.offerUrl },
    ps: `Your scholarship price is ${monthly(d)} until ${d.closesOn}. The certificate is ${certificate(d)} when you finish.`,
  }),
})

export const A4 = lifecycleEmail({
  id: 'A4',
  kind: 'marketing',
  track: 'A',
  stepId: 'A4',
  subject: () => '5 things people miss in your offer',
  preheader: () => "Number 3 matters most if you're worried about money.",
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `When people read their offer, they see "${monthly(d)}" and stop there. Here's what else is in it.`,
      {
        ordered: true,
        list: [
          '**Two free courses.** CV & LinkedIn, and Freelancing, so you can show your skills and start earning from them.',
          `**A certificate employers can check.** When you finish, your certificate (${certificate(d)}) has its own link. An employer clicks it and sees it's real.`,
          `**Your price is locked.** Join during the scholarship and you pay ${monthly(d)} until you finish, even after the window closes. If you take a break and come back, it's still ${monthly(d)}.`,
          "**Internship access.** Certified graduates get access to internship openings from our partner firms. The network is new and growing, so I won't overpromise, but the door is there.",
          '**Laptop support.** Each cohort, 2 laptops go to certified graduates who need one most. You apply with your story.',
        ],
      },
      "And one more: try it first. Complete a chapter or 5 lessons. If it's not for you, ask for a refund within 24 hours of paying.",
      proofSlot(d),
    ]),
    button: { label: `Start for ${monthly(d)}`, url: d.offerUrl },
    ps: `${monthly(d)} is about ₦67 a day. Less than you spend on data.`,
  }),
})

export const A5 = lifecycleEmail({
  id: 'A5',
  kind: 'marketing',
  track: 'A',
  stepId: 'A5',
  subject: (d) => `${d.firstName}, your seat is still open`,
  preheader: (d) => `${monthly(d)}, locked until you finish. Closes ${d.closesOn}.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `You applied for ${d.programme} because you want something to change. Maybe it's a better job, your first job in tech, or just a skill you can earn from.`,
      "Here's the plan:",
      {
        ordered: true,
        list: [
          `Start your scholarship plan: ${monthly(d)} by card.`,
          'Watch your first lesson today. About 8 hours a week gets you through in about 3 months.',
          `When you finish, claim your verifiable certificate (${certificate(d)}) and unlock internship openings.`,
        ],
      },
      'Picture yourself a few months from now, with a skill you can show, a certificate an employer can check, and a CV that says so.',
      proofSlot(d),
      `The Access Scholarship closes on ${d.closesOn} at 11:59pm. After that, ${d.programme} goes back to ${standardFee(d)}.`,
      `Start today, and your ${monthly(d)} rate is locked until you finish.`,
    ]),
    button: { label: `Start for ${monthly(d)}`, url: d.checkoutUrl },
    ps: "If it's not for you after a chapter or 5 lessons, ask for a refund within 24 hours of paying. You can also cancel anytime from your dashboard.",
  }),
})

export const A6 = lifecycleEmail({
  id: 'A6',
  kind: 'marketing',
  track: 'A',
  stepId: 'A6',
  subject: (d) => `Your scholarship closes ${d.closesDay}`,
  preheader: (d) => `After that, ${d.programme} is ${naira(d.standardPrice)}.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `A quick heads-up: the Access Scholarship closes on ${d.closesOn} at 11:59pm.`,
      `Until then, you can start ${d.programme} for ${monthly(d)}, and keep that rate until you finish. The certificate is ${certificate(d)} when you're done.`,
      `After the deadline, it's the standard fee: ${standardFee(d)}.`,
      "If you've been meaning to start, this is the moment.",
    ]),
    button: { label: `Lock in ${monthly(d)}`, url: d.checkoutUrl },
    ps: "Stuck on something? Reply to this email or WhatsApp me. I'll help you finish today.",
  }),
})

export const A7 = lifecycleEmail({
  id: 'A7',
  kind: 'marketing',
  track: 'A',
  stepId: 'A7',
  subject: () => 'Closes tonight at 11:59pm',
  preheader: (d) => `Last day to start ${d.programme} at ${monthly(d)}.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      'Short one. The Access Scholarship closes tonight at 11:59pm.',
      `Start before then: ${monthly(d)}, locked until you finish. The certificate is ${certificate(d)} when you're done.`,
      `After tonight: ${standardFee(d)}.`,
      'It takes about 2 minutes by card.',
    ]),
    button: { label: 'Start before midnight', url: d.checkoutUrl },
    ps: "This is the last email I'll send about this window.",
  }),
})

export const W1 = lifecycleEmail({
  id: 'W1',
  kind: 'marketing',
  track: 'A',
  stepId: 'W1',
  subject: (d) => `It's open again, ${d.firstName}`,
  preheader: (d) => `${monthly(d)} for ${d.programme} until ${d.closesOn}.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      'You asked me to tell you first, so here it is: the Access Scholarship is open again.',
      `Start ${d.programme} for ${monthly(d)} instead of ${naira(d.standardPrice)}. Join before ${d.closesOn} and the rate stays locked until you finish. The certificate is ${certificate(d)} when you're done.`,
      'Your personal offer is ready.',
    ]),
    button: { label: 'See my offer', url: d.offerUrl },
    ps: `This window closes ${d.closesOn} at 11:59pm.`,
  }),
})

export const TRACK_A = [A0, A1, A2, A3, A4, A5, A6, A7, W1]
