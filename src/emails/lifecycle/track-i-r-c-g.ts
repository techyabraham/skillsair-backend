import { blocks, certificate, lifecycleEmail, monthly, naira, proofSlot, standardFee } from './shared.js'
import type { MessageData } from '../../lib/lifecycle/context.js'

/** Track I: learning nudges (service). No selling: only the next lesson, and an honest word about renewals. */

export const I0 = lifecycleEmail({
  id: 'I0',
  kind: 'service',
  track: 'I',
  stepId: 'I0',
  subject: (d) => (d.lesson1Minutes ? `Your first lesson takes ${d.lesson1Minutes} minutes` : 'Your first lesson is ready'),
  preheader: () => 'The hardest part is pressing play.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `You've paid for ${d.programme}, but you haven't started yet. That's normal. Starting is the hardest part.`,
      d.lesson1Title
        ? `Lesson 1, "${d.lesson1Title}"${d.lesson1Minutes ? `, takes about ${d.lesson1Minutes} minutes` : ' is short'}. Do it now, before you close this email.`
        : 'Lesson 1 is short. Do it now, before you close this email.',
    ]),
    button: { label: 'Start lesson 1', url: d.firstLessonUrl },
  }),
})

export const I1 = lifecycleEmail({
  id: 'I1',
  kind: 'service',
  track: 'I',
  stepId: 'I1',
  subject: () => 'Pick up where you stopped?',
  preheader: (d) => (d.nextLessonTitle ? `Next up: "${d.nextLessonTitle}".` : 'Your next lesson is waiting.'),
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `It's been a few days since your last lesson in ${d.programme}. Life happens, I know.`,
      `You're ${d.progressPercent}% through.${d.nextLessonTitle ? ` Your next lesson is "${d.nextLessonTitle}".` : ''} Can you give it 20 minutes today?`,
    ]),
    button: { label: 'Continue learning', url: d.resumeUrl },
  }),
})

export const I2 = lifecycleEmail({
  id: 'I2',
  kind: 'service',
  track: 'I',
  stepId: 'I2',
  subject: () => 'Is something in the way?',
  preheader: () => "Reply with one number and I'll help.",
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `You haven't been back to ${d.programme} for about 10 days. Usually it's one of these. Reply with the number that fits and I'll help:`,
      { ordered: true, list: ['No time', 'Stuck on a lesson', 'Not sure it’s for me', 'Something else'] },
      `Your progress is saved: ${d.progressPercent}% done.`,
    ]),
    button: { label: 'Continue learning', url: d.resumeUrl },
  }),
})

export const I3 = lifecycleEmail({
  id: 'I3',
  kind: 'service',
  track: 'I',
  stepId: 'I3',
  subject: () => '20 minutes this week?',
  preheader: () => 'Small steps still get you there.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `I'll keep this short. You don't need a perfect week to make progress. One 20-minute session keeps ${d.programme} alive in your head.`,
      d.lessonsLeft ? `You have ${d.lessonsLeft} lessons to go.` : '',
      // Honest about paying for access they're not using.
      d.renewalSoon && d.chargeDate
        ? `Your plan renews on ${d.chargeDate}. If you can't study right now, it's fine to cancel and come back later${d.joinedOnScholarship ? ` at the same ${monthly(d)} rate` : ''}: ${d.billingUrl}`
        : '',
    ]),
    button: { label: 'Continue learning', url: d.resumeUrl },
  }),
})

/** Track R: lapsed before finishing. Every message offers the locked ₦2,000 a month (no deadline). */

const restartLabel = (d: MessageData) => (d.joinedOnScholarship ? `Restart for ${monthly(d)}` : 'Restart my programme')
const lockSentence = (d: MessageData) => (d.joinedOnScholarship ? ` Your rate is locked at ${monthly(d)}.` : '')

export const R1 = lifecycleEmail({
  id: 'R1',
  kind: 'marketing',
  track: 'R',
  stepId: 'R1',
  subject: (d) => (d.lessonsLeft ? `${d.lessonsLeft} lessons to go, ${d.firstName}` : `Your progress is waiting, ${d.firstName}`),
  preheader: (d) => `Your progress in ${d.programme} is saved.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `You were ${d.progressPercent}% of the way through ${d.programme} when your access paused. That's real progress, and it's all still saved.`,
      `Restart today and you'll pick up exactly${d.nextLessonTitle ? ` at "${d.nextLessonTitle}"` : ' where you stopped'}.${lockSentence(d)}`,
    ]),
    button: { label: restartLabel(d), url: d.resumeCheckoutUrl },
  }),
})

export const R2 = lifecycleEmail({
  id: 'R2',
  kind: 'marketing',
  track: 'R',
  stepId: 'R2',
  subject: () => 'Can I ask what happened?',
  preheader: () => 'One-line reply. I read every one.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `Your ${d.programme} access has been paused for a week. I'd like to know why, so we can do better. Was it money, time, or the programme itself?`,
      'Just reply with one word.',
      d.joinedOnScholarship
        ? `And if it was money: your ${monthly(d)} rate never expires. Come back whenever you're ready.`
        : 'And if it was money, tell me. I may be able to help you find a way back.',
    ]),
    button: { label: 'Restart my programme', url: d.resumeCheckoutUrl },
  }),
})

export const R3 = lifecycleEmail({
  id: 'R3',
  kind: 'marketing',
  track: 'R',
  stepId: 'R3',
  subject: (d) => `How to finish ${d.programme} in ${d.weeksLeft} week${d.weeksLeft === 1 ? '' : 's'}`,
  preheader: (d) => `A simple plan for the ${d.lessonsLeft} lessons left.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      'Starting again after a break feels harder than starting the first time. So here\'s a simple plan.',
      `You have ${d.lessonsLeft} lessons left. At about 8 hours a week, that's around ${d.weeksLeft} week${d.weeksLeft === 1 ? '' : 's'}.${d.joinedOnScholarship && d.weeksLeft <= 4 ? ` If you finish within one month of restarting, it costs you just ${monthly(d)} for that one month.` : ''}`,
      d.weekPlan.length ? { list: d.weekPlan } : '',
      'At the end: your verifiable certificate, a link employers can check, and access to internship openings.',
    ]),
    button: { label: restartLabel(d), url: d.resumeCheckoutUrl },
  }),
})

export const R4 = lifecycleEmail({
  id: 'R4',
  kind: 'marketing',
  track: 'R',
  stepId: 'R4',
  subject: (d) => (d.joinedOnScholarship ? `Your ${monthly(d)} rate is still here` : `${d.programme} is still waiting`),
  preheader: () => 'Even if the scholarship window is closed.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      d.joinedOnScholarship
        ? `Quick reminder: because you joined during the Access Scholarship, your rate is locked at ${monthly(d)}. That's true even when the scholarship window is closed and new learners pay ${d.standardMonthlyPrice ? `${naira(d.standardMonthlyPrice)} a month` : naira(d.standardPrice)}.`
        : `Quick reminder: your ${d.programme} progress is saved, and you can pick it up whenever you're ready.`,
      `Your ${d.programme} progress (${d.progressPercent}%) is saved and waiting.`,
    ]),
    button: { label: restartLabel(d), url: d.resumeCheckoutUrl },
  }),
})

/** R5 repeats every 30 days while they're engaged, rotating three versions. */
export const R5 = lifecycleEmail({
  id: 'R5',
  kind: 'marketing',
  track: 'R',
  stepId: 'R5',
  subject: (d) => [`Ready to finish ${d.programme}?`, 'One skill, finished', 'Should I stop emailing you?'][d.occurrence % 3] as string,
  preheader: (d) => ['Your progress is saved.', 'What finishing changes.', 'One tap either way.'][d.occurrence % 3] as string,
  body: (d) => {
    const variant = d.occurrence % 3
    if (variant === 2) {
      return {
        blocks: blocks([
          `Hi ${d.firstName},`,
          `I don't want to fill your inbox. If you still want to finish ${d.programme}, tap below. If not, use "Email preferences" at the bottom of this email and turn off offers, and I won't mention it again.`,
          d.joinedOnScholarship ? `Your rate is still ${monthly(d)}.` : '',
        ]),
        button: { label: 'I still want to finish', url: d.resumeCheckoutUrl },
      }
    }
    if (variant === 1) {
      return {
        blocks: blocks([
          `Hi ${d.firstName},`,
          'A half-finished course is hard to put on a CV. A finished one, with a certificate an employer can check, is something you can point to.',
          `You're ${d.progressPercent}% of the way there. Restart, give it about 8 hours a week, and finish.${lockSentence(d)}`,
          'Then claim your certificate and unlock internship openings.',
        ]),
        button: { label: restartLabel(d), url: d.resumeCheckoutUrl },
      }
    }
    return {
      blocks: blocks([
        `Hi ${d.firstName},`,
        `You're ${d.progressPercent}% through ${d.programme}, and your progress is saved.${lockSentence(d)}`,
        'When you finish, your certificate gives you a link employers can check and access to internship openings.',
      ]),
      button: { label: restartLabel(d), url: d.resumeCheckoutUrl },
    }
  },
})

/** Track C: finished, no certificate yet. */

export const C1 = lifecycleEmail({
  id: 'C1',
  kind: 'marketing',
  track: 'C',
  stepId: 'C1',
  subject: () => 'What an employer sees when they click',
  preheader: () => 'Your certificate link, explained.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `When you put "${d.programme}, SkillsAir" on your CV, an employer's first thought is: "Can I check that?"`,
      'With your SkillsAir certificate, they can. They click your link and see your name, the programme, the date you finished and a unique certificate number. No PDFs that anyone could edit.',
      `You've done the hard part. Claiming it is ${certificate(d)}, once, and it's yours for good.`,
    ]),
    button: { label: 'Claim my certificate', url: d.certificateCheckoutUrl },
  }),
})

export const C2 = lifecycleEmail({
  id: 'C2',
  kind: 'marketing',
  track: 'C',
  stepId: 'C2',
  subject: () => 'Your certificate unlocks 3 things',
  preheader: () => 'Internships, laptop support and a link employers trust.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      "Your certificate isn't just paper. Here's what it opens up:",
      {
        ordered: true,
        list: [
          'Internship openings from our partner firms, for certified graduates only. The network is new and growing.',
          'Laptop support: each cohort, 2 laptops go to certified graduates who need one most.',
          'A verification link for LinkedIn and your CV.',
        ],
      },
      `It's ${certificate(d)}, once.`,
    ]),
    button: { label: 'Claim my certificate', url: d.certificateCheckoutUrl },
  }),
})

export const C2L = lifecycleEmail({
  id: 'C2L',
  kind: 'marketing',
  track: 'C',
  stepId: 'C2L',
  subject: (d) => `Laptop applications close ${d.laptopDeadline}`,
  preheader: () => 'You need your certificate to apply.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `Applications for this cohort's laptop support close on ${d.laptopDeadline}. Only certified graduates can apply, and 2 laptops go to those who need one most.`,
      `Claim your certificate (${certificate(d)}) first, then apply from your dashboard with your story.`,
    ]),
    button: { label: 'Claim my certificate', url: d.certificateCheckoutUrl },
  }),
})

export const C3 = lifecycleEmail({
  id: 'C3',
  kind: 'marketing',
  track: 'C',
  stepId: 'C3',
  subject: (d) => `Is the certificate worth ${certificate(d)}?`,
  preheader: () => 'An honest answer.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      "Fair question. Here's my honest answer.",
      'If you only wanted the skill, you already have it. Well done.',
      "But if you want to use it to get an internship, a job or clients, you'll be asked to prove it. The certificate is how you prove it, in one link. It's also required for internship openings and laptop support.",
      proofSlot(d),
      `${certificate(d)} once, against what a first role or a few freelance clients could pay you. That's the trade.`,
    ]),
    button: { label: 'Claim my certificate', url: d.certificateCheckoutUrl },
  }),
})

export const C4 = lifecycleEmail({
  id: 'C4',
  kind: 'marketing',
  track: 'C',
  stepId: 'C4',
  subject: (d) => `Your ${d.programme} certificate is waiting`,
  preheader: () => 'Claim it whenever you’re ready.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `A short reminder that your certificate for ${d.programme} is ready to claim for ${certificate(d)}.${d.completedOn ? ` You finished the programme on ${d.completedOn}; the certificate will show that date.` : ''}`,
    ]),
    button: { label: 'Claim my certificate', url: d.certificateCheckoutUrl },
  }),
})

/** C5 repeats every 45 days (max 3), rotating C1–C3's angles with fresh subjects. */
export const C5 = lifecycleEmail({
  id: 'C5',
  kind: 'marketing',
  track: 'C',
  stepId: 'C5',
  subject: (d) => ['Still want your certificate?', 'Before you apply anywhere…', 'One link for your CV'][d.occurrence % 3] as string,
  preheader: (d) => ['It’s ready when you are.', 'Employers will ask for proof.', 'Your certificate, in one link.'][d.occurrence % 3] as string,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      [
        `Your ${d.programme} certificate is still waiting. When you claim it (${certificate(d)}), you get a link employers can check, plus access to internship openings and laptop support applications.`,
        `Before you apply for an internship or a job with your ${d.programme} skills, claim your certificate (${certificate(d)}). It's how an employer checks your skills in one click, and it's required for internship openings.`,
        `One link on your CV: your verified ${d.programme} certificate. It's ${certificate(d)}, once, and it's yours for good.`,
      ][d.occurrence % 3] as string,
    ]),
    button: { label: 'Claim my certificate', url: d.certificateCheckoutUrl },
  }),
})

/**
 * Track G: certified graduates, next programme. Owner's rule: the ₦2,000-a-month rate applies to
 * a new programme only within 3 days of finishing (that offer is in T8), so these emails quote
 * the price of the day: the scholarship price while a window is open, otherwise the standard fee.
 */

const nextTitle = (d: MessageData) => d.nextProgramme?.title ?? 'your next programme'
const nextUrl = (d: MessageData) => d.nextProgramme?.url ?? d.dashboardUrl
const priceToday = (d: MessageData) =>
  d.windowOpen
    ? `While the Access Scholarship is open (until ${d.closesOn}), it's ${monthly(d)}.`
    : `Right now it's the standard fee, ${standardFee(d)}, or you can wait for the next Access Scholarship window.`

export const G1 = lifecycleEmail({
  id: 'G1',
  kind: 'marketing',
  track: 'G',
  stepId: 'G1',
  subject: (d) => `What to learn after ${d.programme}`,
  preheader: () => 'The skills that pair best with yours.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `Now that you're certified in ${d.programme}, a question I get a lot is: "What should I learn next?"`,
      `The answer is usually the skill that makes your first one more valuable. For ${d.programme}, that's ${nextTitle(d)}.${d.nextProgramme?.pairingReason ? ` ${d.nextProgramme.pairingReason}` : ''}`,
      'No pressure. Just something to think about while you use your new certificate.',
    ]),
    button: { label: `See ${nextTitle(d)}`, url: nextUrl(d) },
  }),
})

export const G2 = lifecycleEmail({
  id: 'G2',
  kind: 'marketing',
  track: 'G',
  stepId: 'G2',
  subject: () => 'Two certificates beat one',
  preheader: (d) => `${nextTitle(d)}, at your own pace.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `One skill can get you noticed. Two make you hard to ignore. ${nextTitle(d)} is ${'designed to take about 3 months at about 8 hours a week'}, like ${d.programme}.`,
      priceToday(d),
      proofSlot(d),
      'Two certificates make a much stronger CV than one.',
    ]),
    button: { label: `Start ${nextTitle(d)}`, url: d.nextProgramme?.checkoutUrl ?? d.dashboardUrl },
    ps: d.windowOpen ? `The scholarship window closes ${d.closesOn} at 11:59pm.` : 'Want to hear when the next scholarship window opens? Reply "notify me" and I’ll tell you first.',
  }),
})

export const G3 = lifecycleEmail({
  id: 'G3',
  kind: 'marketing',
  track: 'G',
  stepId: 'G3',
  subject: () => 'Your next skill, one step at a time',
  preheader: (d) => `How ${nextTitle(d)} builds on what you know.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `You already proved you can finish a programme. That's the habit most people never build.`,
      `The plan is simple: start ${nextTitle(d)}, give it about 8 hours a week, and add a second verified certificate to your CV.${d.nextProgramme?.pairingReason ? ` ${d.nextProgramme.pairingReason}` : ''}`,
      priceToday(d),
    ]),
    button: { label: `Start ${nextTitle(d)}`, url: d.nextProgramme?.checkoutUrl ?? d.dashboardUrl },
  }),
})

/** G4 repeats monthly (max 4): three value emails, then the offer again (StoryBrand 3:1). */
export const G4 = lifecycleEmail({
  id: 'G4',
  kind: 'marketing',
  track: 'G',
  stepId: 'G4',
  subject: (d) => ['Using your certificate on LinkedIn', 'How to write about a project on your CV', 'Your first freelance client', 'Ready for your next certificate?'][d.occurrence % 4] as string,
  preheader: () => 'A 2-minute read.',
  body: (d) => {
    const variant = d.occurrence % 4
    const value = [
      [
        'Add your certificate under "Licenses & certifications" with its verification link, then write a short post about one thing you built while learning. Recruiters search for skills, and a post with a real example gets noticed far more than a line on a profile.',
      ],
      [
        'Pick one project from your programme. Write three lines: the problem, what you did, and the result. Put the verification link next to it. That beats a long list of skills every time.',
      ],
      [
        'Your free Freelancing course in the dashboard walks through finding a first client. Start small: one person you know who needs the skill you just learned. A finished, paid job is the best proof there is.',
      ],
    ]
    if (variant < 3) {
      return {
        blocks: blocks([`Hi ${d.firstName},`, ...(value[variant] as string[])]),
        button: { label: 'Go to my dashboard', url: d.dashboardUrl },
      }
    }
    return {
      blocks: blocks([`Hi ${d.firstName},`, `When you're ready for a second skill, ${nextTitle(d)} pairs well with ${d.programme}.`, priceToday(d)]),
      button: { label: `See ${nextTitle(d)}`, url: nextUrl(d) },
    }
  },
})

export const TRACK_I_R_C_G = [I0, I1, I2, I3, R1, R2, R3, R4, R5, C1, C2, C2L, C3, C4, C5, G1, G2, G3, G4]
