import { AppError } from '../types/index.js'
import type { Payload } from 'payload'

export interface ScholarshipWindowState {
  isOpen?: boolean | null
  opensAt?: string | null
  closesAt?: string | null
  cohortLabel?: string | null
  cohortStartsAt?: string | null
  cohortEndsAt?: string | null
  laptopsPerCohort?: number | null
}

/** A window is open only when it is switched on, has started, and its closing time is still ahead. */
export function windowIsOpen(w: ScholarshipWindowState | null | undefined, now = Date.now()): boolean {
  if (!w?.isOpen || !w.closesAt) return false
  if (w.opensAt && new Date(w.opensAt).getTime() > now) return false
  return new Date(w.closesAt).getTime() > now
}

/**
 * `price` is the Access Scholarship price; `standardPrice` is charged whenever no
 * scholarship window is open. Courses without a standard price keep their single price.
 */
export function effectiveCoursePrice(
  c: { price: number; standardPrice?: number | null },
  open: boolean,
): number {
  return open || !c.standardPrice ? c.price : c.standardPrice
}

/** One-off programme payment: the standard fee when set (the scholarship is monthly only). */
export function oneOffCoursePrice(c: { price: number; standardPrice?: number | null }): number {
  return c.standardPrice || c.price
}

/**
 * The ₦2,000/month Access Scholarship plan can only be started while a window is open.
 * Existing subscribers keep their rate; renewals are handled by Paystack, not here.
 */
export function assertPlanPurchasable(plan: { kind?: string | null }, open: boolean): void {
  if (plan.kind === 'scholarship' && !open) {
    throw new AppError('VALIDATION_ERROR', 'The Access Scholarship window has closed. The standard fee applies until the next window opens.')
  }
}

/** Single source for the certificate fee (NGN). Defaults to ₦10,000 when the env var is unset. */
export function certificatePrice(): number {
  const raw = process.env.CERTIFICATE_PRICE_NGN
  if (raw === undefined || raw.trim() === '') return 10000
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : 10000
}

export async function getScholarshipWindow(payload: Payload): Promise<ScholarshipWindowState> {
  const doc = await payload
    .findGlobal({ slug: 'scholarship-window', depth: 0, overrideAccess: true })
    .catch(() => null)
  return (doc ?? {}) as ScholarshipWindowState
}
