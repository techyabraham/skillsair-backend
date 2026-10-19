import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePriceLock } from './price-lock.js'
import { assertPlanPurchasable } from './pricing.js'
import { graceEndsAt, inGrace } from './billing.js'

const now = Date.parse('2026-11-10T12:00:00Z')
const day = 86_400_000

test('price lock: window closed and no lock throws; a lock or an open window allows the scholarship plan', () => {
  assert.throws(() => assertPlanPurchasable({ kind: 'scholarship' }, false), /window has closed/)
  assert.doesNotThrow(() => assertPlanPurchasable({ kind: 'scholarship' }, false, { priceLocked: true }))
  assert.doesNotThrow(() => assertPlanPurchasable({ kind: 'scholarship' }, true))
  assert.doesNotThrow(() => assertPlanPurchasable({ kind: 'standard' }, false))
})

test('a brand-new learner has no lock', () => {
  assert.deepEqual(resolvePriceLock(5, [], [], now), { locked: false, reason: null, endsAt: null })
})

test('a lapsed scholarship learner can restart the same programme at any time', () => {
  const lock = resolvePriceLock(5, [{ course: 5, priceLocked: true }], [{ course: 5, status: 'active' }], now)
  assert.deepEqual(lock, { locked: true, reason: 'restart', endsAt: null })
})

test('a learner who paid the standard fee has no lock', () => {
  assert.equal(resolvePriceLock(5, [{ course: 5, priceLocked: false }], [{ course: 5, status: 'active' }], now).locked, false)
})

test('a graduate can start another programme at ₦2,000 a month within 3 days of finishing, not after', () => {
  const subscriptions = [{ course: 5, priceLocked: true }]
  const finished = (daysAgo: number) => [{ course: 5, status: 'completed', completedAt: new Date(now - daysAgo * day).toISOString() }]
  const within = resolvePriceLock(9, subscriptions, finished(2), now)
  assert.equal(within.locked, true)
  assert.equal(within.reason, 'next_programme')
  assert.equal(within.endsAt, new Date(now - 2 * day + 3 * day).toISOString())
  assert.equal(resolvePriceLock(9, subscriptions, finished(4), now).locked, false)
})

test('no lock on a programme the learner has already finished', () => {
  const lock = resolvePriceLock(5, [{ course: 5, priceLocked: true }], [{ course: 5, status: 'completed', completedAt: new Date(now - day).toISOString() }], now)
  assert.equal(lock.locked, false)
})

test('grace: past-due access lasts 3 days from the failed charge', () => {
  const failed = new Date(now - 2 * day).toISOString()
  assert.equal(graceEndsAt(failed), new Date(now + day).toISOString())
  assert.equal(inGrace({ status: 'past_due', lastFailedAt: failed }, now), true)
  assert.equal(inGrace({ status: 'past_due', lastFailedAt: new Date(now - 4 * day).toISOString() }, now), false)
  assert.equal(inGrace({ status: 'active', lastFailedAt: failed }, now), false)
})
