import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateOverride, type Issue } from './validate-override.js'
import type { EmailOverride } from './copy.js'

/** Brief section 8.3: one test per error and warning rule. */
const errorsOf = (id: string, override: EmailOverride) => validateOverride(id, override).errors
const warningsOf = (id: string, override: EmailOverride) => validateOverride(id, override).warnings
const has = (issues: Issue[], field: string, pattern: RegExp) => issues.some((issue) => issue.field === field && pattern.test(issue.message))

test('a clean override has no errors or warnings', () => {
  const result = validateOverride('A1', { subject: 'Two questions people ask me', slots: { intro: 'Imisi here. I answer your WhatsApp messages, so you’ll hear from me this week.' } })
  assert.deepEqual(result, { errors: [], warnings: [] })
  assert.deepEqual(validateOverride('A1', null), { errors: [], warnings: [] })
})

test('unknown template and unknown slot keys are errors', () => {
  assert.ok(has(errorsOf('Z9', { subject: 'x' }), '_', /No email/))
  assert.ok(has(errorsOf('A1', { slots: { notASlot: 'Hello' } }), 'notASlot', /no longer exists/))
})

test('placeholders the template doesn’t have are errors', () => {
  assert.ok(has(errorsOf('A1', { slots: { intro: 'Hi {{courseName}}' } }), 'intro', /Unknown placeholder \{\{courseName\}\}/))
  // A slot's own extra placeholder is allowed there only.
  assert.deepEqual(errorsOf('B1', { slots: { reversal: 'Reply with your reference{{referenceInBrackets}}.' } }), [])
  assert.ok(has(errorsOf('B1', { slots: { intro: 'Ref{{referenceInBrackets}}' } }), 'intro', /Unknown placeholder/))
})

test('removing a required placeholder is an error', () => {
  assert.ok(has(errorsOf('T2', { subject: 'Your receipt for {{programme}}' }), 'subject', /\{\{amount\}\} must stay/))
})

test('over maxLength is an error', () => {
  assert.ok(has(errorsOf('A1', { subject: 'x'.repeat(91) }), 'subject', /Too long: 91/))
  assert.ok(has(errorsOf('A1', { slots: { ctaLabel: 'y'.repeat(41) } }), 'ctaLabel', /Too long/))
})

test('an empty subject or button label (only spaces) is an error', () => {
  assert.ok(has(errorsOf('A1', { subject: '   ' }), 'subject', /only spaces/))
  assert.ok(has(errorsOf('A1', { slots: { ctaLabel: ' ' } }), 'ctaLabel', /only spaces/))
})

test('HTML tags and javascript: are errors', () => {
  assert.ok(has(errorsOf('A1', { slots: { intro: 'Hi <b>there</b>' } }), 'intro', /HTML tags/))
  assert.ok(has(errorsOf('A1', { slots: { intro: 'Go to javascript:alert(1)' } }), 'intro', /javascript/))
})

test('unbalanced ** is an error', () => {
  assert.ok(has(errorsOf('A1', { slots: { intro: 'A **bold claim' } }), 'intro', /Unbalanced \*\*/))
})

test('an unclosed placeholder is an error', () => {
  assert.ok(has(errorsOf('A1', { slots: { intro: 'Hi {{firstName' } }), 'intro', /isn’t closed/))
})

test('a variant count that differs from the code is an error', () => {
  assert.ok(has(errorsOf('A2', { variants: [{ subject: 'Another subject' }] }), 'variants', /0 A\/B alternatives/))
  assert.ok(has(errorsOf('A2', { variants: [{ subject: 'Another subject' }] }), 'variant1Subject', /A\/B/))
})

test('a banned phrase is rejected by the render check', () => {
  assert.ok(has(errorsOf('A1', { slots: { intro: 'Hurry, limited seats left.' } }), 'intro', /Banned phrase “limited seats”/))
})

test('₦2,000 without “a month” is rejected (offers and marketing)', () => {
  assert.ok(has(errorsOf('A1', { slots: { intro: 'It costs only ₦2,000.' } }), 'intro', /a month/))
  // Receipts are exempt.
  assert.ok(!errorsOf('T1', { slots: { intro: 'You paid ₦2,000 today for {{programme}}.' } }).some((issue) => /a month/.test(issue.message)))
})

test('no job or income guarantees and no level words', () => {
  assert.ok(has(errorsOf('A1', { slots: { intro: 'We guarantee a job when you finish.' } }), 'intro', /job or income|guarantee/i))
  assert.ok(has(errorsOf('A1', { slots: { intro: 'You could earn millions.' } }), 'intro', /job or income/))
  assert.ok(has(errorsOf('A1', { slots: { intro: 'Perfect for beginners.' } }), 'intro', /Level word/))
})

test('the certificate fee before someone finishes is rejected', () => {
  assert.ok(has(errorsOf('A1', { slots: { intro: 'The certificate is ₦10,000.' } }), 'intro', /certificate fee/))
})

test('a shared phrase is checked in every email that uses it', () => {
  assert.ok(errorsOf('_shared', { slots: { greeting: 'Hi {{firstName}}, limited seats!' } }).some((issue) => issue.field === 'greeting' && /limited seats/.test(issue.message)))
  assert.deepEqual(errorsOf('_shared', { slots: { greeting: 'Hello {{firstName}},' } }), [])
})

test('email settings: the company line keeps RC 9272398, the help line a way to reply', () => {
  assert.ok(has(errorsOf('_settings', { slots: { companyLine: 'SkillsAir, Lagos.' } }), 'companyLine', /RC 9272398/))
  assert.ok(has(errorsOf('_settings', { slots: { signOffHelp: 'Questions? Ask us.' } }), 'signOffHelp', /phone number/))
  assert.deepEqual(errorsOf('_settings', { slots: { signOffHelp: 'Questions? Reply to this email.', companyLine: 'SKILLS AIR LIMITED (RC 9272398), Lagos.' } }), [])
  assert.ok(has(errorsOf('_settings', { slots: { senderName: 'Imisi <imisi@x.com>' } }), 'senderName', /can’t contain/))
})

test('warning: American spelling', () => {
  assert.ok(has(warningsOf('A1', { slots: { intro: 'Pick your favorite color.' } }), 'intro', /favourite/))
  assert.deepEqual(errorsOf('A1', { slots: { intro: 'Pick your favorite color.' } }), [])
})

test('warning: a subject over 60 characters', () => {
  assert.ok(has(warningsOf('A1', { subject: 'This subject line is long enough that a phone will cut it off early' }), 'subject', /60/))
})

test('warning: a preview text that repeats the subject', () => {
  assert.ok(has(warningsOf('A1', { subject: 'Two questions', preheader: 'Two questions, answered straight.' }), 'preheader', /repeats the subject/))
})

test('warning: more than one **bold** in a paragraph', () => {
  assert.ok(has(warningsOf('A1', { slots: { intro: '**One** and **two**.' } }), 'intro', /More than one \*\*bold\*\*/))
})
