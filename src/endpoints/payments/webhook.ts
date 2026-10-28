import { handleAmbassadorRefund } from '../ambassadors/refund-webhook.js'
import type { PaystackRefundProcessedData } from '../../types/paystack.js'
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { asyncHandler, sendSuccess } from '../../middleware/validate.js'
import { verifyWebhookSignature } from '../../lib/paystack.js'
import { fulfillOrder } from '../../lib/order-fulfillment.js'
import type { PaystackWebhookEvent, PaystackChargeSuccessEvent } from '../../types/paystack.js'
import { AppError } from '../../types/index.js'
import { logger } from '../../lib/logger.js'
import { linkSubscription, applyPaidInvoice } from '../../lib/subscription-events.js'
import { findSubscriptionByCode, graceEndsAt } from '../../lib/billing.js'
import { onLifecycleEvent } from '../../lib/lifecycle/events.js'
import { applyPayoutTransferEvent } from '../../lib/ambassadors/payouts.js'
import type { PaystackTransferEventName } from '../../types/paystack.js'

interface OrderDoc {
  id: number
  status: 'pending' | 'success' | 'failed' | 'refunded'
  amount: number
  currency: string
}


function relationId(value: unknown): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return (value as { id: number | string }).id
  }
  return value as number | string
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

async function handleChargeSuccess(event: PaystackChargeSuccessEvent, payload: Payload): Promise<void> {
  const orders = await payload.find({
    collection: 'orders',
    where: { reference: { equals: event.data.reference } },
    limit: 1,
  })
  const order = orders.docs[0] as unknown as OrderDoc | undefined
  if (!order || order.status === 'refunded') return
  if (event.data.status !== 'success' || event.data.amount !== Math.round(order.amount * 100) || event.data.currency !== order.currency) {
    throw new AppError('VALIDATION_ERROR', 'Payment details do not match the order')
  }

  if (order.status !== 'success') await payload.update({
    collection: 'orders',
    id: order.id,
    data: {
      status: 'success',
      paystackTransactionId: String(event.data.id),
      paidAt: event.data.paid_at ?? new Date().toISOString(),
    },
    overrideAccess: true,
  })
  await fulfillOrder(payload, order.id)
}

interface PaystackSubscriptionRow {
  id: number
  status: 'active' | 'past_due' | 'cancelled' | 'expired'
  user: unknown
  course: unknown
  currentPeriodEnd: string | null
  lastFailedAt?: string | null
  failedAttempts?: number | null
  paystackSubscriptionCode?: string | null
  paystackEmailToken?: string | null
}

interface SubscriptionRefData {
  subscription_code?: string
  status?: string
  subscription?: { subscription_code?: string; next_payment_date?: string | null }
  next_payment_date?: string | null
  amount?: number
  authorization?: { last4?: string }
}

async function subscriptionFor(payload: Payload, code: string | undefined): Promise<PaystackSubscriptionRow | null> {
  return (await findSubscriptionByCode(payload, code)) as unknown as PaystackSubscriptionRow | null
}

async function programmeCompleted(payload: Payload, subscription: PaystackSubscriptionRow): Promise<boolean> {
  const userId = relationId(subscription.user)
  const courseId = relationId(subscription.course)
  if (userId === undefined || courseId === undefined) return false
  const done = await payload.find({
    collection: 'enrollments',
    where: { and: [{ student: { equals: userId } }, { course: { equals: courseId } }, { status: { equals: 'completed' } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return done.totalDocs > 0
}

/**
 * subscription.not_renew: the learner cancelled on Paystack's page. Access runs to the end of
 * the paid month. When we cancelled it ourselves (the dashboard cancel button, or billing
 * stopped because they finished), the subscription is already marked and nothing more happens.
 */
async function handleNotRenew(data: SubscriptionRefData, payload: Payload): Promise<void> {
  const subscription = await subscriptionFor(payload, data.subscription_code)
  if (!subscription) {
    logger.warn({ code: data.subscription_code }, 'paystack_not_renew_unknown_subscription')
    return
  }
  if (subscription.status !== 'active') return
  await payload.update({ collection: 'subscriptions', id: subscription.id, data: { status: 'cancelled', cancelledAt: new Date().toISOString() }, overrideAccess: true })
  // The cancellation email (T5) goes from the lifecycle event.
  await onLifecycleEvent(payload, { type: 'subscription_cancelled', subscriptionId: subscription.id, source: 'paystack' })
}

/**
 * subscription.disable: Paystack has stopped the subscription (a cancelled plan reached its
 * payment date, or all its invoices are done). Access has ended. If the programme isn't
 * finished, the learner has lapsed and the win-back emails start.
 */
async function handleDisable(data: SubscriptionRefData, payload: Payload): Promise<void> {
  const subscription = await subscriptionFor(payload, data.subscription_code)
  if (!subscription) {
    logger.warn({ code: data.subscription_code }, 'paystack_disable_unknown_subscription')
    return
  }
  if (subscription.status === 'expired') return
  const periodLeft = Boolean(subscription.currentPeriodEnd) && new Date(subscription.currentPeriodEnd ?? 0).getTime() > Date.now()
  if (periodLeft && subscription.status === 'cancelled') return
  await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    data: { status: 'expired', ...(subscription.status === 'active' ? { cancelledAt: new Date().toISOString() } : {}) },
    overrideAccess: true,
  })
  const userId = relationId(subscription.user)
  if (userId !== undefined && !(await programmeCompleted(payload, subscription))) {
    await onLifecycleEvent(payload, {
      type: 'access_ended',
      userId: Number(userId),
      courseId: Number(relationId(subscription.course)),
      subscriptionId: subscription.id,
      reason: 'lapsed',
    })
  }
}

/**
 * invoice.payment_failed: the monthly renewal didn't go through. Paystack doesn't retry, so the
 * subscription becomes past_due and the learner keeps access for the grace days while they pay.
 * Repeated webhooks for the same failure don't count twice.
 */
async function handlePaymentFailed(data: SubscriptionRefData, payload: Payload): Promise<void> {
  const subscription = await subscriptionFor(payload, data.subscription?.subscription_code ?? data.subscription_code)
  if (!subscription) {
    logger.warn({ code: data.subscription?.subscription_code }, 'paystack_payment_failed_unknown_subscription')
    return
  }
  if (subscription.status === 'cancelled' || subscription.status === 'expired') return
  const recentFailure = subscription.status === 'past_due' && Boolean(subscription.lastFailedAt) && Date.now() - Date.parse(subscription.lastFailedAt ?? '') < 20 * 86_400_000
  if (recentFailure) return
  const lastFailedAt = new Date().toISOString()
  await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    data: { status: 'past_due', failedAttempts: Number(subscription.failedAttempts ?? 0) + 1, lastFailedAt },
    overrideAccess: true,
  })
  await onLifecycleEvent(payload, {
    type: 'payment_failed',
    subscriptionId: subscription.id,
    firstFailure: Number(subscription.failedAttempts ?? 0) === 0,
    graceEndsAt: graceEndsAt(lastFailedAt) ?? lastFailedAt,
  })
}

/** invoice.create: Paystack will try to charge in about 3 days. */
async function handleInvoiceCreate(data: SubscriptionRefData, payload: Payload): Promise<void> {
  const subscription = await subscriptionFor(payload, data.subscription?.subscription_code)
  if (!subscription || subscription.status !== 'active') return
  await onLifecycleEvent(payload, {
    type: 'invoice_upcoming',
    subscriptionId: subscription.id,
    chargeDate: data.subscription?.next_payment_date ?? null,
    amount: typeof data.amount === 'number' ? data.amount / 100 : null,
    cardLast4: data.authorization?.last4 ?? null,
  })
}

interface ExpiringCard {
  expiry_date?: string
  description?: string
  subscription?: { subscription_code?: string }
}

/** subscription.expiring_cards: sent at the start of each month for cards expiring that month. */
async function handleExpiringCards(data: unknown, payload: Payload): Promise<void> {
  const items = Array.isArray(data) ? (data as ExpiringCard[]) : []
  for (const item of items) {
    const subscription = await subscriptionFor(payload, item.subscription?.subscription_code)
    if (!subscription || subscription.status !== 'active') continue
    await onLifecycleEvent(payload, {
      type: 'cards_expiring',
      subscriptionId: subscription.id,
      cardExpiry: item.expiry_date ?? null,
      cardDescription: item.description ?? null,
    })
  }
}

async function handleAmbassadorTransfer(eventName: PaystackTransferEventName, data: unknown, payload: Payload): Promise<void> {
  if (!data || typeof data !== 'object') return
  const event = data as Record<string, unknown>
  if (typeof event.reference !== 'string' || !event.reference.startsWith('amb_')) return
  if (typeof event.amount !== 'number' || typeof event.currency !== 'string') {
    logger.warn({ reference: event.reference }, 'ambassador_payout_webhook_payload_invalid')
    return
  }
  await applyPayoutTransferEvent(payload, {
    event: eventName,
    reference: event.reference,
    amount: event.amount,
    currency: event.currency,
    status: typeof event.status === 'string' ? event.status : eventName.slice('transfer.'.length),
    transferCode: typeof event.transfer_code === 'string' ? event.transfer_code : null,
  })
}

export async function handlePaystackWebhook(req: PayloadRequest): Promise<Response> {
  const signature = req.headers.get('x-paystack-signature') ?? undefined
  const rawBody = typeof req.text === 'function' ? await req.text() : ''
  if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
    throw new AppError('AUTH_REQUIRED', 'Invalid webhook signature')
  }

  const event = JSON.parse(rawBody) as PaystackWebhookEvent
  const payload = req.payload

  if (event.event === 'charge.success') {
    await handleChargeSuccess(event as PaystackChargeSuccessEvent, payload)
  } else if (event.event === 'subscription.not_renew') {
    await handleNotRenew(event.data as SubscriptionRefData, payload)
  } else if (event.event === 'subscription.disable') {
    await handleDisable(event.data as SubscriptionRefData, payload)
  } else if (event.event === 'subscription.create') {
    await linkSubscription(payload, event.data as Parameters<typeof linkSubscription>[1])
  } else if (event.event === 'invoice.update') {
    const applied = await applyPaidInvoice(payload, event.data as Parameters<typeof applyPaidInvoice>[1])
    // The receipt shows what Paystack actually charged (the plan price plus the Paystack fee).
    const charged = (event.data as { amount?: unknown }).amount
    if (applied) await onLifecycleEvent(payload, { type: 'renewal_success', subscriptionId: applied.subscriptionId, recovered: applied.recovered, ...(typeof charged === 'number' ? { amount: charged / 100 } : {}) })
  } else if (event.event === 'refund.processed') {
    await handleAmbassadorRefund(payload, event.data as unknown as PaystackRefundProcessedData)
  } else if (event.event === 'transfer.success' || event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
    await handleAmbassadorTransfer(event.event, event.data, payload)
  } else if (event.event === 'invoice.payment_failed') {
    await handlePaymentFailed(event.data as SubscriptionRefData, payload)
  } else if (event.event === 'invoice.create') {
    await handleInvoiceCreate(event.data as SubscriptionRefData, payload)
  } else if (event.event === 'subscription.expiring_cards') {
    await handleExpiringCards(event.data, payload)
  } else {
    logger.info({ event: event.event }, 'paystack_webhook_unhandled_event')
  }

  return sendSuccess({ received: true })
}

export const paystackWebhookEndpoint: Endpoint = {
  path: '/payments/webhook',
  method: 'post',
  handler: asyncHandler(handlePaystackWebhook),
}
