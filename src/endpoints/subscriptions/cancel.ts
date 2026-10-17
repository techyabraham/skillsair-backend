import type { Endpoint, PayloadRequest } from 'payload'
import { sendSuccess, asyncHandler } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { disableSubscription } from '../../lib/paystack.js'
import { AppError } from '../../types/index.js'
import { logger } from '../../lib/logger.js'
import { onLifecycleEvent } from '../../lib/lifecycle/events.js'
import { z } from 'zod'
import { parseBody, readJsonBody } from '../../middleware/validate.js'
import { isValidPayloadId } from '../../utils/sanitize.js'

const cancelSchema = z.object({ subscriptionId: z.string().min(1) })

interface SubscriptionDoc {
  id: number
  status: 'active' | 'cancelled' | 'expired'
  paystackSubscriptionCode: string | null | undefined
  paystackEmailToken: string | null | undefined
  currentPeriodEnd: string | null | undefined
}


const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const body = parseBody(cancelSchema, await readJsonBody(req))
  if (!isValidPayloadId(body.subscriptionId)) throw new AppError('VALIDATION_ERROR', 'Invalid subscription id')
  const payload = req.payload

  const subscriptions = await payload.find({
    collection: 'subscriptions',
    where: { and: [{ id: { equals: body.subscriptionId } }, { user: { equals: user.id } }, { status: { in: ['active', 'past_due'] } }] },
    limit: 1,
  })
  const subscription = subscriptions.docs[0] as unknown as SubscriptionDoc | undefined
  if (!subscription) {
    throw new AppError('NOT_FOUND', 'No active subscription found')
  }

  if (subscription.paystackSubscriptionCode && subscription.paystackEmailToken) {
    await disableSubscription(subscription.paystackSubscriptionCode, subscription.paystackEmailToken)
  } else {
    throw new AppError('VALIDATION_ERROR', 'Subscription is awaiting Paystack confirmation')
  }

  const updated = await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    data: { status: 'cancelled', cancelledAt: new Date().toISOString() },
    overrideAccess: true,
  })
  await onLifecycleEvent(payload, { type: 'subscription_cancelled', subscriptionId: Number(subscription.id), source: 'learner' })

  return sendSuccess(updated)
}

export const cancelSubscriptionEndpoint: Endpoint = {
  path: '/subscriptions/cancel',
  method: 'post',
  handler: asyncHandler(handler),
}
