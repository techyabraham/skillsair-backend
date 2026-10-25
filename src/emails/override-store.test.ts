import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Payload } from 'payload'
import { createOverrideStore, getOverride, getSettings, resetStore, type EmailSettings } from './override-store.js'
import type { EmailOverride } from './copy.js'
import { LIFECYCLE_TEMPLATES, SAMPLE } from './lifecycle/index.js'
import { signOffName } from './layout.js'

/** Brief section 8.4: version polling reloads, failures keep the last good copy, render never throws. */
const payload = {} as Payload

function fakes() {
  const state = {
    version: '1' as string | null,
    redisDown: false,
    dbDown: false,
    reads: 0,
    rows: [{ templateId: 'A1', published: { subject: 'Edited subject' } as EmailOverride | null }],
    settings: {} as EmailSettings,
    clock: 0,
  }
  const redis = {
    get: async () => {
      if (state.redisDown) throw new Error('redis down')
      return state.version
    },
  }
  const read = async () => {
    state.reads++
    if (state.dbDown) throw new Error('db down')
    return { rows: state.rows.map((row) => ({ ...row })), settings: { ...state.settings } }
  }
  return { state, options: { redis, read, pollMs: 0, fallbackMs: 5 * 60_000, now: () => state.clock } }
}

test('the store loads at start and a version change in Redis triggers a reload', async () => {
  resetStore()
  const { state, options } = fakes()
  const store = createOverrideStore(payload, options)
  assert.equal(await store.ready, true)
  assert.equal(getOverride('A1')?.subject, 'Edited subject')
  assert.equal(LIFECYCLE_TEMPLATES.A1!.render(SAMPLE).subject, 'Edited subject')

  await store.tick()
  assert.equal(state.reads, 1, 'same version: no reload')

  state.rows = [{ templateId: 'A1', published: { subject: 'Second edit' } }]
  state.settings = { signOffName: 'Imisi at SkillsAir' }
  state.version = '2'
  await store.tick()
  assert.equal(state.reads, 2)
  assert.equal(getOverride('A1')?.subject, 'Second edit')
  assert.equal(getSettings().signOffName, 'Imisi at SkillsAir')
  assert.equal(signOffName(), 'Imisi at SkillsAir')
  store.stop()
  resetStore()
})

test('Redis down: keeps the last good copy, and reloads every 5 minutes anyway', async () => {
  resetStore()
  const { state, options } = fakes()
  const store = createOverrideStore(payload, options)
  await store.ready
  state.redisDown = true
  state.rows = [{ templateId: 'A1', published: { subject: 'While Redis was down' } }]
  state.clock = 60_000
  await store.tick()
  assert.equal(state.reads, 1, 'no reload before the fallback interval')
  assert.equal(getOverride('A1')?.subject, 'Edited subject')
  state.clock = 5 * 60_000 + 1
  await store.tick()
  assert.equal(state.reads, 2)
  assert.equal(getOverride('A1')?.subject, 'While Redis was down')
  store.stop()
  resetStore()
})

test('database down: the last good copy stays in place', async () => {
  resetStore()
  const { state, options } = fakes()
  const store = createOverrideStore(payload, options)
  await store.ready
  state.dbDown = true
  state.version = '9'
  await store.tick()
  assert.equal(getOverride('A1')?.subject, 'Edited subject')
  assert.equal(await store.reload(), false)
  assert.equal(getOverride('A1')?.subject, 'Edited subject')
  store.stop()
  resetStore()
})

test('render never throws, whatever was published', async () => {
  resetStore()
  const { state, options } = fakes()
  state.rows = [
    { templateId: 'A1', published: { subject: 7, variants: 'no', slots: { intro: null, setup: '{{nope}}' } } as unknown as EmailOverride },
    { templateId: '_shared', published: { slots: { greeting: '<b>hi</b>' } } },
    { templateId: 'T1', published: 'not an object' as unknown as EmailOverride },
  ]
  state.settings = { companyLine: '' }
  const store = createOverrideStore(payload, options)
  await store.ready
  for (const template of Object.values(LIFECYCLE_TEMPLATES)) {
    assert.doesNotThrow(() => template.render(SAMPLE), template.id)
  }
  assert.equal(LIFECYCLE_TEMPLATES.A1!.render(SAMPLE).subject, 'Two questions everyone asks me')
  assert.ok(LIFECYCLE_TEMPLATES.A1!.render(SAMPLE).text.startsWith('Hi Tobi,'))
  store.stop()
  resetStore()
})

test('with nothing loaded, templates render the defaults', () => {
  resetStore()
  assert.equal(getOverride('A1'), null)
  assert.deepEqual(getSettings(), {})
  assert.equal(LIFECYCLE_TEMPLATES.A1!.render(SAMPLE).subject, 'Two questions everyone asks me')
})
