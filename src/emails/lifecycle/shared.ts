import type { MessageData } from '../../lib/lifecycle/context.js'
import { defineEmail, type EmailDefinition, type EmailTemplate } from '../define.js'
import type { Block } from '../layout.js'

/**
 * Shared pieces for the lifecycle emails (brief section 13). House style: from Imisi, one
 * person to one person, short paragraphs, one button, a P.S. on most marketing emails.
 * Honesty rules: every ₦2,000 says "a month" and sits next to the ₦10,000 certificate; real
 * deadlines only; no invented proof, biography or job promises.
 */
export type LifecycleTemplate = EmailTemplate<MessageData>

export const naira = (amount: number) => `₦${Math.round(amount).toLocaleString('en-NG')}`
export const monthly = (data: Pick<MessageData, 'price'>) => `${naira(data.price)} a month`
export const certificate = (data: Pick<MessageData, 'certificatePrice'>) => naira(data.certificatePrice)
export const standardFee = (data: Pick<MessageData, 'standardPrice' | 'standardMonthlyPrice'>) =>
  data.standardMonthlyPrice ? `${naira(data.standardPrice)} (or ${naira(data.standardMonthlyPrice)} a month)` : naira(data.standardPrice)
export const LOCK_LINE = (data: MessageData) => `Your rate is locked at ${monthly(data)}, because you joined during the Access Scholarship.`
export const DESIGNED = 'designed to take about 3 months at about 8 hours a week'

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
}

export function lifecycleEmail(definition: Omit<EmailDefinition<MessageData>, 'sample'> & { sample?: Partial<MessageData> }): LifecycleTemplate {
  return defineEmail<MessageData>({ ...definition, sample: { ...SAMPLE, ...(definition.sample ?? {}) } })
}
