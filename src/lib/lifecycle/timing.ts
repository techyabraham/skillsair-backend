/**
 * Time rules in Lagos time (WAT, UTC+1, no daylight saving): quiet hours, Sundays, and
 * "9am on a given day" anchors.
 */
export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR
const WAT_OFFSET = HOUR

/** Marketing and service messages only go out between these Lagos hours. */
export const SEND_FROM_HOUR = 8
export const SEND_UNTIL_HOUR = 20

export function lagosHour(at: number): number {
  return new Date(at + WAT_OFFSET).getUTCHours()
}

/** 0 = Sunday. */
export function lagosWeekday(at: number): number {
  return new Date(at + WAT_OFFSET).getUTCDay()
}

/** Midnight (Lagos) at the start of the day containing `at`. */
export function lagosMidnight(at: number): number {
  const shifted = at + WAT_OFFSET
  return shifted - (shifted % DAY) - WAT_OFFSET
}

/** A given Lagos hour on the day containing `at`. */
export function lagosTimeOnDay(at: number, hour: number): number {
  return lagosMidnight(at) + hour * HOUR
}

/** Day number (Lagos) used as a stable cycle id for a window or a day. */
export function lagosDayNumber(at: number): number {
  return Math.floor((at + WAT_OFFSET) / DAY)
}

export function inQuietHours(at: number): boolean {
  const hour = lagosHour(at)
  return hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR
}

export function isSundayInLagos(at: number): boolean {
  return lagosWeekday(at) === 0
}
