import type { Endpoint, PayloadRequest } from 'payload'
import { sendSuccess, asyncHandler } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { disableSubscription } from '../../lib/paystack.js'
import { subscriptionCancelledEmail, sendEmail } from '../../lib/resend.js'
import { AppError } from '../../types/index.js'
import { logger } from '../../lib/logger.js'

interface SubscriptionDoc {
  id: number
  status: 'active' | 'cancelled' | 'expired'
  paystackSubscriptionCode: string | null | undefined
  paystackEmailToken: string | null | undefined
  currentPeriodEnd: string | null | undefined
}

interface UserDoc {
  email: string
  firstName: string
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const payload = req.payload

  const subscriptions = await payload.find({
    collection: 'subscriptions',
    where: { and: [{ user: { equals: user.id } }, { status: { equals: 'active' } }] },
    limit: 1,
  })
  const subscription = subscriptions.docs[0] as unknown as SubscriptionDoc | undefined
  if (!subscription) {
    throw new AppError('NOT_FOUND', 'No active subscription found')
  }

  if (subscription.paystackSubscriptionCode && subscription.paystackEmailToken) {
    try {
      await disableSubscription(subscription.paystackSubscriptionCode, subscription.paystackEmailToken)
    } catch (err) {
      logger.error({ err, subscriptionId: subscription.id }, 'paystack_disable_subscription_failed')
    }
  }

  const updated = await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    data: { status: 'cancelled', cancelledAt: new Date().toISOString() },
    overrideAccess: true,
  })

  const userDoc = (await payload.findByID({
    collection: 'users',
    id: user.id,
    depth: 0,
  })) as unknown as UserDoc
  const accessEndDate = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-GB')
    : 'the end of the current billing period'
  try {
    await sendEmail(
      userDoc.email,
      subscriptionCancelledEmail(userDoc.firstName, accessEndDate, `${FRONTEND_URL}/subscriptions`),
    )
  } catch (err) {
    logger.error({ err, subscriptionId: subscription.id }, 'subscription_cancelled_email_failed')
  }

  return sendSuccess(updated)
}

export const cancelSubscriptionEndpoint: Endpoint = {
  path: '/subscriptions/cancel',
  method: 'post',
  handler: asyncHandler(handler),
}
