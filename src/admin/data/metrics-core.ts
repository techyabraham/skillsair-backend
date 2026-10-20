/**
 * Pure helpers behind Studio's metrics (unit-tested in metrics.test.ts): period ranges,
 * Lagos-day buckets, series filling, rates and working-hours waits. No database or Payload here.
 *
 * All day boundaries are Lagos midnights (WAT = UTC+1, no daylight saving), matching
 * src/lib/lifecycle/timing.ts.
 */
import { DAY, HOUR, lagosMidnight } from '../../lib/lifecycle/timing.js'
import { WORKING_HOURS } from '../studio-config.js'

export type PeriodKey = 'today' | '7d' | '30d' | 'window'

export const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'window', label: 'This window' },
]

export interface PeriodRange {
  key: PeriodKey
  from: number
  to: number
  previousFrom: number
  previousTo: number
  /** "vs yesterday", "vs last 7 days", "vs previous 30 days", "vs previous window length". */
  comparisonLabel: string
  label: string
}

export function parsePeriod(value: unknown): PeriodKey {
  return value === 'today' || value === '7d' || value === '30d' || value === 'window' ? value : '7d'
}

/**
 * The current period and the previous period of equal length.
 * today = since Lagos midnight; 7d/30d = the last 7/30 Lagos days including today;
 * window = since the scholarship window opened (falls back to 30 days if unknown).
 */
export function periodRange(key: PeriodKey, now: number, windowOpensAt?: string | null): PeriodRange {
  const today = lagosMidnight(now)
  let from: number
  let comparisonLabel: string
  let label: string
  switch (key) {
    case 'today':
      from = today
      comparisonLabel = 'yesterday'
      label = 'Today'
      break
    case '30d':
      from = today - 29 * DAY
      comparisonLabel = 'previous 30 days'
      label = 'Last 30 days'
      break
    case 'window': {
      const opened = windowOpensAt ? new Date(windowOpensAt).getTime() : NaN
      from = Number.isFinite(opened) && opened < now ? opened : today - 29 * DAY
      comparisonLabel = 'same length before'
      label = 'This window'
      break
    }
    default:
      from = today - 6 * DAY
      comparisonLabel = 'last 7 days'
      label = 'Last 7 days'
  }
  // "Today" compares with the same hours yesterday, so a morning isn't judged against a whole day.
  const length = key === 'today' ? now - today : now - from
  return { key, from, to: now, previousFrom: from - (key === 'today' ? DAY : length), previousTo: key === 'today' ? now - DAY : from, comparisonLabel, label }
}

/** "2026-10-19" for the Lagos day containing `at`. */
export function lagosDayKey(at: number): string {
  return new Date(lagosMidnight(at) + HOUR).toISOString().slice(0, 10)
}

/** Lagos day keys from the day containing `from` to the day containing `to`, inclusive. */
export function dayKeys(from: number, to: number): string[] {
  const keys: string[] = []
  for (let day = lagosMidnight(from); day <= lagosMidnight(to); day += DAY) keys.push(lagosDayKey(day))
  return keys
}

/** The last `n` Lagos days ending today. */
export function lastDays(now: number, n: number): string[] {
  return dayKeys(lagosMidnight(now) - (n - 1) * DAY, now)
}

/** Maps sparse {day: value} rows onto `keys`, filling gaps with 0. */
export function fillSeries(rows: Array<{ day: string; value: number | string | null }>, keys: string[]): number[] {
  const byDay = new Map(rows.map((row) => [row.day, Number(row.value ?? 0)]))
  return keys.map((key) => byDay.get(key) ?? 0)
}

/** Buckets timestamps into Lagos days (used to cross-check SQL bucketing in tests). */
export function bucketByLagosDay(timestamps: number[], keys: string[]): number[] {
  const counts = new Map<string, number>()
  for (const at of timestamps) counts.set(lagosDayKey(at), (counts.get(lagosDayKey(at)) ?? 0) + 1)
  return keys.map((key) => counts.get(key) ?? 0)
}

/** part ÷ whole, or null when there is nothing to divide. */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null
}

/** "12 Oct" style label for a day key. */
export function dayLabel(key: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`))
}

/**
 * Milliseconds of Imisi's working hours (Mon–Sat 9–6 WAT by default) between two instants.
 * Used to colour waiting times: a lead who wrote at 8pm hasn't been waiting all night.
 */
export function workingMsBetween(from: number, to: number, hours = WORKING_HOURS): number {
  if (!(to > from)) return 0
  let total = 0
  for (let day = lagosMidnight(from); day <= to; day += DAY) {
    const weekday = new Date(day + HOUR).getUTCDay()
    if (!hours.days.includes(weekday)) continue
    const open = day + hours.startHour * HOUR
    const close = day + hours.endHour * HOUR
    total += Math.max(0, Math.min(close, to) - Math.max(open, from))
  }
  return total
}

export function inWorkingHours(at: number, hours = WORKING_HOURS): boolean {
  const day = lagosMidnight(at)
  const weekday = new Date(day + HOUR).getUTCDay()
  return hours.days.includes(weekday) && at >= day + hours.startHour * HOUR && at < day + hours.endHour * HOUR
}

/** Queue wait colour: amber over 1 working hour, red over 4. */
export function waitTone(workingMs: number): 'neutral' | 'caution' | 'critical' {
  if (workingMs > 4 * HOUR) return 'critical'
  if (workingMs > HOUR) return 'caution'
  return 'neutral'
}

/** Lifecycle step health (brief 12 of the email build): red over 1% unsubscribes or 0.1% complaints. */
export function stepHealth(stats: { sent: number; unsubscribed: number; complained: number; clicked?: number }): 'positive' | 'caution' | 'critical' | 'neutral' {
  if (!stats.sent) return 'neutral'
  if (stats.unsubscribed / stats.sent > 0.01 || stats.complained / stats.sent > 0.001) return 'critical'
  if (stats.unsubscribed / stats.sent > 0.005) return 'caution'
  return 'positive'
}

/** Monthly value of a plan price (annual plans spread over 12 months). */
export function monthlyValue(price: number, interval: string | null | undefined): number {
  return interval === 'annually' ? price / 12 : price
}
