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
