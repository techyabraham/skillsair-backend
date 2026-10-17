import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LIFECYCLE_TEMPLATES, SAMPLE } from './index.js'
import type { MessageData } from '../../lib/lifecycle/context.js'

/**
 * Brief section 16 acceptance: honest copy.
 * - Every offer and marketing email that mentions ₦2,000 says "a month" and mentions the ₦10,000
 *   certificate (receipts and dunning emails, which state an amount charged, are exempt).
 * - None of the banned phrases appear in email or WhatsApp copy.
 */
const VARIANTS: Array<Partial<MessageData>> = [
  {},
  { windowOpen: false, closesOn: '', closesDay: '', closesAt: null },
  { joinedOnScholarship: false, priceLocked: false },
  { occurrence: 1 }, { occurrence: 2 }, { occurrence: 3 },
  { proof: null, founderAnecdote: 'A true memory.', renewalSoon: true },
]
const EXEMPT = new Set(['T1', 'T2', 'T3', 'T4', 'T7', 'T9', 'D1', 'D2', 'D3', 'B1'])
const BANNED = ['one time', 'one-time', '₦2,000 once', '3 months to finish', 'up to 3 months', 'most learners', 'limited seats', 'guaranteed']

function renders() {
  return Object.values(LIFECYCLE_TEMPLATES).flatMap((template) =>
    VARIANTS.map((variant) => ({ template, rendered: template.render({ ...SAMPLE, ...variant }, { preferencesUrl: 'https://skillsair.com/email-preferences?token=t', unsubscribeUrl: 'https://skillsair.com/email-preferences?token=t' }) })),
  )
}

test('every lifecycle email renders a subject, preheader, html and text for every variant', () => {
  for (const { template, rendered } of renders()) {
    assert.ok(rendered.subject && rendered.preheader && rendered.html.includes('<html') && rendered.text.length > 40, template.id)
    assert.ok(!/undefined|null|NaN|\[object/.test(`${rendered.subject} ${rendered.preheader} ${rendered.text}`), `${template.id}: ${rendered.subject}`)
    assert.notEqual(rendered.subject, rendered.preheader, template.id)
  }
})

test('₦2,000 always says "a month", next to the ₦10,000 certificate (offers and marketing)', () => {
  for (const { template, rendered } of renders()) {
    if (EXEMPT.has(template.id)) continue
    const copy = `${rendered.subject}\n${rendered.preheader}\n${rendered.text}`
    const bare = copy.match(/₦2,000(?!(\s|-)a(\s|-)month|\/month)/g)
    assert.equal(bare, null, `${template.id} mentions ₦2,000 without "a month": ${copy.slice(copy.search(/₦2,000(?!(\s|-)a(\s|-)month)/), copy.search(/₦2,000(?!(\s|-)a(\s|-)month)/) + 60)}`)
    if (copy.includes('₦2,000')) assert.ok(copy.includes('₦10,000'), `${template.id} mentions ₦2,000 without the ₦10,000 certificate`)
  }
})

test('no banned phrases in email or WhatsApp copy', () => {
  const sources = [
    ...renders().map(({ template, rendered }) => [template.id, `${rendered.subject} ${rendered.preheader} ${rendered.text}`] as const),
    ['docs/whatsapp-templates.md', readFileSync('docs/whatsapp-templates.md', 'utf8')] as const,
    ['src/content/whatsapp-replies.ts', readFileSync('src/content/whatsapp-replies.ts', 'utf8')] as const,
    ['src/content/assistant-knowledge.ts', readFileSync('src/content/assistant-knowledge.ts', 'utf8')] as const,
  ]
  for (const [name, text] of sources) {
    for (const phrase of BANNED) assert.ok(!text.toLowerCase().includes(phrase), `${name} contains "${phrase}"`)
  }
})

test('Track G never promises the locked rate (owner: only within 3 days of finishing, in T8)', () => {
  for (const id of ['G1', 'G2', 'G3', 'G4']) {
    for (const variant of VARIANTS) {
      const text = LIFECYCLE_TEMPLATES[id]!.render({ ...SAMPLE, ...variant }).text.toLowerCase()
      assert.ok(!text.includes('locked'), `${id} mentions a locked rate`)
    }
  }
})

test('optional owner content is left out when empty', () => {
  const a2 = LIFECYCLE_TEMPLATES.A2!.render({ ...SAMPLE, founderAnecdote: null }).text
  assert.ok(!a2.includes('FOUNDER_ANECDOTE'))
  assert.ok(LIFECYCLE_TEMPLATES.A2!.render({ ...SAMPLE, founderAnecdote: 'When I was 19…' }).text.includes('When I was 19…'))
  assert.ok(!LIFECYCLE_TEMPLATES.A4!.render({ ...SAMPLE, proof: null }).text.includes('“'))
})
