import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { asyncHandler, sendSuccess } from '../../middleware/validate.js'
import { verifyWebhookSignature } from '../../lib/paystack.js'
import { claimIdempotencyKey } from '../../lib/redis.js'
import type { PaystackWebhookEvent, PaystackChargeSuccessEvent, PaystackSubscriptionDisableEvent } from '../../types/paystack.js'
import { AppError } from '../../types/index.js'
import { logger } from '../../lib/logger.js'
import { subscriptionCancelledEmail, sendEmail } from '../../lib/resend.js'

interface OrderDoc {
  id: number
  status: 'pending' | 'success' | 'failed' | 'refunded'
}

interface SubscriptionDoc {
  id: number
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
  if (!order || order.status === 'success') return

  await payload.update({
    collection: 'orders',
    id: order.id,
    data: {
      status: 'success',
      paystackTransactionId: String(event.data.id),
      paidAt: event.data.paid_at ?? new Date().toISOString(),
    },
    overrideAccess: true,
  })
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
  if (!subscription) return

  await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    data: { status: 'cancelled', cancelledAt: new Date().toISOString() },
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
  const idempotencyKey = `paystack:${event.event}:${JSON.stringify((event.data as { id?: unknown }).id ?? event.data)}`
  const isFirstDelivery = await claimIdempotencyKey(idempotencyKey)
  if (!isFirstDelivery) {
    return sendSuccess({ received: true, duplicate: true })
  }

  const payload = req.payload

  try {
    if (event.event === 'charge.success') {
      await handleChargeSuccess(event as PaystackChargeSuccessEvent, payload)
    } else if (event.event === 'subscription.disable') {
      await handleSubscriptionDisable(event as PaystackSubscriptionDisableEvent, payload)
    } else {
      logger.info({ event: event.event }, 'paystack_webhook_unhandled_event')
    }
  } catch (err) {
    logger.error({ err, event: event.event }, 'paystack_webhook_processing_failed')
  }

  return sendSuccess({ received: true })
}

export const paystackWebhookEndpoint: Endpoint = {
  path: '/payments/webhook',
  method: 'post',
  handler: asyncHandler(handlePaystackWebhook),
}
