import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocateByWeight, attemptAllowance, attemptExpiry, drawQuestions, examSize, isCorrect, optionOrder, scoreAttempt, seededRandom, toDisplayedIndexes, toOriginalIndexes } from './assessments.js'

const pool = (sections: Record<number, number>) => Object.entries(sections).flatMap(([sectionId, count]) => Array.from({ length: count }, (_, i) => ({ id: Number(sectionId) * 100 + i, sectionId: Number(sectionId) })))

test('draw: a plain sample has no repeats and respects the count', () => {
  const ids = drawQuestions(pool({ 1: 25 }), 10, { random: seededRandom(1) })
  assert.equal(ids.length, 10)
  assert.equal(new Set(ids).size, 10)
  assert.equal(drawQuestions(pool({ 1: 4 }), 10).length, 4)
})

test('draw: final exam is weighted by chapter length with at least 2 per chapter', () => {
  const weights = new Map([[1, 3600], [2, 600], [3, 600], [4, 7200]])
  const ids = drawQuestions(pool({ 1: 8, 2: 8, 3: 8, 4: 8 }), 20, { random: seededRandom(7), sectionWeights: weights })
  assert.equal(ids.length, 20)
  assert.equal(new Set(ids).size, 20)
  const per = (section: number) => ids.filter((id) => Math.floor(id / 100) === section).length
  for (const section of [1, 2, 3, 4]) assert.ok(per(section) >= 2, `section ${section} has ${per(section)}`)
  assert.ok(per(4) > per(2), 'the longest chapter gets more questions than a short one')
  assert.equal(per(4), 8, 'never more than a chapter has')
})

test('draw: allocation never exceeds what chapters have and fills the total when it can', () => {
  const allocation = allocateByWeight([{ id: 1, weight: 100, available: 3 }, { id: 2, weight: 1, available: 30 }], 12)
  assert.equal(allocation.get(1), 3)
  assert.equal(allocation.get(2), 9)
})

test('shuffle: option order is a permutation and maps answers both ways', () => {
  const order = optionOrder(4, seededRandom(3))
  assert.deepEqual([...order].sort(), [0, 1, 2, 3])
  const shownCorrect = toDisplayedIndexes([2], order)
  assert.deepEqual(toOriginalIndexes(shownCorrect, order), [2])
})

test('scoring: single, multiple and true/false need exactly the correct options', () => {
  assert.ok(isCorrect({ correctIndexes: [1] }, [1]))
  assert.ok(!isCorrect({ correctIndexes: [1] }, [1, 2]))
  assert.ok(isCorrect({ correctIndexes: [0, 3] }, [3, 0]))
  assert.ok(!isCorrect({ correctIndexes: [0, 3] }, [0]))
  assert.ok(!isCorrect({ correctIndexes: [] }, []))
  const result = scoreAttempt(
    [
      { id: 1, type: 'single', sectionId: 10, optionCount: 4, correctIndexes: [2] },
      { id: 2, type: 'multiple', sectionId: 10, optionCount: 4, correctIndexes: [0, 1] },
      { id: 3, type: 'true_false', sectionId: 20, optionCount: 2, correctIndexes: [0] },
      { id: 4, type: 'single', sectionId: 20, optionCount: 4, correctIndexes: [3] },
    ],
    { 1: [0], 2: [1, 0], 3: [1] },
    { 1: [2, 0, 1, 3] },
  )
  assert.equal(result.correctCount, 2)
  assert.equal(result.score, 50)
  assert.deepEqual(result.perSection.find((s) => s.sectionId === 10), { sectionId: 10, correct: 2, total: 2, percent: 100 })
  assert.deepEqual(result.perSection.find((s) => s.sectionId === 20), { sectionId: 20, correct: 0, total: 2, percent: 0 })
})

test('attempts: 3 fails then a cooldown, then 3 more; unlimited when no limit', () => {
  const hour = 3_600_000
  const t0 = Date.UTC(2026, 9, 23, 9)
  const fail = (h: number) => ({ passed: false, endedAt: t0 + h * hour })
  const rules = { maxAttempts: 3, cooldownHours: 48 }
  assert.deepEqual(attemptAllowance([], rules, t0), { allowed: true, attemptsLeft: 3, opensAt: null, alreadyPassed: false })
  assert.equal(attemptAllowance([fail(0), fail(1)], rules, t0 + 2 * hour).attemptsLeft, 1)
  const blocked = attemptAllowance([fail(0), fail(1), fail(2)], rules, t0 + 3 * hour)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.opensAt, t0 + 50 * hour)
  const reopened = attemptAllowance([fail(0), fail(1), fail(2)], rules, t0 + 50 * hour)
  assert.deepEqual([reopened.allowed, reopened.attemptsLeft], [true, 3])
  assert.equal(attemptAllowance([fail(0), fail(1), fail(2), fail(51)], rules, t0 + 52 * hour).attemptsLeft, 2)
  assert.equal(attemptAllowance([fail(0), fail(1), fail(2), fail(3)], { maxAttempts: null, cooldownHours: null }).allowed, true)
  const chapter = attemptAllowance([fail(0), fail(0), fail(0)], { maxAttempts: 3, cooldownHours: 10 / 60 }, t0 + 5 * 60_000)
  assert.equal(chapter.opensAt, t0 + 10 * 60_000)
})

test('timer: expiry honours extra time; exam size depends on programme length', () => {
  assert.equal(attemptExpiry(0, 60), 3_600_000)
  assert.equal(attemptExpiry(0, 60, 1.5), 5_400_000)
  assert.equal(attemptExpiry(0, null), null)
  assert.deepEqual(examSize(10 * 3600), { drawCount: 30, timeLimitMinutes: 45 })
  assert.deepEqual(examSize(40 * 3600), { drawCount: 40, timeLimitMinutes: 60 })
})

test('item analysis: p-value, discrimination and flags', async () => {
  const { analyseItems, itemFlags } = await import('./item-analysis.js')
  const observations = Array.from({ length: 40 }, (_, i) => ({ questionId: 1, correct: i >= 20, attemptScore: i >= 20 ? 90 : 40 }))
    .concat(Array.from({ length: 40 }, (_, i) => ({ questionId: 2, correct: i < 39, attemptScore: 60 + (i % 5) })))
  const [good, easy] = analyseItems(observations)
  assert.equal(good?.pValue, 0.5)
  assert.ok((good?.discrimination ?? 0) > 0.9, 'right answers come from strong learners')
  assert.deepEqual(itemFlags({ served: good?.served, pValue: good?.pValue, discrimination: good?.discrimination }), [])
  assert.ok(itemFlags({ served: easy?.served, pValue: easy?.pValue, discrimination: easy?.discrimination }).includes('too_easy'))
  assert.deepEqual(itemFlags({ served: 10, pValue: 0.99, discrimination: 0 }), [])
  assert.deepEqual(itemFlags({ served: 50, pValue: 0.2, discrimination: 0.05 }), ['too_hard', 'confusing'])
})
