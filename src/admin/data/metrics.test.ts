import assert from 'node:assert/strict'
import {
  bucketByLagosDay,
  dayKeys,
  fillSeries,
  inWorkingHours,
  lagosDayKey,
  lastDays,
  monthlyValue,
  parsePeriod,
  periodRange,
  rate,
  stepHealth,
  waitTone,
  workingMsBetween,
} from './metrics-core.js'
import { formatDuration, formatNaira, formatPercent, formatWhen, initials, maskPhone } from '../format.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (isoUtc: string) => new Date(isoUtc).getTime()
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed++
  void name
}

test('Lagos day boundaries: 23:00 UTC is already the next Lagos day', () => {
  assert.equal(lagosDayKey(at('2026-10-18T22:59:59Z')), '2026-10-18')
  assert.equal(lagosDayKey(at('2026-10-18T23:00:00Z')), '2026-10-19')
  assert.equal(lagosDayKey(at('2026-10-19T00:30:00Z')), '2026-10-19')
})

test('bucketing counts each event in its Lagos day', () => {
  const keys = dayKeys(at('2026-10-17T12:00:00Z'), at('2026-10-19T12:00:00Z'))
  assert.deepEqual(keys, ['2026-10-17', '2026-10-18', '2026-10-19'])
  const counts = bucketByLagosDay([at('2026-10-17T22:30:00Z'), at('2026-10-17T23:30:00Z'), at('2026-10-18T23:00:00Z'), at('2026-10-19T10:00:00Z')], keys)
  assert.deepEqual(counts, [1, 1, 2])
})

test('fillSeries fills gaps with zero and keeps order', () => {
  assert.deepEqual(fillSeries([{ day: '2026-10-19', value: '4' }, { day: '2026-10-17', value: 2 }], ['2026-10-17', '2026-10-18', '2026-10-19']), [2, 0, 4])
})

test('lastDays returns n days ending today (Lagos)', () => {
  const days = lastDays(at('2026-10-19T23:30:00Z'), 14)
  assert.equal(days.length, 14)
  assert.equal(days[13], '2026-10-20')
  assert.equal(days[0], '2026-10-07')
})

test('7-day period starts at Lagos midnight six days ago; previous period has equal length', () => {
  const now = at('2026-10-19T14:00:00Z')
  const range = periodRange('7d', now)
  assert.equal(new Date(range.from).toISOString(), '2026-10-12T23:00:00.000Z')
  assert.equal(range.to - range.from, range.previousTo - range.previousFrom)
  assert.equal(range.previousTo, range.from)
  assert.equal(range.comparisonLabel, 'last 7 days')
})

test('today compares with the same hours yesterday', () => {
  const now = at('2026-10-19T09:00:00Z') // 10:00 WAT
  const range = periodRange('today', now)
  assert.equal(new Date(range.from).toISOString(), '2026-10-18T23:00:00.000Z')
  assert.equal(range.previousFrom, range.from - DAY)
  assert.equal(range.previousTo, now - DAY)
})

test('window period starts when the window opened; falls back to 30 days', () => {
  const now = at('2026-10-19T14:00:00Z')
  assert.equal(periodRange('window', now, '2026-10-01T08:00:00Z').from, at('2026-10-01T08:00:00Z'))
  assert.equal(periodRange('window', now, null).from, periodRange('30d', now).from)
  assert.equal(parsePeriod('nonsense'), '7d')
})

test('conversion maths: paid ÷ applicants, null without applicants', () => {
  assert.equal(rate(3, 12), 0.25)
  assert.equal(rate(0, 0), null)
  assert.equal(formatPercent(0.25), '25%')
  assert.equal(formatPercent(0.034), '3.4%')
  assert.equal(formatPercent(null), '–')
})

test('working hours: Saturday 6pm to Monday 10am is one working hour (Sunday off)', () => {
  // Sat 17 Oct 2026 18:00 WAT = 17:00Z; Mon 19 Oct 10:00 WAT = 09:00Z
  assert.equal(workingMsBetween(at('2026-10-17T17:00:00Z'), at('2026-10-19T09:00:00Z')), HOUR)
  // Within one working day
  assert.equal(workingMsBetween(at('2026-10-19T09:00:00Z'), at('2026-10-19T11:30:00Z')), 2.5 * HOUR)
  // Overnight Monday 5pm to Tuesday 9:30am: 1h Monday + 0.5h Tuesday
  assert.equal(workingMsBetween(at('2026-10-19T16:00:00Z'), at('2026-10-20T08:30:00Z')), 1.5 * HOUR)
  assert.equal(inWorkingHours(at('2026-10-18T10:00:00Z')), false) // Sunday
  assert.equal(inWorkingHours(at('2026-10-19T08:00:00Z')), true) // Mon 9:00 WAT
})

test('wait tone: amber after one working hour, red after four', () => {
  assert.equal(waitTone(30 * 60_000), 'neutral')
  assert.equal(waitTone(2 * HOUR), 'caution')
  assert.equal(waitTone(5 * HOUR), 'critical')
})

test('lifecycle step health thresholds', () => {
  assert.equal(stepHealth({ sent: 1000, unsubscribed: 11, complained: 0 }), 'critical')
  assert.equal(stepHealth({ sent: 1000, unsubscribed: 0, complained: 2 }), 'critical')
  assert.equal(stepHealth({ sent: 1000, unsubscribed: 6, complained: 1 }), 'caution')
  assert.equal(stepHealth({ sent: 1000, unsubscribed: 2, complained: 0 }), 'positive')
  assert.equal(stepHealth({ sent: 0, unsubscribed: 0, complained: 0 }), 'neutral')
})

test('MRR counts annual plans monthly', () => {
  assert.equal(monthlyValue(2000, 'monthly'), 2000)
  assert.equal(monthlyValue(120000, 'annually'), 10000)
})

test('naira and time formatting', () => {
  assert.equal(formatNaira(2000), '₦2,000')
  assert.equal(formatNaira(1_200_000, { compact: true }), '₦1.2M')
  assert.equal(formatNaira(45_000, { compact: true }), '₦45K')
  assert.equal(formatNaira(999, { compact: true }), '₦999')
  assert.equal(formatDuration(2 * HOUR + 10 * 60_000), '2h 10m')
  assert.equal(formatDuration(3 * DAY + 4 * HOUR), '3d 4h')
  assert.equal(formatWhen(at('2026-10-19T13:05:00Z'), at('2026-10-19T15:00:00Z')), 'Today 14:05')
  assert.equal(formatWhen(at('2026-10-18T08:00:00Z'), at('2026-10-19T15:00:00Z')), 'Yesterday 09:00')
  assert.equal(formatWhen(at('2026-10-12T08:00:00Z'), at('2026-10-19T15:00:00Z')), '12 Oct')
})

test('phone masking and initials', () => {
  assert.equal(maskPhone('+2348181236524'), '+234 818 ••• 6524')
  assert.equal(maskPhone(''), '–')
  assert.equal(initials('Ada Obi'), 'AO')
  assert.equal(initials('imisi@skillsair.com'), 'IM')
})

console.log(`admin metrics tests: ${passed} passed`)
