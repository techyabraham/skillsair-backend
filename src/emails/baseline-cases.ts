import type { RenderedEmail } from './define.js'
import { emailTemplates } from './index.js'
import { LIFECYCLE_TEMPLATES, SAMPLE } from './lifecycle/index.js'
import { SAMPLE_FOOTER_LINKS, SCENARIOS } from './scenarios.js'
import { accessExtendedEmail, enrollmentConfirmationEmail, leadDailySummaryEmail, welcomeEmail, type LeadSummaryInput } from '../lib/resend.js'

/**
 * Every render the baseline snapshot covers (brief section 2): each lifecycle template against
 * every scenario and A/B variant, the other templates with their sample, and the account emails
 * from src/lib/resend.ts called with fixed arguments. Keys are "<id>|<scenario>|ab<n>".
 * Rendered with no published overrides, so the output is what learners receive today.
 */
export const ACCOUNT_EMAIL_IDS = ['account-welcome', 'account-enrolment', 'account-access-extended', 'lead-daily-summary'] as const

export const LEAD_SUMMARY_SAMPLE: LeadSummaryInput = {
  dateLabel: '24 October 2026',
  newLeads: 14,
  bySchool: [{ label: 'School of Data', count: 9 }, { label: 'School of Design', count: 5 }],
  bySource: [{ label: 'instagram', count: 10 }, { label: 'referral', count: 4 }],
  offersViewed: 11,
  accountsCreated: 6,
  payments: 3,
  queueSize: 2,
  topLeads: [
    { firstName: 'Tobi', programme: 'Data Analysis', score: 82, needsHuman: true, adminUrl: 'https://studio.skillsair.com/admin/collections/leads/1' },
    { firstName: 'Ada', programme: 'Product Management', score: 64, needsHuman: false, adminUrl: 'https://studio.skillsair.com/admin/collections/leads/2' },
  ],
}

const EMPTY_LEAD_SUMMARY: LeadSummaryInput = { ...LEAD_SUMMARY_SAMPLE, newLeads: 0, bySchool: [], bySource: [], topLeads: [], queueSize: 0 }

const account = (content: { subject: string; html: string; text: string }): RenderedEmail => ({ subject: content.subject, preheader: '', html: content.html, text: content.text })

export function renderBaseline(): Record<string, RenderedEmail> {
  const out: Record<string, RenderedEmail> = {}
  const skip = new Set<string>(ACCOUNT_EMAIL_IDS)
  for (const template of Object.values(emailTemplates)) {
    if (skip.has(template.id)) continue
    const lifecycle = LIFECYCLE_TEMPLATES[template.id]
    if (lifecycle) {
      for (const scenario of SCENARIOS) {
        for (let ab = 0; ab < lifecycle.variantCount; ab++) {
          out[`${template.id}|${scenario.id}|ab${ab}`] = lifecycle.render({ ...SAMPLE, ...scenario.data }, SAMPLE_FOOTER_LINKS, ab)
        }
      }
    } else {
      out[`${template.id}|sample|ab0`] = template.renderSample()
    }
  }
  out['account-welcome|sample|ab0'] = account(welcomeEmail('Tobi'))
  out['account-enrolment|sample|ab0'] = account(enrollmentConfirmationEmail('Tobi', 'Data Analysis', 'https://skillsair.com/dashboard/courses/data-analysis/learn'))
  out['account-access-extended|sample|ab0'] = account(accessExtendedEmail('Tobi', '19 January 2027', 14, 'Extra time after a power outage'))
  out['lead-daily-summary|sample|ab0'] = account(leadDailySummaryEmail(LEAD_SUMMARY_SAMPLE))
  out['lead-daily-summary|empty|ab0'] = account(leadDailySummaryEmail(EMPTY_LEAD_SUMMARY))
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** The fixed environment the baseline is rendered in (links depend on FRONTEND_URL). */
export function pinBaselineEnv(): void {
  process.env.FRONTEND_URL = 'https://skillsair.com'
}
