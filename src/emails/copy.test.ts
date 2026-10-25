import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromFields, interpolate, overrideFields, placeholdersIn } from './copy.js'
import { withOverrides } from './override-store.js'
import { LIFECYCLE_TEMPLATES, SAMPLE } from './lifecycle/index.js'
import { passwordReset } from './password-reset.js'

/** Brief section 8.2: the interpolator, resolver precedence, shared slots and field-level fallback. */
const A1 = LIFECYCLE_TEMPLATES.A1!
const T1 = LIFECYCLE_TEMPLATES.T1!

test('interpolate fills {{name}} once, renders unknown names empty and reports them', () => {
  const unknown: string[] = []
  assert.equal(interpolate('Hi {{firstName}}, {{ programme }}!', { firstName: 'Tobi', programme: 'Data Analysis' }), 'Hi Tobi, Data Analysis!')
  assert.equal(interpolate('Hi {{nope}}.', {}, (name) => unknown.push(name)), 'Hi .')
  assert.deepEqual(unknown, ['nope'])
  // A value is never interpolated again, and no expressions run.
  assert.equal(interpolate('{{a}}', { a: '{{b}}', b: 'x' }), '{{b}}')
  assert.equal(interpolate('{{a.b}} {{constructor}}', {}), '{{a.b}} ')
  assert.deepEqual(placeholdersIn('{{a}} {{b}} {{a}}'), ['a', 'b'])
})

test('an override can’t inject HTML, and **bold** keeps working', () => {
  const html = withOverrides({ A1: { slots: { intro: 'Fees & "quotes" 5 > 4 with a **big** word' } } }, () => A1.render(SAMPLE).html)
  assert.ok(html.includes('Fees &amp; &quot;quotes&quot; 5 &gt; 4 with a <strong>big</strong> word'))
  // A tag is rejected outright: the field falls back to the original wording.
  const tagged = withOverrides({ A1: { slots: { intro: '<script>alert(1)</script>' } } }, () => A1.render(SAMPLE).html)
  assert.ok(!tagged.includes('<script>') && !tagged.includes('alert(1)'))
  assert.ok(tagged.includes('Imisi here again.'))
})

test('the published override wins over the default, with placeholders filled', () => {
  const before = A1.render(SAMPLE)
  const after = withOverrides({ A1: { subject: 'Two quick answers, {{firstName}}', slots: { intro: 'Hello from {{programme}}.' } } }, () => A1.render(SAMPLE))
  assert.equal(after.subject, 'Two quick answers, Tobi')
  assert.ok(after.text.includes('Hello from Data Analysis.'))
  assert.ok(!after.text.includes('Imisi here again.'))
  assert.equal(A1.render(SAMPLE).text, before.text, 'the substitution doesn’t outlive the render')
})

test('A/B variants and list slots are overridable', () => {
  const b = withOverrides({ A1: { variants: [{ subject: 'Version B, {{firstName}}' }] } }, () => A1.render(SAMPLE, {}, 1))
  assert.equal(b.subject, 'Version B, Tobi')
  const list = withOverrides({ T1: { slots: { firstList: 'One\n\nTwo  \nThree' } } }, () => T1.render(SAMPLE).text)
  assert.ok(list.includes('1. One\n2. Two\n3. Three'))
})

test('shared phrases apply across every template that uses them', () => {
  const texts = withOverrides({ _shared: { slots: { greeting: 'Hello {{firstName}}!' } } }, () => [A1, T1, LIFECYCLE_TEMPLATES.G1!].map((template) => template.render(SAMPLE).text))
  for (const text of texts) assert.ok(text.startsWith('Hello Tobi!'), text.slice(0, 40))
  // Account templates have their own greeting.
  assert.ok(withOverrides({ _shared: { slots: { greeting: 'Hello!' } } }, () => passwordReset.renderSample().text).startsWith('Hi Tobi,'))
})

test('an invalid published field falls back to the default, field by field, without throwing', () => {
  const rendered = withOverrides(
    {
      A1: {
        subject: 'Questions for {{nobody}}',
        slots: { intro: 'Still good, {{firstName}}.', removedSlot: 'Gone', setup: 'x'.repeat(10) + ' **unbalanced' },
      },
    },
    () => A1.render(SAMPLE),
  )
  assert.equal(rendered.subject, 'Two questions everyone asks me')
  assert.ok(rendered.text.includes('Still good, Tobi.'))
  assert.ok(rendered.text.includes('Almost everyone who applies asks me the same two things.'))
  assert.ok(!rendered.text.includes('Gone'))
  // Junk that isn't even a string never breaks a render.
  assert.doesNotThrow(() => withOverrides({ A1: { slots: { intro: 42 as unknown as string } } }, () => A1.render(SAMPLE)))
})

test('fromFields and overrideFields round-trip, and empty fields mean the default', () => {
  const override = fromFields({ subject: 'S', preheader: '  ', variant1Subject: 'B', intro: 'I\r\nJ', blank: '' })
  assert.deepEqual(override, { subject: 'S', variants: [{ subject: 'B' }], slots: { intro: 'I\nJ' } })
  assert.deepEqual(overrideFields(override), { subject: 'S', variant1Subject: 'B', intro: 'I\nJ' })
  assert.equal(fromFields({ subject: ' ' }), null)
})
