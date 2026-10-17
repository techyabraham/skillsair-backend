import { blocks, certificate, LOCK_LINE, lifecycleEmail, monthly, naira } from './shared.js'
import type { MessageData } from '../../lib/lifecycle/context.js'
import type { Block } from '../layout.js'

/** Track T: transactional (never capped). Track D: failed renewal (Paystack doesn't retry). */

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

const progressLine = (d: MessageData) => (d.lessonsLeft > 0 || d.progressPercent > 0 ? `You're ${d.progressPercent}% through.` : '')
const nextLesson = (d: MessageData) => (d.nextLessonTitle ? ` Next up: "${d.nextLessonTitle}".` : '')

export const T1 = lifecycleEmail({
  id: 'T1',
  kind: 'transactional',
  track: 'T',
  stepId: 'T1',
  subject: (d) => `You're in, ${d.firstName} 🎉`,
  preheader: (d) => `Your ${d.programme} seat is confirmed. Start with lesson 1.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `Welcome to SkillsAir. Your seat in ${d.programme} is confirmed.`,
      'Three things to do first:',
      {
        ordered: true,
        list: [
          "Watch lesson 1 today, while you're excited.",
          'Block out about 8 hours a week. Put it in your calendar.',
          "Open your free CV & LinkedIn course. It's in your dashboard.",
        ],
      },
      d.priceLocked
        ? `Your plan: ${monthly(d)}, billed to your card${d.billingDay ? ` on the ${d.billingDay} of each month` : ' each month'} until you finish. ${LOCK_LINE(d)} You can cancel anytime from your dashboard.`
        : `You've paid ${naira(d.amount)} for ${d.programme}. The certificate is ${certificate(d)} when you finish, only if you want it.`,
      '**Receipt**',
      receipt(d),
      'Questions? Reply here or WhatsApp me, Monday to Saturday, 9am–6pm.',
    ]),
    button: { label: 'Start lesson 1', url: d.firstLessonUrl },
  }),
})

export const T2 = lifecycleEmail({
  id: 'T2',
  kind: 'transactional',
  track: 'T',
  stepId: 'T2',
  subject: (d) => `Receipt: ${naira(d.amount)} for ${d.programme}`,
  preheader: (d) => `Month ${d.monthNumber}. ${progressLine(d) || 'Keep going.'}`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      'Thanks. Your monthly payment went through.',
      receipt(d, [{ label: 'Programme', value: `${d.programme} (month ${d.monthNumber})` }, ...(d.nextChargeDate ? [{ label: 'Next payment', value: d.nextChargeDate }] : [])]),
      `${progressLine(d)}${nextLesson(d)}`.trim(),
      { small: `Manage or cancel your plan: ${d.billingUrl}` },
    ]),
    button: { label: 'Continue learning', url: d.resumeUrl },
  }),
})

export const T3 = lifecycleEmail({
  id: 'T3',
  kind: 'service',
  track: 'T',
  stepId: 'T3',
  subject: (d) => `${naira(d.amount)} renews on ${d.chargeDate}`,
  preheader: () => 'Make sure your card is ready.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `Just so it's not a surprise: your ${d.programme} plan renews on ${d.chargeDate} for ${naira(d.amount)}.`,
      `Please make sure your card${d.cardLast4 ? ` ending ${d.cardLast4}` : ''} has enough in it. If you'd like to use a different card, you can change it here.`,
      `${progressLine(d)}${d.progressPercent >= 80 ? " You're close. Finish this month and you won't need another renewal." : ''}`.trim(),
      { small: `Want to stop? Cancel anytime: ${d.billingUrl}` },
    ]),
    button: { label: 'Change my card', url: d.updateCardUrl },
  }),
})

export const T4 = lifecycleEmail({
  id: 'T4',
  kind: 'service',
  track: 'T',
  stepId: 'T4',
  subject: () => 'Your card expires soon',
  preheader: (d) => `Update it so your ${d.programme} access isn't paused.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `The card you use for ${d.programme}${d.cardLast4 ? ` (ending ${d.cardLast4})` : ''} expires${d.cardExpiry ? ` on ${d.cardExpiry}` : ' soon'}. Update it now and your learning won't be interrupted. It takes a minute.`,
    ]),
    button: { label: 'Update my card', url: d.updateCardUrl },
  }),
})

export const T5 = lifecycleEmail({
  id: 'T5',
  kind: 'transactional',
  track: 'T',
  stepId: 'T5',
  subject: () => 'Your plan is cancelled',
  preheader: (d) => (d.periodEnd ? `You still have access until ${d.periodEnd}.` : 'You won’t be charged again.'),
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `Done. Your ${d.programme} plan won't renew, and you won't be charged again.`,
      d.periodEnd ? `You still have full access until ${d.periodEnd}, so use it. ${progressLine(d)}`.trim() : progressLine(d),
      d.joinedOnScholarship ? `If you come back later, your rate is still ${monthly(d)}. It's locked because you joined during the Access Scholarship. The certificate is ${certificate(d)} when you finish.` : '',
      "If something made you cancel, I'd really like to know. Just reply with one line.",
    ]),
    button: { label: d.periodEnd ? `Keep learning until ${d.periodEnd}` : 'Go to my dashboard', url: d.resumeUrl },
  }),
})

export const T6 = lifecycleEmail({
  id: 'T6',
  kind: 'transactional',
  track: 'T',
  stepId: 'T6',
  subject: (d) => `Your ${d.programme} access is paused`,
  preheader: () => 'Your progress is saved. Pick up where you stopped.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `Your ${d.programme} plan has ended, so your access is paused for now.`,
      `Your progress is saved: you're ${d.progressPercent}% through${d.lessonsLeft ? `, with ${d.lessonsLeft} lessons to go` : ''}.`,
      d.joinedOnScholarship
        ? `Restart anytime at your locked rate of ${monthly(d)}${d.nextLessonTitle ? `, and carry on from "${d.nextLessonTitle}"` : ''}.`
        : `Restart anytime${d.nextLessonTitle ? ` and carry on from "${d.nextLessonTitle}"` : ''}.`,
    ]),
    button: { label: d.joinedOnScholarship ? `Restart for ${monthly(d)}` : 'Restart my programme', url: d.resumeCheckoutUrl },
    ps: `The certificate is ${certificate(d)} when you finish.`,
  }),
})

export const T7 = lifecycleEmail({
  id: 'T7',
  kind: 'transactional',
  track: 'T',
  stepId: 'T7',
  subject: (d) => `Welcome back, ${d.firstName}`,
  preheader: (d) => `You're back in ${d.programme}, right where you left off.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `Your payment went through and your access is back. ${progressLine(d)}${d.nextLessonTitle ? ` Your next lesson is "${d.nextLessonTitle}".` : ''}`.trim(),
      d.joinedOnScholarship ? `Your rate is still ${monthly(d)}.` : '',
      receipt(d, [{ label: 'Programme', value: d.programme }, ...(d.nextChargeDate ? [{ label: 'Next payment', value: d.nextChargeDate }] : [])]),
    ]),
    button: { label: 'Continue learning', url: d.resumeUrl },
  }),
})

export const T8 = lifecycleEmail({
  id: 'T8',
  kind: 'transactional',
  track: 'T',
  stepId: 'T8',
  subject: (d) => `You did it, ${d.firstName} 🎓`,
  preheader: (d) => `You've finished ${d.programme}. Here's what's next.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `You've completed ${d.programme}. Seriously, well done. Finishing is the hard part, and you did it.`,
      d.stopBillingOnComplete ? "Your monthly plan has stopped, so you won't be charged again for this programme." : '',
      `Your next step: claim your verifiable certificate for ${certificate(d)}. It gives you:`,
      {
        list: [
          'A unique link employers can click to check it’s real',
          'Something solid to add to LinkedIn and your CV',
          'Access to internship openings from our partner firms',
          "The right to apply for this cohort's laptop support",
        ],
      },
      // Owner's rule: graduates can start another programme at the locked rate within 3 days of finishing.
      d.joinedOnScholarship && d.nextProgrammeLockEnds
        ? `One more thing: because you joined on the Access Scholarship, you can start another programme at ${monthly(d)} until ${d.nextProgrammeLockEnds}${d.nextProgramme ? `. ${d.nextProgramme.title} is a good next step: ${d.nextProgramme.checkoutUrl}` : `: ${d.dashboardUrl}`}. After that, a new programme costs whatever the fee is at the time.`
        : '',
    ]),
    button: { label: 'Claim my certificate', url: d.certificateCheckoutUrl },
  }),
})

export const T9 = lifecycleEmail({
  id: 'T9',
  kind: 'transactional',
  track: 'T',
  stepId: 'T9',
  subject: () => 'Your certificate is ready',
  preheader: () => 'Your verification link, and how to use it.',
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `Your SkillsAir certificate for ${d.programme} is ready.`,
      `Verification link: ${d.certificateUrl}`,
      'Three ways to use it this week:',
      {
        ordered: true,
        list: [
          'Add it to LinkedIn under "Licenses & certifications", with the link.',
          'Put the link on your CV, next to the programme name.',
          "Check internship openings in your dashboard. They're open to you now.",
        ],
      },
      d.laptopApplicationsOpen
        ? `You can now apply for laptop support. Each cohort, 2 laptops go to certified graduates who need one most. Apply here: ${d.laptopUrl}`
        : '',
      d.reference ? '**Receipt**' : '',
      d.reference ? receipt(d, [{ label: 'For', value: `Certificate: ${d.programme}` }]) : '',
    ]),
    button: { label: 'Add it to LinkedIn', url: d.linkedinAddUrl },
  }),
})

/** D1–D3: Paystack doesn't retry a failed renewal, so the learner pays this month again to keep learning. */

export const D1 = lifecycleEmail({
  id: 'D1',
  kind: 'transactional',
  track: 'D',
  stepId: 'D1',
  subject: (d) => `Your ${naira(d.price)} payment didn't go through`,
  preheader: (d) => `Pay this month's ${naira(d.price)} to keep learning ${d.programme}.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `We tried to renew your ${d.programme} plan today, but the payment of ${naira(d.price)} didn't go through.`,
      `This is usually a low balance or a card that's not enabled for online payments. You keep access for the next ${d.graceDays} days while you sort it out.`,
      `Paystack won't try the card again this month, so tap below to pay this month's ${naira(d.price)} with the same card (once it has money in it) or a different one. ${d.joinedOnScholarship ? `Your rate stays at ${monthly(d)}.` : ''}`.trim(),
    ]),
    button: { label: `Pay ${naira(d.price)} and keep learning`, url: d.updateCardUrl },
    ps: "Debited but it still says failed? Reply with the date and amount and we'll resolve it within 24 hours.",
  }),
})

export const D2 = lifecycleEmail({
  id: 'D2',
  kind: 'transactional',
  track: 'D',
  stepId: 'D2',
  subject: () => "This month's payment is still due",
  preheader: (d) => (d.graceEnds ? `Your access to ${d.programme} pauses on ${d.graceEnds}.` : `Keep your access to ${d.programme}.`),
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `Your ${naira(d.price)} renewal for ${d.programme} still hasn't gone through.${d.graceEnds ? ` Your access pauses on ${d.graceEnds}.` : ''} Pay now and you won't lose a day.${d.joinedOnScholarship ? ` Your rate stays at ${monthly(d)}.` : ''}`,
    ]),
    button: { label: `Pay ${naira(d.price)} and keep learning`, url: d.updateCardUrl },
  }),
})

export const D3 = lifecycleEmail({
  id: 'D3',
  kind: 'transactional',
  track: 'D',
  stepId: 'D3',
  subject: () => 'Your access pauses tonight',
  preheader: (d) => `One minute to keep ${d.programme} going.`,
  body: (d) => ({
    blocks: blocks([
      `Hi ${d.firstName},`,
      `This is the last reminder: your access to ${d.programme} pauses tonight because the renewal didn't go through. Your progress (${d.progressPercent}%) is saved either way${d.joinedOnScholarship ? `, and you can restart anytime at ${monthly(d)}` : ''}.`,
    ]),
    button: { label: `Pay ${naira(d.price)} and keep learning`, url: d.updateCardUrl },
  }),
})

export const TRACK_T_D = [T1, T2, T3, T4, T5, T6, T7, T8, T9, D1, D2, D3]
