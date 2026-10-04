import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { asyncHandler, sendSuccess } from '../../middleware/validate.js'
import { verifyWebhookSignature } from '../../lib/paystack.js'
import { fulfillOrder } from '../../lib/order-fulfillment.js'
import type { PaystackWebhookEvent, PaystackChargeSuccessEvent, PaystackSubscriptionDisableEvent } from '../../types/paystack.js'
import { AppError } from '../../types/index.js'
import { logger } from '../../lib/logger.js'
import { subscriptionCancelledEmail, sendEmail } from '../../lib/resend.js'
import { linkSubscription, applyPaidInvoice } from '../../lib/subscription-events.js'

interface OrderDoc {
  id: number
  status: 'pending' | 'success' | 'failed' | 'refunded'
  amount: number
  currency: string
}

interface SubscriptionDoc {
  id: number
  status: 'active' | 'cancelled' | 'expired'
  user: number | string | { id: number | string; email?: string; firstName?: string }
  currentPeriodEnd: string | null
}

interface UserDoc {
  email: string
  firstName: string
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

async function handleSubscriptionDisable(
  event: PaystackSubscriptionDisableEvent,
  payload: Payload,
): Promise<void> {
  const subscriptions = await payload.find({
    collection: 'subscriptions',
    where: { paystackSubscriptionCode: { equals: event.data.subscription_code } },
    limit: 1,
  })
  const subscription = subscriptions.docs[0] as unknown as SubscriptionDoc | undefined
  if (!subscription) throw new AppError('NOT_FOUND', 'Subscription has not been linked yet')
  const status = subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() <= Date.now() ? 'expired' : 'cancelled'
  if (subscription.status === status) return

  await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    data: { status, cancelledAt: new Date().toISOString() },
    overrideAccess: true,
  })

  const userId = relationId(subscription.user)
  if (userId === undefined) return
  try {
    const user = (await payload.findByID({
      collection: 'users',
      id: userId,
      depth: 0,
    })) as unknown as UserDoc
    const accessEndDate = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-GB')
      : 'the end of the current billing period'
    await sendEmail(
      user.email,
      subscriptionCancelledEmail(user.firstName, accessEndDate, `${FRONTEND_URL}/subscriptions`),
    )
  } catch (err) {
    logger.error({ err, subscriptionId: subscription.id }, 'subscription_cancelled_email_failed')
  }
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
  } else if (event.event === 'subscription.disable' || event.event === 'subscription.not_renew') {
      await handleSubscriptionDisable(event as PaystackSubscriptionDisableEvent, payload)
  } else if (event.event === 'subscription.create') {
      await linkSubscription(payload, event.data as Parameters<typeof linkSubscription>[1])
  } else if (event.event === 'invoice.update') {
      await applyPaidInvoice(payload, event.data as Parameters<typeof applyPaidInvoice>[1])
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
