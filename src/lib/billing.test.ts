import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePriceLock } from './price-lock.js'
import { assertPlanPurchasable } from './pricing.js'
import { billingFor, graceEndsAt, inGrace, manualAccessEndsAt, paystackChannels, paystackFee, PAYSTACK_FEE, subscriptionGivesAccess, withPaystackFee } from './billing.js'
import { assertManualRenewalAllowed } from './subscription-guards.js'

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

test('payment methods: transfer and OPay use their own Paystack channel; Paystack shows every option (card only for renewing plans)', () => {
  assert.deepEqual(paystackChannels('bank_transfer', true), ['bank_transfer'])
  assert.deepEqual(paystackChannels('bank_transfer', false), ['bank_transfer'])
  assert.deepEqual(paystackChannels('opay', false), ['bank'])
  assert.deepEqual(paystackChannels('paystack', true), ['card'])
  assert.equal(paystackChannels('paystack', false), undefined)
  assert.equal(billingFor('bank_transfer'), 'manual')
  assert.equal(billingFor('opay'), 'manual')
  assert.equal(billingFor('paystack'), 'card')
})

test('month-by-month access: the paid month plus the grace days, then it pauses', () => {
  const ended = new Date(now - day).toISOString()
  assert.equal(manualAccessEndsAt(ended, 3), now + 2 * day)
  assert.equal(subscriptionGivesAccess({ status: 'active', billing: 'manual', currentPeriodEnd: ended }, now), true)
  assert.equal(subscriptionGivesAccess({ status: 'active', billing: 'manual', currentPeriodEnd: new Date(now - 4 * day).toISOString() }, now), false)
  // A card plan gets no grace from the period end alone (its grace runs from a failed renewal).
  assert.equal(subscriptionGivesAccess({ status: 'active', billing: 'card', currentPeriodEnd: ended }, now), false)
  assert.equal(subscriptionGivesAccess({ status: 'cancelled', billing: 'manual', currentPeriodEnd: new Date(now + day).toISOString() }, now), true)
  assert.equal(subscriptionGivesAccess({ status: 'expired', billing: 'manual', currentPeriodEnd: new Date(now + day).toISOString() }, now), false)
})

test('month-by-month renewal: allowed in the last 7 days or the grace days; switching to card waits for the month to end', () => {
  const in10 = { id: 1, status: 'active', currentPeriodEnd: new Date(now + 10 * day).toISOString() }
  const in5 = { id: 1, status: 'active', currentPeriodEnd: new Date(now + 5 * day).toISOString() }
  const endedYesterday = { id: 1, status: 'active', currentPeriodEnd: new Date(now - day).toISOString() }
  assert.throws(() => assertManualRenewalAllowed(in10, 'manual', now), /pay for the next month from/)
  assert.doesNotThrow(() => assertManualRenewalAllowed(in5, 'manual', now))
  assert.doesNotThrow(() => assertManualRenewalAllowed(endedYesterday, 'manual', now))
  assert.throws(() => assertManualRenewalAllowed(in5, 'card', now), /switch to card/)
  assert.doesNotThrow(() => assertManualRenewalAllowed(endedYesterday, 'card', now))
})

test('Paystack fee is passed on so SkillsAir still receives the full price', () => {
  assert.equal(withPaystackFee(2000), 2031)
  assert.equal(withPaystackFee(40000), 40711)
  assert.equal(withPaystackFee(100000), 101625)
  assert.equal(paystackFee(500000), 2000) // capped
  assert.equal(paystackFee(0), 0)
  // Whatever the price, what Paystack keeps never eats into it (the ₦100 applies from ₦2,500 charged).
  for (const price of [500, 2000, 2440, 2463, 2470, 2500, 40000, 100000, 131000, 132000, 500000]) {
    const charged = withPaystackFee(price)
    const kept = Math.min(charged * PAYSTACK_FEE.percent + (charged >= PAYSTACK_FEE.flatFrom ? PAYSTACK_FEE.flat : 0), PAYSTACK_FEE.cap)
    assert.ok(charged - kept >= price, `price ${price}: charged ${charged}, Paystack keeps ${kept}`)
  }
})
