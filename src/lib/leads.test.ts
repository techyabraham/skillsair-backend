import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateResumeCode, isAdvisorHours, normalizePhone, scoreLeadEvent, type LeadDoc } from './leads.js'

test('Nigerian numbers in every common shape normalise to the same E.164 number', () => {
  const expected = '+2348182126524'
  for (const input of ['08182126524', '8182126524', '+2348182126524', '2348182126524', '0818 212 6524', '+234 (818) 212-6524']) {
    assert.equal(normalizePhone(input), expected, input)
  }
})

test('short or malformed numbers are rejected', () => {
  for (const input of ['0818212652', '12345', '+234818', 'not a number', '']) {
    assert.equal(normalizePhone(input), null, input)
  }
})

test('international numbers in full format are accepted', () => {
  assert.equal(normalizePhone('+44 7700 900123'), '+447700900123')
})

test('resume codes are 10 URL-safe characters', () => {
  const code = generateResumeCode()
  assert.match(code, /^[A-Za-z0-9]{10}$/)
  assert.notEqual(code, generateResumeCode())
})

const baseLead = { id: 1, status: 'new', score: 0, offerViewCount: 0 } as unknown as LeadDoc

test('talking to Imisi scores +40 and joins the queue', () => {
  const update = scoreLeadEvent(baseLead, { type: 'talk' })
  assert.equal(update.score, 40)
  assert.equal(update.needsHuman, true)
})

test('a second offer view scores +20 once and moves the status on', () => {
  const first = scoreLeadEvent(baseLead, { type: 'offer_viewed' })
  assert.equal(first.offerViewCount, 1)
  assert.equal(first.score, undefined)
  assert.equal(first.status, 'offer_viewed')
  const second = scoreLeadEvent({ ...baseLead, offerViewCount: 1, status: 'offer_viewed' }, { type: 'offer_viewed' })
  assert.equal(second.score, 20)
  const third = scoreLeadEvent({ ...baseLead, offerViewCount: 2, score: 20 }, { type: 'offer_viewed' })
  assert.equal(third.score, undefined)
})

test('scores are capped at 100 and paying leaves the queue', () => {
  assert.equal(scoreLeadEvent({ ...baseLead, score: 90 }, { type: 'free_text' }).score, 100)
  const paid = scoreLeadEvent({ ...baseLead, needsHuman: true }, { type: 'paid' })
  assert.equal(paid.status, 'paid')
  assert.equal(paid.needsHuman, false)
})

test('paid leads are not pushed back into the queue', () => {
  const update = scoreLeadEvent({ ...baseLead, status: 'paid' }, { type: 'free_text' })
  assert.equal(update.needsHuman, undefined)
  assert.equal(update.score, undefined)
})

test('advisor hours are Monday–Saturday 9am–6pm Lagos time', () => {
  assert.equal(isAdvisorHours(new Date('2026-10-19T08:30:00Z')), true) // Mon 9:30 WAT
  assert.equal(isAdvisorHours(new Date('2026-10-19T07:30:00Z')), false) // Mon 8:30 WAT
  assert.equal(isAdvisorHours(new Date('2026-10-24T16:59:00Z')), true) // Sat 5:59pm WAT
  assert.equal(isAdvisorHours(new Date('2026-10-24T17:00:00Z')), false) // Sat 6pm WAT
  assert.equal(isAdvisorHours(new Date('2026-10-25T10:00:00Z')), false) // Sunday
})
