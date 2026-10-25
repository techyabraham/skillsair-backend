import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editableEntries, renderCases, type EditableEntry } from './catalog.js'
import { fromFields, type EmailOverride } from './copy.js'
import { withOverrides, SETTINGS_ID, SHARED_ID } from './override-store.js'
import { SHARED_COPY } from './lifecycle/shared.js'
import { LIFECYCLE_TEMPLATES, SAMPLE } from './lifecycle/index.js'
import { lifecycleVars } from './copy-vars.js'
import { SAMPLE_FOOTER_LINKS, SCENARIOS } from './scenarios.js'
import { leadDailySummary } from './account-lead-summary.js'
import { senderAddress } from '../lib/resend.js'
import { emailTemplates } from './index.js'

/**
 * Brief section 8.6: every slot is wired in (its marker shows up in at least one render), and no
 * hard-coded English is left outside slots once data values, receipt rows and the layout's own
 * sign-off and footer are taken out.
 */
const marker = (entry: string, key: string) => `«${entry}.${key}»`

/** A marker for every slot, keeping the placeholders it must keep and the ones that carry another slot. */
function markers(entry: EditableEntry): EmailOverride {
  const fields: Record<string, string> = {}
  for (const [key, slot] of Object.entries(entry.copy)) {
    fields[key] = [marker(entry.id, key), ...new Set([...(slot.required ?? []), ...Object.keys(slot.vars ?? {})])].map((part) => (part.startsWith('«') ? part : `{{${part}}}`)).join(' ')
  }
  return fromFields(fields)!
}

/** Extra data, for coverage only, that reaches the branches the sample scenarios don't (no card on file, not started...). */
const BARE: Partial<typeof SAMPLE> = { cardLast4: '', cardExpiry: '', lesson1Minutes: null, nextLessonTitle: '', lessonsLeft: 0, progressPercent: 0, periodEnd: '', graceEnds: '', billingDay: '' }
const COVERAGE_DATA: Array<Partial<typeof SAMPLE>> = [
  BARE,
  { ...BARE, lesson1Title: '', joinedOnScholarship: false, renewalSoon: true },
  { progressPercent: 85 },
  { windowOpen: false, priceLocked: false },
]

function coverageRenders(id: string): string[] {
  const lifecycle = LIFECYCLE_TEMPLATES[id]
  const out = renderCases(id).map(({ rendered }) => rendered)
  if (lifecycle) for (const data of COVERAGE_DATA) for (let ab = 0; ab < lifecycle.variantCount; ab++) out.push(lifecycle.render({ ...SAMPLE, ...data }, SAMPLE_FOOTER_LINKS, ab))
  if (id === leadDailySummary.id) out.push(leadDailySummary.render({ ...leadDailySummary.sample, bySchool: [], bySource: [], topLeads: [] }))
  return out.map((rendered) => `${rendered.subject}\n${rendered.preheader}\n${rendered.html}\n${rendered.text}`)
}

const entries = editableEntries()
const sharedEntry = entries.find((entry) => entry.id === SHARED_ID)!

test('every slot appears in the output for at least one scenario', () => {
  const missing: string[] = []
  for (const entry of entries) {
    const substitute = { [entry.id]: markers(entry) }
    const affected = entry.id === SHARED_ID ? Object.keys(LIFECYCLE_TEMPLATES) : entry.id === SETTINGS_ID ? Object.keys(emailTemplates) : [entry.id]
    const output = withOverrides(substitute, () =>
      [
        ...affected.flatMap(coverageRenders),
        senderAddress('marketing'),
      ].join('\n'),
    )
    for (const key of Object.keys(entry.copy)) if (!output.includes(marker(entry.id, key))) missing.push(`${entry.id}.${key}`)
  }
  assert.deepEqual(missing, [], `slots never rendered: ${missing.join(', ')}`)
})

/** Text the layout and data supply (not slots): removed before looking for leftover English. */
function dataStrings(data: typeof SAMPLE): string[] {
  const values: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === 'string' && value) values.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(data)
  walk(lifecycleVars(data))
  // Values templates compute and pass to their own slots (P2's subject: the school without "School of").
  values.push(data.school.replace(/^School of /i, ''))
  return values
}

const LAYOUT = [
  "You're getting this because you're learning with SkillsAir.",
  "You're getting this because you applied for a SkillsAir programme and said yes to updates.",
  'This is an account email about your SkillsAir application, payments or learning.',
  'We never sell your data.',
  'Privacy notice:',
  'Email preferences:',
  'Unsubscribe:',
  '(no longer applies)',
  'P.S.',
  'SKILLS AIR LIMITED (RC 9272398), Osifila Street, Anifowose, Ikeja, Lagos.',
  'Imisi, SkillsAir',
  'Questions? Reply to this email, or WhatsApp me on +234 818 212 6524 (Mon–Sat, 9am–6pm).',
]
const RECEIPT_ROW = /^(Amount|Reference|Date|Paid to|Programme|Paid until|Next payment|For): .*$/gm

test('no hard-coded English is left outside slots (lifecycle emails, plain-text part)', () => {
  const leftovers: string[] = []
  for (const template of Object.values(LIFECYCLE_TEMPLATES)) {
    const entry = entries.find((item) => item.id === template.id)!
    const substitute = { [template.id]: markers(entry), [SHARED_ID]: markers(sharedEntry) }
    for (const scenario of SCENARIOS) {
      const data = { ...SAMPLE, ...scenario.data }
      for (let ab = 0; ab < template.variantCount; ab++) {
        const rendered = withOverrides(substitute, () => template.render(data, { preferencesUrl: 'https://x.test/p', unsubscribeUrl: 'https://x.test/u' }, ab))
        let rest = `${rendered.subject}\n${rendered.preheader}\n${rendered.text}`.replace(RECEIPT_ROW, '')
        rest = rest.replace(/«[^»]+»/g, ' ').replace(/https?:\/\/\S+/g, ' ')
        for (const piece of [...LAYOUT, ...dataStrings(data)].sort((a, b) => b.length - a.length)) rest = rest.split(piece).join(' ')
        // What's left may only be punctuation, numbers, list markers and spacing.
        const words = rest.match(/[A-Za-z]{2,}/g)
        if (words) leftovers.push(`${template.id} (${scenario.id}, ab${ab}): ${[...new Set(words)].join(' ')}`)
      }
    }
  }
  assert.deepEqual([...new Set(leftovers)], [])
})

test('the shared phrases cover every key in SHARED_COPY', () => {
  assert.deepEqual(Object.keys(sharedEntry.copy), Object.keys(SHARED_COPY))
})
