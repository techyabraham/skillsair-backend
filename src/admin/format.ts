/**
 * How Studio writes money, dates and durations (brief 3.5): ₦2,000 · ₦1.2M · "Today 14:05" ·
 * "Yesterday" · "12 Oct" · "waiting 2h 10m". Always Lagos time (WAT). Pure functions, safe on
 * server and client.
 */
import { DAY, lagosMidnight } from '../lib/lifecycle/timing.js'

const TZ = 'Africa/Lagos'

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })

/** ₦2,000 (or ₦1.2M / ₦45K with `compact`). Amounts are whole naira. */
export function formatNaira(amount: number | null | undefined, options: { compact?: boolean } = {}): string {
  const value = Number(amount ?? 0)
  if (options.compact && Math.abs(value) >= 1000) {
    const units: Array<[number, string]> = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
    for (const [size, suffix] of units) {
      if (Math.abs(value) >= size) {
        const scaled = value / size
        const digits = Math.abs(scaled) >= 100 ? 0 : 1
        return `₦${scaled.toFixed(digits).replace(/\.0$/, '')}${suffix}`
      }
    }
  }
  return naira.format(value).replace(/^NGN\s?/, '₦')
}

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-GB').format(Number(value ?? 0))
}

/** 0.1234 -> "12.3%" (one decimal under 10%, none above). */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '–'
  const pct = ratio * 100
  return `${pct < 10 && pct !== 0 ? pct.toFixed(1) : Math.round(pct)}%`
}

function toTime(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TZ })
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })
const full = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
const absolute = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ })

/** "Today 14:05", "Yesterday 09:12", "12 Oct", "12 Oct 2025" (other years). */
export function formatWhen(value: Date | string | number | null | undefined, now = Date.now()): string {
  const time = toTime(value)
  if (time === null) return '–'
  const today = lagosMidnight(now)
  if (time >= today && time < today + DAY) return `Today ${clock.format(time)}`
  if (time >= today - DAY && time < today) return `Yesterday ${clock.format(time)}`
  if (time >= today + DAY && time < today + 2 * DAY) return `Tomorrow ${clock.format(time)}`
  const sameYear = new Date(time).getUTCFullYear() === new Date(now).getUTCFullYear()
  return (sameYear ? dayMonth : dayMonthYear).format(time)
}

/** "12 Oct" (no time). */
export function formatDay(value: Date | string | number | null | undefined): string {
  const time = toTime(value)
  return time === null ? '–' : dayMonth.format(time)
}

/** "Monday 19 October". */
export function formatLongDate(value: Date | string | number = Date.now()): string {
  const time = toTime(value) ?? Date.now()
  return full.format(time)
}

/** Full WAT timestamp for title attributes: "19 Oct 2026, 14:05 WAT". */
export function formatAbsolute(value: Date | string | number | null | undefined): string {
  const time = toTime(value)
  return time === null ? '' : `${absolute.format(time)} WAT`
}

export function formatClock(value: Date | string | number | null | undefined): string {
  const time = toTime(value)
  return time === null ? '' : clock.format(time)
}

/** 7_800_000 -> "2h 10m"; under a minute -> "just now"; days shown as "3d 4h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now'
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d${hours ? ` ${hours}h` : ''}`
  if (hours > 0) return `${hours}h${mins ? ` ${mins}m` : ''}`
  return `${mins}m`
}

/** "5 minutes ago", "3 hours ago", "Yesterday", "12 Oct". */
export function formatRelative(value: Date | string | number | null | undefined, now = Date.now()): string {
  const time = toTime(value)
  if (time === null) return '–'
  const diff = now - time
  if (diff < 0) return formatWhen(time, now)
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000)
    return `${m} min${m === 1 ? '' : 's'} ago`
  }
  if (diff < 12 * 3_600_000) {
    const h = Math.floor(diff / 3_600_000)
    return `${h} hour${h === 1 ? '' : 's'} ago`
  }
  return formatWhen(time, now)
}

/** Time of day greeting in Lagos. */
export function greeting(now = Date.now()): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: TZ }).format(now))
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** Initials for avatars: "Ada Obi" -> "AO"; email -> first letter. */
export function initials(name: string | null | undefined): string {
  const text = String(name ?? '').trim()
  const words = (text.includes('@') ? text.split('@')[0]! : text).split(/[\s._-]+/).filter(Boolean)
  if (!words.length) return '?'
  return (words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words[words.length - 1]![0]}`).toUpperCase()
}

/** Stable 0..n-1 index from a string (avatar colours). */
export function hashIndex(value: string, n: number): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash) % n
}

/** "+234 818 ••• 6524": keeps the country code, the first three and the last four digits. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/[^\d+]/g, '')
  if (digits.length < 8) return digits ? '•••' : '–'
  const match = digits.match(/^\+(234|1|44|233|254|27)(\d+)$/)
  const cc = match ? `+${match[1]}` : ''
  const rest = match ? match[2]! : digits.replace(/^\+/, '')
  return `${cc}${cc ? ' ' : ''}${rest.slice(0, 3)} ••• ${rest.slice(-4)}`
}

export function personName(person: { firstName?: unknown; lastName?: unknown; email?: unknown } | null | undefined): string {
  if (!person) return 'Unknown'
  const name = [person.firstName, person.lastName].filter((part) => typeof part === 'string' && part.trim()).join(' ').trim()
  return name || (typeof person.email === 'string' ? person.email : 'Unknown')
}
