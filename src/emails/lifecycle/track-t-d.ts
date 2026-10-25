import { lines } from '../define.js'
import { blocks, certificateCta, greeting, LOCK_LINE, lifecycleEmail, naira, progressLine, receiptHeading, restartLabel } from './shared.js'
import type { MessageData } from '../../lib/lifecycle/context.js'
import type { Block } from '../layout.js'

/** Track T: transactional (never capped). Track D: failed renewal (Paystack doesn't retry). */

/** Receipt rows are data (amounts, references, dates), so they stay in code. */
function receipt(d: MessageData, extra: Array<{ label: string; value: string }> = []): Block {
  return {
    rows: [
      { label: 'Amount', value: naira(d.amount) },
      ...(d.reference ? [{ label: 'Reference', value: d.reference }] : []),
      { label: 'Date', value: d.paidAt },
      ...extra,
      { label: 'Paid to', value: 'SKILLS AIR LIMITED (RC 9272398)' },
    ],
  }
}

/** Joins sentences that may be empty with one space. */
const sentences = (...parts: string[]) => parts.filter(Boolean).join(' ')

const LOCK_VAR = { lockLine: 'The shared locked-rate sentence' }

export const T1 = lifecycleEmail({
  id: 'T1',
  kind: 'transactional',
  track: 'T',
  stepId: 'T1',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: "You're in, {{firstName}} 🎉" },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Your {{programme}} seat is confirmed. Start with lesson 1.' },
    intro: { label: 'Opening line', default: 'Welcome to SkillsAir. Your seat in {{programme}} is confirmed.' },
    firstThings: { label: 'Before the list', default: 'Three things to do first:' },
    firstList: {
      label: 'First things (one per line)',
      kind: 'list',
      default: ["Watch lesson 1 today, while you're excited.", 'Block out about 8 hours a week. Put it in your calendar.', "Open your free CV & LinkedIn course. It's in your dashboard."].join('\n'),
    },
    planManual: {
      label: 'Their plan (locked rate, pays by transfer or OPay)',
      default:
        "Your plan: {{monthly}}, paid month by month by bank transfer or OPay until you finish. This payment covers you until {{periodEnd}}. We'll remind you a few days before, and you pay the next month the same way. {{lockLine}} You can cancel anytime from your dashboard.",
      vars: LOCK_VAR,
    },
    planCard: {
      label: 'Their plan (locked rate, card, billing day known)',
      default: 'Your plan: {{monthly}}, billed to your card on the {{billingDay}} of each month until you finish. {{lockLine}} You can cancel anytime from your dashboard.',
      vars: LOCK_VAR,
    },
    planCardNoDay: {
      label: 'Their plan (locked rate, card, no billing day yet)',
      default: 'Your plan: {{monthly}}, billed to your card each month until you finish. {{lockLine}} You can cancel anytime from your dashboard.',
      vars: LOCK_VAR,
    },
    paidOnce: { label: 'What they paid (no locked rate)', default: "You've paid {{amount}} for {{programme}}. The certificate is optional, paid separately when you finish.", required: ['amount'] },
    questions: { label: 'Questions line', default: 'Questions? Reply here or WhatsApp me, Monday to Saturday, 9am–6pm.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Start lesson 1' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => {
    const lockLine = LOCK_LINE(d)
    return {
      blocks: blocks([
        greeting(d),
        c.intro(),
        c.firstThings(),
        { ordered: true, list: lines(c.firstList()) },
        d.priceLocked && d.manualBilling
          ? c.planManual({ lockLine })
          : d.priceLocked
            ? d.billingDay
              ? c.planCard({ lockLine })
              : c.planCardNoDay({ lockLine })
            : c.paidOnce(),
        receiptHeading(d),
        receipt(d),
        c.questions(),
      ]),
      button: { label: c.ctaLabel(), url: d.firstLessonUrl },
    }
  },
})

export const T2 = lifecycleEmail({
  id: 'T2',
  kind: 'transactional',
  track: 'T',
  stepId: 'T2',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Receipt: {{amount}} for {{programme}}', required: ['amount'] },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Month {{monthNumber}}. {{progress}}', vars: { progress: 'Their progress line, or the “keep going” line before they start' } },
    keepGoing: { label: 'Preview text before they start', default: 'Keep going.' },
    thanks: { label: 'Opening line', default: 'Thanks. Your monthly payment went through.' },
    manualNote: { label: 'Next month (pays by transfer or OPay)', default: "We'll remind you a few days before your next month is due. Pay it the same way, by bank transfer or OPay." },
    nextUp: { label: 'Next lesson', default: 'Next up: "{{nextLessonTitle}}".' },
    manage: { label: 'Small print (the billing link follows)', default: 'Manage or cancel your plan:' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Continue learning' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (d, c) => c.preheader({ progress: progressLine(d) || c.keepGoing() }),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.thanks(),
      receipt(d, [
        { label: 'Programme', value: `${d.programme} (month ${d.monthNumber})` },
        ...(d.manualBilling && d.periodEnd ? [{ label: 'Paid until', value: d.periodEnd }] : d.nextChargeDate ? [{ label: 'Next payment', value: d.nextChargeDate }] : []),
      ]),
      d.manualBilling ? c.manualNote() : '',
      sentences(progressLine(d), d.nextLessonTitle ? c.nextUp() : ''),
      { small: `${c.manage()} ${d.billingUrl}` },
    ]),
    button: { label: c.ctaLabel(), url: d.resumeUrl },
  }),
})

export const T3 = lifecycleEmail({
  id: 'T3',
  kind: 'service',
  track: 'T',
  stepId: 'T3',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: '{{amount}} renews on {{chargeDate}}', required: ['amount'] },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Make sure your card is ready.' },
    intro: { label: 'Opening line', default: "Just so it's not a surprise: your {{programme}} plan renews on {{chargeDate}} for {{amount}}.", required: ['amount'] },
    cardKnown: { label: 'Card check (last 4 digits known)', default: "Please make sure your card ending {{cardLast4}} has enough in it. If you'd like to use a different card, you can change it here." },
    cardUnknown: { label: 'Card check (card unknown)', default: "Please make sure your card has enough in it. If you'd like to use a different card, you can change it here." },
    close: { label: 'Nearly finished (80% or more)', default: "You're close. Finish this month and you won't need another renewal." },
    cancel: { label: 'Small print (the billing link follows)', default: 'Want to stop? Cancel anytime:' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Change my card' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.intro(),
      d.cardLast4 ? c.cardKnown() : c.cardUnknown(),
      sentences(progressLine(d), d.progressPercent >= 80 ? c.close() : ''),
      { small: `${c.cancel()} ${d.billingUrl}` },
    ]),
    button: { label: c.ctaLabel(), url: d.updateCardUrl },
  }),
})

export const T4 = lifecycleEmail({
  id: 'T4',
  kind: 'service',
  track: 'T',
  stepId: 'T4',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your card expires soon' },
    preheader: { label: 'Preview text', kind: 'preheader', default: "Update it so your {{programme}} access isn't paused." },
    expiring: {
      label: 'The card is expiring',
      default: "The card you use for {{programme}}{{ending}} expires {{when}}. Update it now and your learning won't be interrupted. It takes a minute.",
      vars: { ending: 'The “(ending 4081)” part, with a space before it (empty when unknown)', when: '“on 11/2026”, or “soon” when the date is unknown' },
    },
    ending: { label: 'Card ending', default: '(ending {{cardLast4}})' },
    expiresOn: { label: 'Expiry date known', default: 'on {{cardExpiry}}' },
    expiresSoon: { label: 'Expiry date unknown', default: 'soon' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Update my card' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.expiring({ ending: d.cardLast4 ? ` ${c.ending()}` : '', when: d.cardExpiry ? c.expiresOn() : c.expiresSoon() })]),
    button: { label: c.ctaLabel(), url: d.updateCardUrl },
  }),
})

export const T5 = lifecycleEmail({
  id: 'T5',
  kind: 'transactional',
  track: 'T',
  stepId: 'T5',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your plan is cancelled' },
    preheader: { label: 'Preview text (access continues)', kind: 'preheader', default: 'You still have access until {{periodEnd}}.' },
    preheaderNoAccess: { label: 'Preview text (no access left)', kind: 'preheader', default: 'You won’t be charged again.' },
    done: { label: 'Opening line', default: "Done. Your {{programme}} plan won't renew, and you won't be charged again." },
    accessUntil: { label: 'Access until', default: 'You still have full access until {{periodEnd}}, so use it.' },
    comeBack: { label: 'Coming back (joined on the scholarship)', default: "If you come back later, your rate is still {{monthly}}. It's locked because you joined during the Access Scholarship." },
    feedback: { label: 'Ask why', default: "If something made you cancel, I'd really like to know. Just reply with one line." },
    ctaLabel: { label: 'Button (access continues)', kind: 'button', default: 'Keep learning until {{periodEnd}}' },
    ctaLabelNoAccess: { label: 'Button (no access left)', kind: 'button', default: 'Go to my dashboard' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (d, c) => (d.periodEnd ? c.preheader() : c.preheaderNoAccess()),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.done(),
      d.periodEnd ? sentences(c.accessUntil(), progressLine(d)) : progressLine(d),
      d.joinedOnScholarship ? c.comeBack() : '',
      c.feedback(),
    ]),
    button: { label: d.periodEnd ? c.ctaLabel() : c.ctaLabelNoAccess(), url: d.resumeUrl },
  }),
})

export const T6 = lifecycleEmail({
  id: 'T6',
  kind: 'transactional',
  track: 'T',
  stepId: 'T6',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your {{programme}} access is paused' },
    variant1Subject: { label: 'A/B subject B', kind: 'subject', default: 'Your {{programme}} progress is saved' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Your progress is saved. Pick up where you stopped.' },
    variant1Preheader: { label: 'A/B preview text B', kind: 'preheader', default: 'Your access is paused. Restart whenever you’re ready.' },
    paused: { label: 'Opening line', default: 'Your {{programme}} plan has ended, so your access is paused for now.' },
    saved: { label: 'Progress (lessons left known)', default: "Your progress is saved: you're {{progressPercent}}% through, with {{lessonsLeft}} lessons to go." },
    savedNoLessons: { label: 'Progress (lessons left unknown)', default: "Your progress is saved: you're {{progressPercent}}% through." },
    restartLocked: { label: 'Restart (locked rate, next lesson known)', default: 'Restart anytime at your locked rate of {{monthly}}, and carry on from "{{nextLessonTitle}}".' },
    restartLockedNoLesson: { label: 'Restart (locked rate)', default: 'Restart anytime at your locked rate of {{monthly}}.' },
    restartPlain: { label: 'Restart (standard fee, next lesson known)', default: 'Restart anytime and carry on from "{{nextLessonTitle}}".' },
    restartPlainNoLesson: { label: 'Restart (standard fee)', default: 'Restart anytime.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  variants: [{ subject: (_d, c) => c.variant1Subject(), preheader: (_d, c) => c.variant1Preheader() }],
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.paused(),
      d.lessonsLeft ? c.saved() : c.savedNoLessons(),
      d.joinedOnScholarship
        ? d.nextLessonTitle ? c.restartLocked() : c.restartLockedNoLesson()
        : d.nextLessonTitle ? c.restartPlain() : c.restartPlainNoLesson(),
    ]),
    button: { label: restartLabel(d), url: d.resumeCheckoutUrl },
  }),
})

export const T7 = lifecycleEmail({
  id: 'T7',
  kind: 'transactional',
  track: 'T',
  stepId: 'T7',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Welcome back, {{firstName}}' },
    preheader: { label: 'Preview text', kind: 'preheader', default: "You're back in {{programme}}, right where you left off." },
    back: { label: 'Opening line', default: 'Your payment went through and your access is back.' },
    nextLesson: { label: 'Next lesson', default: 'Your next lesson is "{{nextLessonTitle}}".' },
    rateStill: { label: 'Rate (joined on the scholarship)', default: 'Your rate is still {{monthly}}.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Continue learning' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      `${c.back()} ${progressLine(d)}${d.nextLessonTitle ? ` ${c.nextLesson()}` : ''}`.trim(),
      d.joinedOnScholarship ? c.rateStill() : '',
      receipt(d, [{ label: 'Programme', value: d.programme }, ...(d.nextChargeDate ? [{ label: 'Next payment', value: d.nextChargeDate }] : [])]),
    ]),
    button: { label: c.ctaLabel(), url: d.resumeUrl },
  }),
})

export const T8 = lifecycleEmail({
  id: 'T8',
  kind: 'transactional',
  track: 'T',
  stepId: 'T8',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'You did it, {{firstName}} 🎓' },
    preheader: { label: 'Preview text', kind: 'preheader', default: "You've finished {{programme}}. Here's what's next." },
    done: { label: 'Opening line', default: "You've completed {{programme}}. Seriously, well done. Finishing is the hard part, and you did it." },
    billingStopped: { label: 'Billing stopped', default: "Your monthly plan has stopped, so you won't be charged again for this programme." },
    nextExam: {
      label: 'Next step (with a final exam)',
      default: 'Your next step: get your verifiable certificate. Pay {{certificatePrice}}, then take your final exam; the fee covers the exam (retakes included) and your certificate when you pass. It gives you:',
      required: ['certificatePrice'],
    },
    nextNoExam: { label: 'Next step (no final exam)', default: 'Your next step: claim your verifiable certificate for {{certificatePrice}}. It gives you:', required: ['certificatePrice'] },
    benefitsList: {
      label: 'What the certificate gives (one per line)',
      kind: 'list',
      default: [
        'A unique link employers can click to check it’s real',
        'Something solid to add to LinkedIn and your CV',
        'Access to internship openings from our partner firms',
        "The right to apply for this cohort's laptop support",
      ].join('\n'),
    },
    lockOffer: {
      label: 'Next programme at their rate',
      default: 'One more thing: because you joined on the Access Scholarship, you can start another programme at {{monthly}} until {{nextProgrammeLockEnds}}',
      help: 'Then either the suggested programme and its link, or a link to the dashboard.',
    },
    lockNext: { label: 'Suggested next programme (its link follows)', default: '{{nextProgrammeTitle}} is a good next step:' },
    lockAfter: { label: 'After the 3 days', default: 'After that, a new programme costs whatever the fee is at the time.' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.done(),
      d.stopBillingOnComplete ? c.billingStopped() : '',
      d.hasFinalExam ? c.nextExam() : c.nextNoExam(),
      { list: lines(c.benefitsList()) },
      // Owner's rule: graduates can start another programme at the locked rate within 3 days of finishing.
      d.joinedOnScholarship && d.nextProgrammeLockEnds
        ? `${c.lockOffer()}${d.nextProgramme ? `. ${c.lockNext()} ${d.nextProgramme.checkoutUrl}` : `: ${d.dashboardUrl}`}. ${c.lockAfter()}`
        : '',
    ]),
    button: { label: certificateCta(d), url: d.certificateCheckoutUrl },
  }),
})

export const T9 = lifecycleEmail({
  id: 'T9',
  kind: 'transactional',
  track: 'T',
  stepId: 'T9',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your certificate is ready' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Your verification link, and how to use it.' },
    ready: { label: 'Opening line', default: 'Your SkillsAir certificate for {{programme}} is ready.' },
    verification: { label: 'Verification link label (the link follows)', default: 'Verification link:' },
    waysIntro: { label: 'Before the list', default: 'Three ways to use it this week:' },
    waysList: {
      label: 'Ways to use it (one per line)',
      kind: 'list',
      default: [
        'Add it to LinkedIn under "Licenses & certifications", with the link.',
        'Put the link on your CV, next to the programme name.',
        "Check internship openings in your dashboard. They're open to you now.",
      ].join('\n'),
      help: '"Licenses & certifications" is LinkedIn’s own section name, so it keeps the American spelling.',
    },
    laptop: {
      label: 'Laptop support (the application link follows)',
      default: 'You can now apply for laptop support. Each cohort, 2 laptops go to certified graduates who need one most. Apply here:',
    },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Add it to LinkedIn' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.ready(),
      `${c.verification()} ${d.certificateUrl}`,
      c.waysIntro(),
      { ordered: true, list: lines(c.waysList()) },
      d.laptopApplicationsOpen ? `${c.laptop()} ${d.laptopUrl}` : '',
      d.reference ? receiptHeading(d) : '',
      d.reference ? receipt(d, [{ label: 'For', value: `Certificate: ${d.programme}` }]) : '',
    ]),
    button: { label: c.ctaLabel(), url: d.linkedinAddUrl },
  }),
})

/** D1–D3: Paystack doesn't retry a failed renewal, so the learner pays this month again to keep learning. */

export const D1 = lifecycleEmail({
  id: 'D1',
  kind: 'transactional',
  track: 'D',
  stepId: 'D1',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: "Your {{price}} payment didn't go through", required: ['price'] },
    preheader: { label: 'Preview text', kind: 'preheader', default: "Pay this month's {{price}} to keep learning {{programme}}." },
    tried: { label: 'Opening line', default: "We tried to renew your {{programme}} plan today, but the payment of {{price}} didn't go through.", required: ['price'] },
    usually: {
      label: 'Why it usually happens',
      default: "This is usually a low balance or a card that's not enabled for online payments. You keep access for the next {{graceDays}} days while you sort it out.",
    },
    retry: {
      label: 'How to pay',
      default: "Paystack won't try the card again this month, so tap below to pay this month's {{price}} with the same card (once it has money in it) or a different one.",
    },
    rateStays: { label: 'Rate (joined on the scholarship)', default: 'Your rate stays at {{monthly}}.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Pay {{price}} and keep learning' },
    ps: { label: 'P.S.', kind: 'ps', default: "Debited but it still says failed? Reply with the date and amount and we'll resolve it within 24 hours." },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.tried(), c.usually(), sentences(c.retry(), d.joinedOnScholarship ? c.rateStays() : '')]),
    button: { label: c.ctaLabel(), url: d.updateCardUrl },
    ps: c.ps(),
  }),
})

export const D2 = lifecycleEmail({
  id: 'D2',
  kind: 'transactional',
  track: 'D',
  stepId: 'D2',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: "This month's payment is still due" },
    preheader: { label: 'Preview text (pause date known)', kind: 'preheader', default: 'Your access to {{programme}} pauses on {{graceEnds}}.' },
    preheaderNoDate: { label: 'Preview text (pause date unknown)', kind: 'preheader', default: 'Keep your access to {{programme}}.' },
    notThrough: { label: 'Opening line', default: "Your {{price}} renewal for {{programme}} still hasn't gone through.", required: ['price'] },
    pauses: { label: 'When access pauses', default: 'Your access pauses on {{graceEnds}}.' },
    payNow: { label: 'Pay now', default: "Pay now and you won't lose a day." },
    rateStays: { label: 'Rate (joined on the scholarship)', default: 'Your rate stays at {{monthly}}.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Pay {{price}} and keep learning' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (d, c) => (d.graceEnds ? c.preheader() : c.preheaderNoDate()),
  body: (d, c) => ({
    blocks: blocks([greeting(d), sentences(c.notThrough(), d.graceEnds ? c.pauses() : '', c.payNow(), d.joinedOnScholarship ? c.rateStays() : '')]),
    button: { label: c.ctaLabel(), url: d.updateCardUrl },
  }),
})

export const D3 = lifecycleEmail({
  id: 'D3',
  kind: 'transactional',
  track: 'D',
  stepId: 'D3',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your access pauses tonight' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'One minute to keep {{programme}} going.' },
    lastReminder: {
      label: 'Last reminder (standard fee)',
      default: "This is the last reminder: your access to {{programme}} pauses tonight because the renewal didn't go through. Your progress ({{progressPercent}}%) is saved either way.",
    },
    lastReminderLocked: {
      label: 'Last reminder (joined on the scholarship)',
      default: "This is the last reminder: your access to {{programme}} pauses tonight because the renewal didn't go through. Your progress ({{progressPercent}}%) is saved either way, and you can restart anytime at {{monthly}}.",
    },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Pay {{price}} and keep learning' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), d.joinedOnScholarship ? c.lastReminderLocked() : c.lastReminder()]),
    button: { label: c.ctaLabel(), url: d.updateCardUrl },
  }),
})

/** Month-by-month (transfer/OPay) plans: the next month is due soon. */
export const T10 = lifecycleEmail({
  id: 'T10',
  kind: 'transactional',
  track: 'T',
  stepId: 'T10',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your next month of {{programme}} is due on {{periodEnd}}' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Pay {{amount}} by bank transfer or OPay to keep learning.' },
    paid: {
      label: 'Opening line',
      default: "You've paid for {{programme}} until {{periodEnd}}. To keep learning after that, pay next month's {{amount}} the same way you did before: bank transfer or OPay. It takes about two minutes.",
      required: ['amount'],
    },
    close: { label: 'Nearly finished (80% or more)', default: "You're close. One more month may be all you need." },
    smallPrint: { label: 'Small print (the billing link follows)', default: "If you'd rather it renewed by itself, choose Paystack and pay by card after {{periodEnd}}. Want to stop? Cancel anytime:" },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Pay for next month' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.paid(),
      d.priceLocked ? LOCK_LINE(d) : '',
      sentences(progressLine(d), d.progressPercent >= 80 ? c.close() : ''),
      { small: `${c.smallPrint()} ${d.billingUrl}` },
    ]),
    button: { label: c.ctaLabel(), url: d.updateCardUrl },
  }),
})

/** Month-by-month plans: the paid month has ended; access continues for the grace days. */
export const T11 = lifecycleEmail({
  id: 'T11',
  kind: 'transactional',
  track: 'T',
  stepId: 'T11',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Keep your {{programme}} access: pay by {{graceEnds}}' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Your paid month ended. You still have access until {{graceEnds}}.' },
    ended: { label: 'Opening line', default: 'Your paid month of {{programme}} ended on {{periodEnd}}. You still have access until {{graceEnds}}, so nothing is lost.' },
    pay: { label: 'How to carry on', default: 'Pay {{amount}} by bank transfer or OPay before then to carry on. Your next month starts the day you pay.', required: ['amount'] },
    help: { label: 'Small print', default: 'Something stopping you? Reply to this email or WhatsApp us, Monday to Saturday, 9am–6pm.' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Pay for next month' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([greeting(d), c.ended(), c.pay(), d.priceLocked ? LOCK_LINE(d) : '', { small: c.help() }]),
    button: { label: c.ctaLabel(), url: d.updateCardUrl },
  }),
})

/** T12: the certificate fee is paid, so the final exam is open (passing it issues the certificate). */
export const T12 = lifecycleEmail({
  id: 'T12',
  kind: 'transactional',
  track: 'T',
  stepId: 'T12',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your final exam is ready' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Your certificate for {{programme}} is paid for. Pass the exam to receive it.' },
    paid: {
      label: 'Opening line',
      default: 'Your certificate for {{programme}} is paid for. The last step is your final exam: pass it and your certificate is issued straight away.',
    },
    howIntro: { label: 'Before the list', default: 'How it works:' },
    howList: {
      label: 'How the exam works (one per line)',
      kind: 'list',
      default: [
        'Questions from every chapter of the programme, with a time limit shown before you start.',
        'Pass mark: 70%. Your answers save as you go, and the timer runs on our side.',
        'Your fee covers retakes: 3 attempts, then a 48-hour break before 3 more, as many times as you need.',
        'Use Wi-Fi or a stable connection, and set aside the full time.',
      ].join('\n'),
    },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Start my final exam' },
  },
  subject: (_d, c) => c.subject(),
  preheader: (_d, c) => c.preheader(),
  body: (d, c) => ({
    blocks: blocks([
      greeting(d),
      c.paid(),
      c.howIntro(),
      { list: lines(c.howList()) },
      d.reference ? receiptHeading(d) : '',
      d.reference ? receipt(d, [{ label: 'For', value: `Certificate and final exam: ${d.programme}` }]) : '',
    ]),
    button: { label: c.ctaLabel(), url: d.examUrl },
  }),
})

export const TRACK_T_D = [T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, D1, D2, D3]
