import type { MessageData } from '../../lib/lifecycle/context.js'
import { defineEmail, makeResolver, type CopyResolver, type EmailDefinition, type EmailTemplate } from '../define.js'
import type { Block } from '../layout.js'
import type { CopySlot } from '../copy.js'
import { LIFECYCLE_VAR_DOCS, certificate, lifecycleVars, monthly, naira, standardFee } from '../copy-vars.js'
import { SHARED_ID } from '../override-store.js'

/**
 * Shared pieces for the lifecycle emails (brief section 13). House style: from Imisi, one
 * person to one person, short paragraphs, one button, a P.S. on most marketing emails.
 * Honesty rules: every ₦2,000 says "a month" and sits next to the ₦10,000 certificate; real
 * deadlines only; no invented proof, biography or job promises.
 */
export type LifecycleTemplate = EmailTemplate<MessageData>

export { naira, monthly, certificate, standardFee }

/**
 * Shared phrases ("Shared phrases" in Studio, template id `_shared`): edited once, used by every
 * lifecycle email that shows them.
 */
export const SHARED_COPY = {
  greeting: { label: 'Greeting (every lifecycle email)', default: 'Hi {{firstName}},', help: 'The first line of every lifecycle email.' },
  lockLine: { label: 'Locked-rate sentence', default: 'Your rate is locked at {{monthly}}, because you joined during the Access Scholarship.', required: ['monthly'] },
  rateLocked: { label: 'Locked-rate reminder (short)', default: 'Your rate is locked at {{monthly}}.', required: ['monthly'], help: 'Added after a sentence in the win-back emails (R1, R5) for people who joined on the scholarship.' },
  designed: { label: 'How long a programme takes', default: 'a guided 12-week plan at about 8 hours a week', help: 'Used mid-sentence, so it starts with a small letter (A0 capitalises it).' },
  examNote: { label: 'What the certificate fee covers (programmes with a final exam)', default: 'Your {{certificatePrice}} covers your final exam (retakes included) and your certificate when you pass.', required: ['certificatePrice'] },
  certificateCtaExam: { label: 'Certificate button (with a final exam)', default: 'Get my certificate', kind: 'button' },
  certificateCtaNoExam: { label: 'Certificate button (no final exam)', default: 'Claim my certificate', kind: 'button' },
  restartLocked: { label: 'Restart button (joined on the scholarship)', default: 'Restart for {{monthly}}', kind: 'button', required: ['monthly'] },
  restartPlain: { label: 'Restart button (standard fee)', default: 'Restart my programme', kind: 'button' },
  priceTodayOpen: { label: 'Today’s price, window open (graduates)', default: "While the Access Scholarship is open (until {{closesOn}}), it's {{monthly}}.", required: ['monthly'] },
  priceTodayClosed: { label: 'Today’s price, window closed (graduates)', default: "Right now it's the standard fee, {{standardFee}}, or you can wait for the next Access Scholarship window.", required: ['standardFee'] },
  progressLine: { label: 'Progress line (receipts and account emails)', default: "You're {{progressPercent}}% through.", help: 'Shown only when they have started.' },
  receiptHeading: { label: 'Receipt heading', default: '**Receipt**' },
} satisfies Record<string, CopySlot>

export type SharedKey = keyof typeof SHARED_COPY

/** The shared phrases for one person's data. */
export function phrases(data: MessageData): CopyResolver<SharedKey> {
  return makeResolver(SHARED_ID, SHARED_COPY, lifecycleVars(data), LIFECYCLE_VAR_DOCS) as CopyResolver<SharedKey>
}

/** Programmes with a final exam: pay first, then the exam (the fee covers retakes and the certificate). */
export const examNote = (data: MessageData) => (data.hasFinalExam ? phrases(data).examNote() : '')
export const certificateCta = (data: MessageData) => (data.hasFinalExam ? phrases(data).certificateCtaExam() : phrases(data).certificateCtaNoExam())
export const LOCK_LINE = (data: MessageData) => phrases(data).lockLine()
export const designed = (data: MessageData) => phrases(data).designed()
export const greeting = (data: MessageData) => phrases(data).greeting()
export const restartLabel = (data: MessageData) => (data.joinedOnScholarship ? phrases(data).restartLocked() : phrases(data).restartPlain())
/** "You're 45% through." once they've started, else empty. */
export const progressLine = (data: MessageData) => (data.lessonsLeft > 0 || data.progressPercent > 0 ? phrases(data).progressLine() : '')
export const receiptHeading = (data: MessageData) => phrases(data).receiptHeading()
export const priceToday = (data: MessageData) => (data.windowOpen ? phrases(data).priceTodayOpen() : phrases(data).priceTodayClosed())

/** Drops empty conditional blocks: blocks(['a', cond && 'b']). */
export function blocks(items: Array<Block | false | null | undefined | ''>): Block[] {
  return items.filter((item): item is Block => Boolean(item))
}

/** Renders nothing until the owner approves a real proof item in the admin (Email content). */
export function proofSlot(data: MessageData): Block | null {
  return data.proof ? `“${data.proof.text}” (${data.proof.attribution})` : null
}

/** Sample data for previews and tests: an applicant on Data Analysis with an open window. */
export const SAMPLE: MessageData = {
  firstName: 'Tobi',
  email: 'tobi@example.com',
  programme: 'Data Analysis',
  programmeSlug: 'data-analysis',
  school: 'School of Data',
  role: 'data analyst',
  careerExplainer:
    'Data analysts spend the day cleaning spreadsheets, finding patterns and turning them into charts and short reports that help a manager decide something. It suits curious people who like getting to the bottom of things.',
  phoneFriendly: true,
  phoneFriendlyList: 'Smartphone Videography and Content Creation, Mobile Graphics Design, Data Analysis, Product Management',
  offerUrl: 'https://skillsair.com/r/ABC123',
  checkoutUrl: 'https://skillsair.com/checkout?course=data-analysis',
  resumeCheckoutUrl: 'https://skillsair.com/checkout?course=data-analysis',
  waitlistUrl: 'https://skillsair.com/r/ABC123',
  previewUrl: 'https://skillsair.com/programmes/data-analysis',
  phoneFriendlyUrl: 'https://skillsair.com/schools',
  dashboardUrl: 'https://skillsair.com/dashboard',
  resumeUrl: 'https://skillsair.com/dashboard/courses/data-analysis/learn',
  firstLessonUrl: 'https://skillsair.com/dashboard/courses/data-analysis/learn',
  billingUrl: 'https://skillsair.com/dashboard/subscription',
  updateCardUrl: 'https://skillsair.com/billing/update-card?subscription=9',
  certificateCheckoutUrl: 'https://skillsair.com/checkout?certificate=data-analysis',
  hasFinalExam: true,
  examUrl: 'https://skillsair.com/dashboard/courses/data-analysis/exam',
  laptopUrl: 'https://skillsair.com/dashboard/laptop-support',
  windowOpen: true,
  closesOn: 'Saturday 31 October',
  closesDay: 'Saturday 31 October',
  closesAt: '2026-10-31T22:59:00.000Z',
  priceLocked: true,
  price: 2000,
  standardPrice: 100000,
  standardMonthlyPrice: 40000,
  certificatePrice: 10000,
  progressPercent: 45,
  lessonsLeft: 18,
  nextLessonTitle: 'Cleaning messy data',
  lesson1Title: 'What a data analyst does',
  lesson1Minutes: 12,
  weeksLeft: 3,
  weekPlan: ['Week 1: Cleaning data, Formulas', 'Week 2: Pivot tables, Charts', 'Week 3: Your portfolio project'],
  completedOn: '12 January 2027',
  reference: 'SA-SUB-48213',
  amount: 2000,
  paidAt: '19 October 2026',
  billingDay: '19th',
  monthNumber: 2,
  nextChargeDate: '19 December 2026',
  chargeDate: '19 November 2026',
  cardLast4: '4081',
  cardExpiry: '11/2026',
  periodEnd: '19 November 2026',
  graceDays: 3,
  graceEnds: 'Thursday 22 October',
  renewalSoon: false,
  stopBillingOnComplete: true,
  manualBilling: false,
  certificateUrl: 'https://skillsair.com/certificates/verify/SAC-7Q2K9',
  linkedinAddUrl: 'https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=Data%20Analysis&organizationName=SkillsAir',
  laptopApplicationsOpen: true,
  laptopDeadline: '30 January 2027',
  nextProgramme: {
    title: 'Product Management',
    slug: 'product-management',
    url: 'https://skillsair.com/programmes/product-management',
    checkoutUrl: 'https://skillsair.com/checkout?course=product-management',
    pairingReason: 'Data Analysis plus Product Management means you can find the insight and decide what to build with it.',
  },
  nextProgrammeLockEnds: 'Thursday 15 January',
  founderAnecdote: null,
  freeExercise: 'Open Google Sheets, paste in your last month of spending, and make a chart of where the money went.',
  proof: null,
  joinedOnScholarship: true,
  occurrence: 0,
  resumeCode: 'ABC123',
  orderReference: 'SA-SUB-48213',
  plan: {
    week: 3,
    weeks: 12,
    items: [
      { title: 'Cleaning messy data', minutes: 19 },
      { title: 'Formulas that save time', minutes: 22 },
      { title: 'Chapter quiz: Cleaning data', minutes: 15 },
    ],
    timeLabel: '56 min',
    behind: true,
    overdueCount: 2,
    nextTitle: 'Cleaning messy data',
    nextMinutes: 19,
    nextUrl: 'https://skillsair.com/dashboard/courses/data-analysis/learn?lesson=41',
    planUrl: 'https://skillsair.com/dashboard/courses/data-analysis/plan',
  },
}

export function lifecycleEmail<K extends string = never>(
  definition: Omit<EmailDefinition<MessageData, K>, 'sample' | 'vars' | 'varDocs'> & { sample?: Partial<MessageData> },
): LifecycleTemplate {
  return defineEmail<MessageData, K>({ ...definition, vars: lifecycleVars, varDocs: LIFECYCLE_VAR_DOCS, sample: { ...SAMPLE, ...(definition.sample ?? {}) } })
}
