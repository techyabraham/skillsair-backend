export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  result.setDate(result.getDate() + days)
  return result
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

export function isPast(date: Date | string | null | undefined): boolean {
  if (!date) return false
  return new Date(date).getTime() < Date.now()
}

export function isFuture(date: Date | string | null | undefined): boolean {
  if (!date) return false
  return new Date(date).getTime() > Date.now()
}

/** Resolves the base date for an access extension: future expiry stays as base, otherwise "now". */
export function resolveExtensionBaseDate(currentExpiresAt: Date | string | null | undefined): Date {
  if (currentExpiresAt && isFuture(currentExpiresAt)) {
    return new Date(currentExpiresAt)
  }
  return new Date()
}

export function hoursUntil(date: Date | string): number {
  return (new Date(date).getTime() - Date.now()) / (60 * 60 * 1000)
}
