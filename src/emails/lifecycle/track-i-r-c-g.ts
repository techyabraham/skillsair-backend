import { lines } from '../define.js'
import { blocks, certificateCta, designed, examNote, greeting, lifecycleEmail, naira, phrases, priceToday, proofSlot, restartLabel } from './shared.js'
import type { MessageData } from '../../lib/lifecycle/context.js'

/** Track I: learning nudges (service). No selling: only the next lesson, and an honest word about renewals. */

export const I0 = lifecycleEmail({
  id: 'I0',
  kind: 'service',
  track: 'I',
  stepId: 'I0',
  copy: {
    subject: { label: 'Subject (lesson length known)', kind: 'subject', default: 'Your first lesson takes {{lesson1Minutes}} minutes' },
    subjectNoMinutes: { label: 'Subject (lesson length unknown)', kind: 'subject', default: 'Your first lesson is ready' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'The hardest part is pressing play.' },
    notStarted: { label: 'Opening line', default: "You've paid for {{programme}}, but you haven't started yet. That's normal. Starting is the hardest part." },
    lessonTimed: { label: 'Lesson 1 (title and length known)', default: 'Lesson 1, "{{lesson1Title}}", takes about {{lesson1Minutes}} minutes. Do it now, before you close this email.' },
    lessonTitled: { label: 'Lesson 1 (title known)', default: 'Lesson 1, "{{lesson1Title}}" is short. Do it now, before you close this email.' },
    lessonShort: { label: 'Lesson 1 (no title)', default: 'Lesson 1 is short. Do it now, before you close this email.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Start lesson 1' },
  },
  subject: (d, c) => (d.lesson1Minutes ? c.subject() : c.subjectNoMinutes()),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.notStarted(), d.lesson1Title ? (d.lesson1Minutes ? c.lessonTimed() : c.lessonTitled()) : c.lessonShort()]),
    button: { label: c.ctaLabel(), url: d.firstLessonUrl },
  }),
})

export const I1 = lifecycleEmail({
  id: 'I1',
  kind: 'service',
  track: 'I',
  stepId: 'I1',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Pick up where you stopped?' },
    preheader: { label: 'Preview text (next lesson known)', kind: 'preheader', default: 'Next up: "{{nextLessonTitle}}".' },
    preheaderNoLesson: { label: 'Preview text (next lesson unknown)', kind: 'preheader', default: 'Your next lesson is waiting.' },
    gap: { label: 'Opening line', default: "It's been a few days since your last lesson in {{programme}}. Life happens, I know." },
    progress: { label: 'Progress (next lesson known)', default: 'You\'re {{progressPercent}}% through. Your next lesson is "{{nextLessonTitle}}". Can you give it 20 minutes today?' },
    progressNoLesson: { label: 'Progress (next lesson unknown)', default: "You're {{progressPercent}}% through. Can you give it 20 minutes today?" },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Continue learning' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (d, c) => (d.nextLessonTitle ? c.preheader() : c.preheaderNoLesson()),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.gap(), d.nextLessonTitle ? c.progress() : c.progressNoLesson()]),
    button: { label: c.ctaLabel(), url: d.resumeUrl },
  }),
})

export const I2 = lifecycleEmail({
  id: 'I2',
  kind: 'service',
  track: 'I',
  stepId: 'I2',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Is something in the way?' },
    preheader: { label: 'Preview text', kind: 'preheader', default: "Reply with one number and I'll help." },
    intro: {
      label: 'Opening line',
      default: "You haven't been back to {{programme}} for about 10 days. Usually it's one of these. Reply with the number that fits and I'll help:",
    },
    reasonsList: { label: 'Reasons (one per line)', kind: 'list', default: ['No time', 'Stuck on a lesson', 'Not sure it’s for me', 'Something else'].join('\n') },
    saved: { label: 'Progress saved', default: 'Your progress is saved: {{progressPercent}}% done.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Continue learning' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), { ordered: true, list: lines(c.reasonsList()) }, c.saved()]),
    button: { label: c.ctaLabel(), url: d.resumeUrl },
  }),
})

export const I3 = lifecycleEmail({
  id: 'I3',
  kind: 'service',
  track: 'I',
  stepId: 'I3',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: '20 minutes this week?' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Small steps still get you there.' },
    short: {
      label: 'Opening line',
      default: "I'll keep this short. You don't need a perfect week to make progress. One 20-minute session keeps {{programme}} alive in your head.",
    },
    lessonsLeft: { label: 'Lessons left', default: 'You have {{lessonsLeft}} lessons to go.' },
    renewalLocked: {
      label: 'Renewal soon, joined on the scholarship (the billing link follows)',
      default: "Your plan renews on {{chargeDate}}. If you can't study right now, it's fine to cancel and come back later at the same {{monthly}} rate:",
    },
    renewal: { label: 'Renewal soon (the billing link follows)', default: "Your plan renews on {{chargeDate}}. If you can't study right now, it's fine to cancel and come back later:" },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Continue learning' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.short(),
      d.lessonsLeft ? c.lessonsLeft() : '',
      // Honest about paying for access they're not using.
      d.renewalSoon && d.chargeDate ? `${d.joinedOnScholarship ? c.renewalLocked() : c.renewal()} ${d.billingUrl}` : '',
    ]),
    button: { label: c.ctaLabel(), url: d.resumeUrl },
  }),
})

/** Track R: lapsed before finishing. Every message offers the locked ₦2,000 a month (no deadline). */

/** " Your rate is locked at ₦2,000 a month." for scholarship joiners (appended to a sentence). */
const lockSentence = (d: MessageData) => (d.joinedOnScholarship ? ` ${phrases(d).rateLocked()}` : '')

export const R1 = lifecycleEmail({
  id: 'R1',
  kind: 'marketing',
  track: 'R',
  stepId: 'R1',
  copy: {
    subject: { label: 'Subject (lessons left known)', kind: 'subject', default: '{{lessonsLeft}} lessons to go, {{firstName}}' },
    subjectNoLessons: { label: 'Subject (lessons left unknown)', kind: 'subject', default: 'Your progress is waiting, {{firstName}}' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Your progress in {{programme}} is saved.' },
    paused: {
      label: 'Opening line',
      default: "You were {{progressPercent}}% of the way through {{programme}} when your access paused. That's real progress, and it's all still saved.",
    },
    restart: { label: 'Restart (next lesson known)', default: 'Restart today and you\'ll pick up exactly at "{{nextLessonTitle}}".' },
    restartNoLesson: { label: 'Restart (next lesson unknown)', default: "Restart today and you'll pick up exactly where you stopped." },
  },
  subject: (d, c) => (d.lessonsLeft ? c.subject() : c.subjectNoLessons()),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.paused(), `${d.nextLessonTitle ? c.restart() : c.restartNoLesson()}${lockSentence(d)}`]),
    button: { label: restartLabel(d), url: d.resumeCheckoutUrl },
  }),
})

export const R2 = lifecycleEmail({
  id: 'R2',
  kind: 'marketing',
  track: 'R',
  stepId: 'R2',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Can I ask what happened?' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'One-line reply. I read every one.' },
    ask: {
      label: 'Opening line',
      default: "Your {{programme}} access has been paused for a week. I'd like to know why, so we can do better. Was it money, time, or the programme itself?",
    },
    reply: { label: 'Reply ask', default: 'Just reply with one word.' },
    moneyLocked: { label: 'If it was money (joined on the scholarship)', default: "And if it was money: your {{monthly}} rate never expires. Come back whenever you're ready." },
    money: { label: 'If it was money (standard fee)', default: 'And if it was money, tell me. I may be able to help you find a way back.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Restart my programme' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.ask(), c.reply(), d.joinedOnScholarship ? c.moneyLocked() : c.money()]),
    button: { label: c.ctaLabel(), url: d.resumeCheckoutUrl },
  }),
})

export const R3 = lifecycleEmail({
  id: 'R3',
  kind: 'marketing',
  track: 'R',
  stepId: 'R3',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'How to finish {{programme}} in {{weeks}}' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'A simple plan for the {{lessonsLeft}} lessons left.' },
    intro: { label: 'Opening line', default: "Starting again after a break feels harder than starting the first time. So here's a simple plan." },
    left: { label: 'Lessons left', default: "You have {{lessonsLeft}} lessons left. At about 8 hours a week, that's around {{weeks}}." },
    oneMonth: {
      label: 'One month at the locked rate (4 weeks or less)',
      default: 'If you finish within one month of restarting, it costs you just {{monthly}} for that one month.',
    },
    end: { label: 'At the end', default: 'At the end: your verifiable certificate, a link employers can check, and access to internship openings.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.intro(),
      `${c.left()}${d.joinedOnScholarship && d.weeksLeft <= 4 ? ` ${c.oneMonth()}` : ''}`,
      d.weekPlan.length ? { list: d.weekPlan } : '',
      c.end(),
    ]),
    button: { label: restartLabel(d), url: d.resumeCheckoutUrl },
  }),
})

export const R4 = lifecycleEmail({
  id: 'R4',
  kind: 'marketing',
  track: 'R',
  stepId: 'R4',
  copy: {
    subject: { label: 'Subject (joined on the scholarship)', kind: 'subject', default: 'Your {{monthly}} rate is still here' },
    subjectPlain: { label: 'Subject (standard fee)', kind: 'subject', default: '{{programme}} is still waiting' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Even if the scholarship window is closed.' },
    reminderLocked: {
      label: 'Reminder (joined on the scholarship)',
      default: "Quick reminder: because you joined during the Access Scholarship, your rate is locked at {{monthly}}. That's true even when the scholarship window is closed and new learners pay {{newLearnerPrice}}.",
      vars: { newLearnerPrice: 'What new learners pay, e.g. ₦40,000 a month (or the full fee)' },
    },
    newLearnerMonthly: { label: 'What new learners pay (monthly fee)', default: '{{standardMonthly}} a month', help: 'Used when the programme has a monthly standard fee; otherwise the full fee is shown.' },
    reminderPlain: { label: 'Reminder (standard fee)', default: "Quick reminder: your {{programme}} progress is saved, and you can pick it up whenever you're ready." },
    saved: { label: 'Progress saved', default: 'Your {{programme}} progress ({{progressPercent}}%) is saved and waiting.' },
  },
  subject: (d, c) => (d.joinedOnScholarship ? c.subject() : c.subjectPlain()),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      d.joinedOnScholarship ? c.reminderLocked({ newLearnerPrice: d.standardMonthlyPrice ? c.newLearnerMonthly() : naira(d.standardPrice) }) : c.reminderPlain(),
      c.saved(),
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
  copy: {
    subject: { label: 'Subject (version 1)', kind: 'subject', default: 'Ready to finish {{programme}}?' },
    subject2: { label: 'Subject (version 2)', kind: 'subject', default: 'One skill, finished' },
    subject3: { label: 'Subject (version 3)', kind: 'subject', default: 'Should I stop emailing you?' },
    preheader: { label: 'Preview text (version 1)', kind: 'preheader', default: 'Your progress is saved.' },
    preheader2: { label: 'Preview text (version 2)', kind: 'preheader', default: 'What finishing changes.' },
    preheader3: { label: 'Preview text (version 3)', kind: 'preheader', default: 'One tap either way.' },
    saved: { label: 'Version 1: progress', default: "You're {{progressPercent}}% through {{programme}}, and your progress is saved." },
    whenFinish: { label: 'Version 1: when you finish', default: 'When you finish, your certificate gives you a link employers can check and access to internship openings.' },
    cv: { label: 'Version 2: opening', default: 'A half-finished course is hard to put on a CV. A finished one, with a certificate an employer can check, is something you can point to.' },
    way: { label: 'Version 2: the way there', default: "You're {{progressPercent}}% of the way there. Restart, give it about 8 hours a week, and finish." },
    then: { label: 'Version 2: then', default: 'Then earn your certificate and unlock internship openings.' },
    stopAsk: {
      label: 'Version 3: should I stop?',
      default:
        'I don\'t want to fill your inbox. If you still want to finish {{programme}}, tap below. If not, use "Email preferences" at the bottom of this email and turn off offers, and I won\'t mention it again.',
    },
    rateStill: { label: 'Version 3: rate (joined on the scholarship)', default: 'Your rate is still {{monthly}}.' },
    stillCta: { label: 'Version 3: button', kind: 'button', default: 'I still want to finish' },
  },
  subject: (d, c) => [c.subject, c.subject2, c.subject3][d.occurrence % 3]!(),
  preheader: (d, c) => [c.preheader, c.preheader2, c.preheader3][d.occurrence % 3]!(),
  body: (d, c) => {
    const variant = d.occurrence % 3
    if (variant === 2) {
      return {
        blocks: blocks([greeting(d), c.stopAsk(), d.joinedOnScholarship ? c.rateStill() : '']),
        button: { label: c.stillCta(), url: d.resumeCheckoutUrl },
      }
    }
    if (variant === 1) {
      return {
        blocks: blocks([greeting(d), c.cv(), `${c.way()}${lockSentence(d)}`, c.then()]),
        button: { label: restartLabel(d), url: d.resumeCheckoutUrl },
      }
    }
    return {
      blocks: blocks([greeting(d), `${c.saved()}${lockSentence(d)}`, c.whenFinish()]),
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
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'What an employer sees when they click' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Your certificate link, explained.' },
    cvLine: { label: 'Opening line', default: 'When you put "{{programme}}, SkillsAir" on your CV, an employer\'s first thought is: "Can I check that?"' },
    canCheck: {
      label: 'What they see',
      default: 'With your SkillsAir certificate, they can. They click your link and see your name, the programme, the date you finished and a unique certificate number. No PDFs that anyone could edit.',
    },
    claim: { label: 'The price', default: "You've done the hard part. Claiming it is {{certificatePrice}}, once, and it's yours for good." },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.cvLine(), c.canCheck(), c.claim(), examNote(d)]),
    button: { label: certificateCta(d), url: d.certificateCheckoutUrl },
  }),
})

export const C2 = lifecycleEmail({
  id: 'C2',
  kind: 'marketing',
  track: 'C',
  stepId: 'C2',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your certificate unlocks 3 things' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Internships, laptop support and a link employers trust.' },
    intro: { label: 'Opening line', default: "Your certificate isn't just paper. Here's what it opens up:" },
    unlocksList: {
      label: 'What it unlocks (one per line)',
      kind: 'list',
      default: [
        'Internship openings from our partner firms, for certified graduates only. The network is new and growing.',
        'Laptop support: each cohort, 2 laptops go to certified graduates who need one most.',
        'A verification link for LinkedIn and your CV.',
      ].join('\n'),
    },
    price: { label: 'The price', default: "It's {{certificatePrice}}, once." },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro(), { ordered: true, list: lines(c.unlocksList()) }, c.price(), examNote(d)]),
    button: { label: certificateCta(d), url: d.certificateCheckoutUrl },
  }),
})

export const C2L = lifecycleEmail({
  id: 'C2L',
  kind: 'marketing',
  track: 'C',
  stepId: 'C2L',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Laptop applications close {{laptopDeadline}}' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'You need your certificate to apply.' },
    closes: {
      label: 'Opening line',
      default: "Applications for this cohort's laptop support close on {{laptopDeadline}}. Only certified graduates can apply, and 2 laptops go to those who need one most.",
    },
    first: { label: 'Certificate first', default: 'Get your certificate ({{certificatePrice}}) first, then apply from your dashboard with your story.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.closes(), c.first()]),
    button: { label: certificateCta(d), url: d.certificateCheckoutUrl },
  }),
})

export const C3 = lifecycleEmail({
  id: 'C3',
  kind: 'marketing',
  track: 'C',
  stepId: 'C3',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Is the certificate worth {{certificatePrice}}?' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'An honest answer.' },
    fair: { label: 'Opening line', default: "Fair question. Here's my honest answer." },
    skill: { label: 'You have the skill', default: 'If you only wanted the skill, you already have it. Well done.' },
    prove: {
      label: 'Why prove it',
      default:
        "But if you want to use it to get an internship, a job or clients, you'll be asked to prove it. The certificate is how you prove it, in one link. It's also required for internship openings and laptop support.",
    },
    trade: { label: 'The trade', default: "{{certificatePrice}} once, against what a first role or a few freelance clients could pay you. That's the trade." },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.fair(), c.skill(), c.prove(), proofSlot(d), c.trade()]),
    button: { label: certificateCta(d), url: d.certificateCheckoutUrl },
  }),
})

export const C4 = lifecycleEmail({
  id: 'C4',
  kind: 'marketing',
  track: 'C',
  stepId: 'C4',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your {{programme}} certificate is waiting' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Claim it whenever you’re ready.' },
    reminder: { label: 'Opening line', default: 'A short reminder that your certificate for {{programme}} is ready to claim for {{certificatePrice}}.' },
    finishedOn: { label: 'Finish date (when known)', default: 'You finished the programme on {{completedOn}}; the certificate will show that date.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), `${c.reminder()}${d.completedOn ? ` ${c.finishedOn()}` : ''}`, examNote(d)]),
    button: { label: certificateCta(d), url: d.certificateCheckoutUrl },
  }),
})

/** C5 repeats every 45 days (max 3), rotating C1–C3's angles with fresh subjects. */
export const C5 = lifecycleEmail({
  id: 'C5',
  kind: 'marketing',
  track: 'C',
  stepId: 'C5',
  copy: {
    subject: { label: 'Subject (version 1)', kind: 'subject', default: 'Still want your certificate?' },
    subject2: { label: 'Subject (version 2)', kind: 'subject', default: 'Before you apply anywhere…' },
    subject3: { label: 'Subject (version 3)', kind: 'subject', default: 'One link for your CV' },
    preheader: { label: 'Preview text (version 1)', kind: 'preheader', default: 'It’s ready when you are.' },
    preheader2: { label: 'Preview text (version 2)', kind: 'preheader', default: 'Employers will ask for proof.' },
    preheader3: { label: 'Preview text (version 3)', kind: 'preheader', default: 'Your certificate, in one link.' },
    body1Exam: {
      label: 'Version 1 (with a final exam)',
      default:
        'Your {{programme}} certificate is still waiting. Get it ({{certificatePrice}}, which covers your final exam and any retakes) and you get a link employers can check, plus access to internship openings and laptop support applications.',
    },
    body1: {
      label: 'Version 1 (no final exam)',
      default:
        'Your {{programme}} certificate is still waiting. Get it ({{certificatePrice}}) and you get a link employers can check, plus access to internship openings and laptop support applications.',
    },
    body2: {
      label: 'Version 2',
      default:
        "Before you apply for an internship or a job with your {{programme}} skills, get your certificate ({{certificatePrice}}). It's how an employer checks your skills in one click, and it's required for internship openings.",
    },
    body3: { label: 'Version 3', default: "One link on your CV: your verified {{programme}} certificate. It's {{certificatePrice}}, once, and it's yours for good." },
  },
  subject: (d, c) => [c.subject, c.subject2, c.subject3][d.occurrence % 3]!(),
  preheader: (d, c) => [c.preheader, c.preheader2, c.preheader3][d.occurrence % 3]!(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), [d.hasFinalExam ? c.body1Exam : c.body1, c.body2, c.body3][d.occurrence % 3]!()]),
    button: { label: certificateCta(d), url: d.certificateCheckoutUrl },
  }),
})

/**
 * Track G: certified graduates, next programme. Owner's rule: the ₦2,000-a-month rate applies to
 * a new programme only within 3 days of finishing (that offer is in T8), so these emails quote
 * the price of the day: the scholarship price while a window is open, otherwise the standard fee.
 */

const nextUrl = (d: MessageData) => d.nextProgramme?.url ?? d.dashboardUrl
const withReason = (sentence: string, d: MessageData) => `${sentence}${d.nextProgramme?.pairingReason ? ` ${d.nextProgramme.pairingReason}` : ''}`

export const G1 = lifecycleEmail({
  id: 'G1',
  kind: 'marketing',
  track: 'G',
  stepId: 'G1',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'What to learn after {{programme}}' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'The skills that pair best with yours.' },
    question: { label: 'Opening line', default: 'Now that you\'re certified in {{programme}}, a question I get a lot is: "What should I learn next?"' },
    answer: {
      label: 'The answer',
      default: "The answer is usually the skill that makes your first one more valuable. For {{programme}}, that's {{nextProgrammeTitle}}.",
      help: 'The programme’s pairing reason (Courses → next programmes) follows when there is one.',
    },
    noPressure: { label: 'Closing line', default: 'No pressure. Just something to think about while you use your new certificate.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'See {{nextProgrammeTitle}}' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.question(), withReason(c.answer(), d), c.noPressure()]),
    button: { label: c.ctaLabel(), url: nextUrl(d) },
  }),
})

export const G2 = lifecycleEmail({
  id: 'G2',
  kind: 'marketing',
  track: 'G',
  stepId: 'G2',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Two certificates beat one' },
    preheader: { label: 'Preview text', kind: 'preheader', default: '{{nextProgrammeTitle}}, with a guided 12-week plan.' },
    intro: {
      label: 'Opening line',
      default: 'One skill can get you noticed. Two make you hard to ignore. {{nextProgrammeTitle}} is {{designed}}, like {{programme}}.',
      vars: { designed: 'How long a programme takes (the shared phrase)' },
    },
    stronger: { label: 'Closing line', default: 'Two certificates make a much stronger CV than one.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Start {{nextProgrammeTitle}}' },
    ps: { label: 'P.S. (window open)', kind: 'ps', default: 'The scholarship window closes {{closesOn}} at 11:59pm.' },
    psClosed: { label: 'P.S. (window closed)', kind: 'ps', default: 'Want to hear when the next scholarship window opens? Reply "notify me" and I’ll tell you first.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.intro({ designed: designed(d) }), priceToday(d), proofSlot(d), c.stronger()]),
    button: { label: c.ctaLabel(), url: d.nextProgramme?.checkoutUrl ?? d.dashboardUrl },
    ps: d.windowOpen ? c.ps() : c.psClosed(),
  }),
})

export const G3 = lifecycleEmail({
  id: 'G3',
  kind: 'marketing',
  track: 'G',
  stepId: 'G3',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your next skill, one step at a time' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'How {{nextProgrammeTitle}} builds on what you know.' },
    proved: { label: 'Opening line', default: "You already proved you can finish a programme. That's the habit most people never build." },
    plan: {
      label: 'The plan',
      default: 'The plan is simple: start {{nextProgrammeTitle}}, give it about 8 hours a week, and add a second verified certificate to your CV.',
      help: 'The programme’s pairing reason follows when there is one.',
    },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Start {{nextProgrammeTitle}}' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.proved(), withReason(c.plan(), d), priceToday(d)]),
    button: { label: c.ctaLabel(), url: d.nextProgramme?.checkoutUrl ?? d.dashboardUrl },
  }),
})

/** G4 repeats monthly (max 4): three value emails, then the offer again (StoryBrand 3:1). */
export const G4 = lifecycleEmail({
  id: 'G4',
  kind: 'marketing',
  track: 'G',
  stepId: 'G4',
  copy: {
    subject: { label: 'Subject (1st send)', kind: 'subject', default: 'Using your certificate on LinkedIn' },
    subject2: { label: 'Subject (2nd send)', kind: 'subject', default: 'How to write about a project on your CV' },
    subject3: { label: 'Subject (3rd send)', kind: 'subject', default: 'Your first freelance client' },
    subject4: { label: 'Subject (4th send)', kind: 'subject', default: 'Ready for your next certificate?' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'A 2-minute read.' },
    tip1: {
      label: '1st send: LinkedIn tip',
      default:
        'Add your certificate under "Licenses & certifications" with its verification link, then write a short post about one thing you built while learning. Recruiters search for skills, and a post with a real example gets noticed far more than a line on a profile.',
      help: '"Licenses & certifications" is LinkedIn’s own section name, so it keeps the American spelling.',
    },
    tip2: {
      label: '2nd send: CV tip',
      default: 'Pick one project from your programme. Write three lines: the problem, what you did, and the result. Put the verification link next to it. That beats a long list of skills every time.',
    },
    tip3: {
      label: '3rd send: freelancing tip',
      default:
        'Your free Freelancing course in the dashboard walks through finding a first client. Start small: one person you know who needs the skill you just learned. A finished, paid job is the best proof there is.',
    },
    dashboardCta: { label: '1st–3rd send: button', kind: 'button', default: 'Go to my dashboard' },
    offer: { label: '4th send: next programme', default: "When you're ready for a second skill, {{nextProgrammeTitle}} pairs well with {{programme}}." },
    offerCta: { label: '4th send: button', kind: 'button', default: 'See {{nextProgrammeTitle}}' },
  },
  subject: (d, c) => [c.subject, c.subject2, c.subject3, c.subject4][d.occurrence % 4]!(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => {
    const variant = d.occurrence % 4
    if (variant < 3) {
      return {
        blocks: blocks([greeting(d), [c.tip1, c.tip2, c.tip3][variant]!()]),
        button: { label: c.dashboardCta(), url: d.dashboardUrl },
      }
    }
    return {
      blocks: blocks([greeting(d), c.offer(), priceToday(d)]),
      button: { label: c.offerCta(), url: nextUrl(d) },
    }
  },
})

export const TRACK_I_R_C_G = [I0, I1, I2, I3, R1, R2, R3, R4, R5, C1, C2, C2L, C3, C4, C5, G1, G2, G3, G4]
