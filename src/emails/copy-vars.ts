import type { MessageData } from '../lib/lifecycle/context.js'
import type { Vars } from './copy.js'

/**
 * The placeholders every lifecycle email can use (brief section 3.2), derived from MessageData,
 * with prices preformatted by the same helpers the templates use. URLs are never placeholders:
 * buttons and links keep the addresses set in code.
 */
export const naira = (amount: number) => `₦${Math.round(amount).toLocaleString('en-NG')}`
export const monthly = (data: Pick<MessageData, 'price'>) => `${naira(data.price)} a month`
export const certificate = (data: Pick<MessageData, 'certificatePrice'>) => naira(data.certificatePrice)
export const standardFee = (data: Pick<MessageData, 'standardPrice' | 'standardMonthlyPrice'>) =>
  data.standardMonthlyPrice ? `${naira(data.standardPrice)} (or ${naira(data.standardMonthlyPrice)} a month)` : naira(data.standardPrice)

export const LIFECYCLE_VAR_DOCS: Record<string, string> = {
  firstName: 'Their first name ("there" when we don’t know it)',
  programme: 'The programme title, e.g. Data Analysis',
  school: 'The school, e.g. School of Data',
  role: 'The job the programme leads to, e.g. data analyst',
  price: 'Their price, e.g. ₦2,000',
  monthly: 'Their price a month, e.g. ₦2,000 a month',
  certificatePrice: 'The certificate fee, e.g. ₦10,000',
  standardFee: 'The standard fee, e.g. ₦100,000 (or ₦40,000 a month)',
  standardPrice: 'The full standard fee, e.g. ₦100,000',
  standardMonthly: 'The standard monthly fee, e.g. ₦40,000 (empty when there isn’t one)',
  closesOn: 'When the scholarship window closes, e.g. Saturday 31 October',
  closesDay: 'The closing day, e.g. Saturday 31 October',
  progressPercent: 'How far through they are, as a number, e.g. 45',
  lessonsLeft: 'Lessons still to do, e.g. 18',
  nextLessonTitle: 'The next lesson’s title',
  lesson1Title: 'The first lesson’s title',
  lesson1Minutes: 'How long lesson 1 takes in minutes, e.g. 12',
  weeksLeft: 'Weeks left at 8 hours a week, as a number, e.g. 3',
  weeks: 'Weeks left with the word, e.g. 3 weeks or 1 week',
  completedOn: 'The day they finished, e.g. 12 January 2027',
  amount: 'The amount paid or due, e.g. ₦2,000',
  reference: 'The payment reference, e.g. SA-SUB-48213',
  paidAt: 'The payment date, e.g. 19 October 2026',
  billingDay: 'Their billing day, e.g. 19th',
  monthNumber: 'Which month of the plan this is, e.g. 2',
  nextChargeDate: 'The next payment date',
  chargeDate: 'The renewal date',
  cardLast4: 'The last 4 digits of their card',
  cardExpiry: 'Their card’s expiry, e.g. 11/2026',
  periodEnd: 'When the paid month ends',
  graceDays: 'Days of access after a failed payment, e.g. 3',
  graceEnds: 'When the grace days end, e.g. Thursday 22 October',
  laptopDeadline: 'When laptop applications close',
  nextProgrammeTitle: 'The suggested next programme ("your next programme" when there isn’t one)',
  nextProgrammeLockEnds: 'Until when they can start another programme at their rate',
  phoneFriendlyList: 'The programmes that work fully on a phone',
}

export function lifecycleVars(d: MessageData): Vars {
  return {
    firstName: d.firstName,
    programme: d.programme,
    school: d.school,
    role: d.role,
    price: naira(d.price),
    monthly: monthly(d),
    certificatePrice: certificate(d),
    standardFee: standardFee(d),
    standardPrice: naira(d.standardPrice),
    standardMonthly: d.standardMonthlyPrice ? naira(d.standardMonthlyPrice) : '',
    closesOn: d.closesOn,
    closesDay: d.closesDay,
    progressPercent: d.progressPercent,
    lessonsLeft: d.lessonsLeft,
    nextLessonTitle: d.nextLessonTitle,
    lesson1Title: d.lesson1Title,
    lesson1Minutes: d.lesson1Minutes ?? '',
    weeksLeft: d.weeksLeft,
    weeks: `${d.weeksLeft} week${d.weeksLeft === 1 ? '' : 's'}`,
    completedOn: d.completedOn,
    amount: naira(d.amount),
    reference: d.reference,
    paidAt: d.paidAt,
    billingDay: d.billingDay,
    monthNumber: d.monthNumber,
    nextChargeDate: d.nextChargeDate,
    chargeDate: d.chargeDate,
    cardLast4: d.cardLast4,
    cardExpiry: d.cardExpiry,
    periodEnd: d.periodEnd,
    graceDays: d.graceDays,
    graceEnds: d.graceEnds,
    laptopDeadline: d.laptopDeadline,
    nextProgrammeTitle: d.nextProgramme?.title ?? 'your next programme',
    nextProgrammeLockEnds: d.nextProgrammeLockEnds,
    phoneFriendlyList: d.phoneFriendlyList,
  }
}
