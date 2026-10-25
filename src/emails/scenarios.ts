import type { MessageData } from '../lib/lifecycle/context.js'

/**
 * Sample scenarios for the lifecycle emails: the data variants the honesty rules, the baseline
 * snapshot, the override validator and the Studio preview all render against. The first eight
 * are the honesty-test variants (brief section 16); keep their order, the baseline keys use it.
 */
export interface Scenario {
  id: string
  label: string
  data: Partial<MessageData>
}

export const SCENARIOS: Scenario[] = [
  { id: 'window-open', label: 'Scholarship window open', data: {} },
  { id: 'window-closed', label: 'Window closed', data: { windowOpen: false, closesOn: '', closesDay: '', closesAt: null } },
  { id: 'standard-fee', label: 'Joined at the standard fee', data: { joinedOnScholarship: false, priceLocked: false } },
  { id: 'repeat-2', label: 'Repeat send 2', data: { occurrence: 1 } },
  { id: 'repeat-3', label: 'Repeat send 3', data: { occurrence: 2 } },
  { id: 'repeat-4', label: 'Repeat send 4', data: { occurrence: 3 } },
  { id: 'founder-renewal', label: 'Founder story, renewal soon', data: { proof: null, founderAnecdote: 'A true memory.', renewalSoon: true } },
  { id: 'manual-billing', label: 'Pays by transfer or OPay', data: { manualBilling: true } },
  { id: 'no-exam', label: 'No exam', data: { hasFinalExam: false } },
  { id: 'needs-laptop', label: 'Needs a laptop', data: { phoneFriendly: false } },
  { id: 'with-quote', label: 'With learner quote', data: { proof: { text: 'Sample quote.', attribution: 'Ada, Data Analysis graduate' } } },
]

/** The honesty-test variants (the first eight scenarios). */
export const HONESTY_VARIANTS: Array<Partial<MessageData>> = SCENARIOS.slice(0, 8).map((scenario) => scenario.data)

export const SAMPLE_FOOTER_LINKS = {
  preferencesUrl: 'https://skillsair.com/email-preferences?token=t',
  unsubscribeUrl: 'https://skillsair.com/email-preferences?token=t',
}
