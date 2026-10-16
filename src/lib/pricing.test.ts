import { test } from 'node:test'
import assert from 'node:assert/strict'
import { certificatePrice, effectiveCoursePrice, windowIsOpen } from './pricing.js'

const now = Date.parse('2026-10-20T12:00:00+01:00')
const course = { price: 2000, standardPrice: 100000 }

test('an open window charges the scholarship price', () => {
  const open = windowIsOpen({ isOpen: true, closesAt: '2026-10-31T23:59:00+01:00' }, now)
  assert.equal(open, true)
  assert.equal(effectiveCoursePrice(course, open), 2000)
})

test('a window whose closing time has passed charges the standard fee', () => {
  const open = windowIsOpen({ isOpen: true, closesAt: '2026-10-19T23:59:00+01:00' }, now)
  assert.equal(open, false)
  assert.equal(effectiveCoursePrice(course, open), 100000)
})

test('a switched-off window or one without a closing date is closed', () => {
  assert.equal(windowIsOpen({ isOpen: false, closesAt: '2026-10-31T23:59:00+01:00' }, now), false)
  assert.equal(windowIsOpen({ isOpen: true, closesAt: null }, now), false)
  assert.equal(windowIsOpen(null, now), false)
})

test('a window that has not opened yet is closed', () => {
  assert.equal(windowIsOpen({ isOpen: true, opensAt: '2026-10-25T00:00:00+01:00', closesAt: '2026-10-31T23:59:00+01:00' }, now), false)
})

test('courses without a standard fee keep their single price in both states', () => {
  assert.equal(effectiveCoursePrice({ price: 15000 }, false), 15000)
  assert.equal(effectiveCoursePrice({ price: 15000, standardPrice: null }, true), 15000)
})

test('certificate price defaults to ₦10,000 and respects the env var', () => {
  const original = process.env.CERTIFICATE_PRICE_NGN
  delete process.env.CERTIFICATE_PRICE_NGN
  assert.equal(certificatePrice(), 10000)
  process.env.CERTIFICATE_PRICE_NGN = '7500'
  assert.equal(certificatePrice(), 7500)
  process.env.CERTIFICATE_PRICE_NGN = '0'
  assert.equal(certificatePrice(), 0)
  if (original === undefined) delete process.env.CERTIFICATE_PRICE_NGN
  else process.env.CERTIFICATE_PRICE_NGN = original
})

test('a one-off programme payment is always the standard fee (the scholarship is monthly only)', async () => {
  const { oneOffCoursePrice } = await import('./pricing.js')
  assert.equal(oneOffCoursePrice({ price: 2000, standardPrice: 100000 }), 100000)
  assert.equal(oneOffCoursePrice({ price: 15000 }), 15000)
})

test('the ₦2,000/month scholarship plan can only be started while a window is open', async () => {
  const { assertPlanPurchasable } = await import('./pricing.js')
  assert.doesNotThrow(() => assertPlanPurchasable({ kind: 'scholarship' }, true))
  assert.throws(() => assertPlanPurchasable({ kind: 'scholarship' }, false), /window has closed/)
  assert.doesNotThrow(() => assertPlanPurchasable({ kind: 'standard' }, false))
  assert.doesNotThrow(() => assertPlanPurchasable({}, false))
})
