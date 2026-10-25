import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LIFECYCLE_TEMPLATES, SAMPLE } from './index.js'
import { AFTER_FINISHING, BANNED, HONESTY_VARIANTS, bareMonthly, claims, honestyProblems } from '../honesty-rules.js'
import { variantFor } from '../../lib/lifecycle/templates.js'

/**
 * Brief section 16 acceptance: honest copy.
 * - Every offer and marketing email that mentions ₦2,000 says "a month" and mentions the ₦10,000
 *   certificate (receipts and dunning emails, which state an amount charged, are exempt).
 * - None of the banned phrases appear in email or WhatsApp copy.
 */
const VARIANTS = HONESTY_VARIANTS

function renders() {
  const links = { preferencesUrl: 'https://skillsair.com/email-preferences?token=t', unsubscribeUrl: 'https://skillsair.com/email-preferences?token=t' }
  return Object.values(LIFECYCLE_TEMPLATES).flatMap((template) =>
    VARIANTS.flatMap((variant) =>
      Array.from({ length: template.variantCount }, (_, ab) => ({ template, rendered: template.render({ ...SAMPLE, ...variant }, links, ab) })),
    ),
  )
}

test('every lifecycle email renders a subject, preheader, html and text for every variant', () => {
  for (const { template, rendered } of renders()) {
    assert.ok(rendered.subject && rendered.preheader && rendered.html.includes('<html') && rendered.text.length > 40, template.id)
    assert.ok(!/undefined|null|NaN|\[object/.test(`${rendered.subject} ${rendered.preheader} ${rendered.text}`), `${template.id}: ${rendered.subject}`)
    assert.notEqual(rendered.subject, rendered.preheader, template.id)
  }
})

test('₦2,000 always says "a month" (offers and marketing)', () => {
  for (const { template, rendered } of renders()) {
    assert.deepEqual(bareMonthly(template.id, rendered), [], `${template.id} mentions ₦2,000 without "a month"`)
  }
})

test('every render passes the shared honesty rules (the same ones Studio runs on publish)', () => {
  for (const { template, rendered } of renders()) assert.deepEqual(honestyProblems(template.id, rendered), [], template.id)
})

test('no job or income guarantees and no level words', () => {
  for (const { template, rendered } of renders()) assert.deepEqual(claims(`${rendered.subject} ${rendered.preheader} ${rendered.text}`), [], template.id)
})

test('no banned phrases in email or WhatsApp copy', () => {
  const sources = [
    ...renders().map(({ template, rendered }) => [template.id, `${rendered.subject} ${rendered.preheader} ${rendered.text}`] as const),
    ['docs/whatsapp-templates.md', readFileSync('docs/whatsapp-templates.md', 'utf8')] as const,
    ['src/content/whatsapp-replies.ts', readFileSync('src/content/whatsapp-replies.ts', 'utf8')] as const,
    ['src/content/assistant-knowledge.ts', readFileSync('src/content/assistant-knowledge.ts', 'utf8')] as const,
    ['src/content/email-replies.ts', readFileSync('src/content/email-replies.ts', 'utf8')] as const,
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

test('A/B: each person always gets the same version; only A0, A1, A6, B1 and T6 are tested', () => {
  const tested = Object.values(LIFECYCLE_TEMPLATES).filter((template) => template.variantCount > 1).map((template) => template.id).sort()
  assert.deepEqual(tested, ['A0', 'A1', 'A6', 'B1', 'T6'])
  const seen = new Set<number>()
  for (let id = 1; id <= 50; id++) {
    const first = variantFor('A1', `user:${id}`)
    assert.equal(variantFor('A1', `user:${id}`), first)
    seen.add(first)
  }
  assert.deepEqual([...seen].sort(), [0, 1])
  assert.equal(variantFor('A2', 'user:1'), 0)
})

test('the certificate fee only appears after someone has finished', () => {
  for (const { template, rendered } of renders()) {
    if (AFTER_FINISHING.has(template.id)) continue
    const copy = `${rendered.subject}\n${rendered.preheader}\n${rendered.text}`
    assert.ok(!copy.includes('₦10,000'), `${template.id} quotes the certificate fee before the learner has finished`)
  }
  for (const file of ['src/content/whatsapp-replies.ts', 'src/content/email-replies.ts', 'src/content/assistant-knowledge.ts']) {
    assert.ok(!readFileSync(file, 'utf8').includes('₦10,000'), `${file} quotes the certificate fee`)
  }
})
