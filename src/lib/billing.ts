import type { Payload } from 'payload'
import { disableSubscription } from './paystack.js'
import { logger } from './logger.js'

/**
 * Billing rules the lifecycle emails depend on.
 *
 * Paystack doesn't retry a failed renewal: the subscription goes to "attention" and the next
 * attempt is on the following payment date. So after a failure the learner keeps access for
 * ACCESS_GRACE_DAYS (default 3) while they pay again; after that, access pauses and the old
 * Paystack subscription is switched off so it can't surprise-charge them a month later.
 */
export function accessGraceDays(): number {
  const value = Number(process.env.ACCESS_GRACE_DAYS ?? 3)
  return Number.isFinite(value) && value >= 0 ? value : 3
}

export function graceEndsAt(lastFailedAt: string | null | undefined, days = accessGraceDays()): string | null {
  if (!lastFailedAt) return null
  const start = Date.parse(lastFailedAt)
  return Number.isFinite(start) ? new Date(start + days * 86_400_000).toISOString() : null
}

export function inGrace(subscription: { status?: string | null; lastFailedAt?: string | null }, now = Date.now()): boolean {
  if (subscription.status !== 'past_due') return false
  const end = graceEndsAt(subscription.lastFailedAt)
  return end !== null && Date.parse(end) > now
}

/**
 * How a learner can pay at checkout, in the order the site offers them. Bank transfer is the
 * default; OPay is Paystack's "Pay with OPay", which Paystack lists under its Bank option; and
 * Paystack is the full Paystack checkout with every option it offers.
 */
export const PAYMENT_METHODS = ['bank_transfer', 'opay', 'paystack'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/**
 * Paystack `channels` for a payment. Monthly plans paid through "Paystack" renew from a saved
 * card, which Paystack only allows for card payments, so those are card-only. Transfer and OPay
 * can't be charged again automatically: they pay for one month at a time (see `billing` on
 * subscriptions). Undefined = every channel the Paystack account has switched on.
 */
export function paystackChannels(method: PaymentMethod, recurringPlan: boolean): string[] | undefined {
  if (method === 'bank_transfer') return ['bank_transfer']
  if (method === 'opay') return ['bank']
  return recurringPlan ? ['card'] : undefined
}

/** Transfer and OPay pay month by month; only card payments through Paystack can renew. */
export function billingFor(method: PaymentMethod): 'card' | 'manual' {
  return method === 'paystack' ? 'card' : 'manual'
}

/**
 * Paystack's Nigerian local fee: 1.5% + ₦100, the ₦100 waived under ₦2,500, capped at ₦2,000.
 * Enrolment payments pass it on to the learner, so SkillsAir receives the full price. Keep in
 * sync with the frontend copy in src/lib/paystack-fee.ts (display only).
 */
export const PAYSTACK_FEE = { percent: 0.015, flat: 100, flatFrom: 2500, cap: 2000 } as const

/** The fee (whole naira, rounded up) to add to `price` so the merchant still receives `price`. */
export function paystackFee(price: number): number {
  if (!(price > 0)) return 0
  const gross = (flat: number) => Math.ceil((price + flat) / (1 - PAYSTACK_FEE.percent))
  let total = gross(0)
  // The ₦100 applies once the amount charged (not the price) reaches ₦2,500.
  if (total >= PAYSTACK_FEE.flatFrom) total = gross(PAYSTACK_FEE.flat)
  return Math.min(total - price, PAYSTACK_FEE.cap)
}

/** What the learner pays for an enrolment priced at `price`. */
export function withPaystackFee(price: number): number {
  return price + paystackFee(price)
}

export interface AccessSubscription {
  status?: string | null
  billing?: string | null
  currentPeriodEnd?: string | number | null
  lastFailedAt?: string | number | null
}

const toMs = (value: string | number | null | undefined) => (value === null || value === undefined || value === '' ? 0 : typeof value === 'number' ? value : Date.parse(value) || 0)

/**
 * When a month-by-month (transfer/OPay) plan's access ends: the paid month plus the same grace
 * days a failed card renewal gets, so a learner who pays a day late isn't locked out.
 */
export function manualAccessEndsAt(currentPeriodEnd: string | number | null | undefined, days = accessGraceDays()): number {
  const end = toMs(currentPeriodEnd)
  return end ? end + days * 86_400_000 : 0
}

/**
 * Whether a subscription gives access right now: paid up (active, or cancelled but running to
 * the end of its month), a failed card renewal inside its grace days, or a month-by-month plan
 * inside its month plus grace days.
 */
export function subscriptionGivesAccess(subscription: AccessSubscription | null | undefined, now = Date.now()): boolean {
  if (!subscription) return false
  const status = String(subscription.status)
  const end = toMs(subscription.currentPeriodEnd)
  if (['active', 'cancelled', 'past_due'].includes(status) && end > now) return true
  if (subscription.billing === 'manual' && status === 'active' && manualAccessEndsAt(subscription.currentPeriodEnd) > now) return true
  return inGrace({ status: subscription.status, lastFailedAt: subscription.lastFailedAt ? new Date(toMs(subscription.lastFailedAt)).toISOString() : null }, now)
}

/** Billing stops when a learner finishes, unless the owner switches it off (STOP_BILLING_ON_COMPLETE=false). */
export function stopBillingOnComplete(): boolean {
  return process.env.STOP_BILLING_ON_COMPLETE !== 'false'
}

interface PaystackSubscriptionRef {
  id: number
  paystackSubscriptionCode?: string | null
  paystackEmailToken?: string | null
}

/** Switches the subscription off at Paystack (no further charges). Returns false if it couldn't. */
export async function disableAtPaystack(subscription: PaystackSubscriptionRef, why: string): Promise<boolean> {
  if (!subscription.paystackSubscriptionCode || !subscription.paystackEmailToken) {
    logger.warn({ subscriptionId: subscription.id, why }, 'paystack_disable_skipped_not_linked')
    return false
  }
  try {
    await disableSubscription(subscription.paystackSubscriptionCode, subscription.paystackEmailToken)
    logger.info({ subscriptionId: subscription.id, why }, 'paystack_subscription_disabled')
    return true
  } catch (err) {
    logger.error({ err, subscriptionId: subscription.id, why }, 'paystack_subscription_disable_failed')
    return false
  }
}

export async function findSubscriptionByCode(payload: Payload, code: string | undefined | null) {
  if (!code) return null
  const result = await payload.find({ collection: 'subscriptions', where: { paystackSubscriptionCode: { equals: code } }, limit: 1, depth: 0, overrideAccess: true })
  return result.docs[0] ?? null
}
