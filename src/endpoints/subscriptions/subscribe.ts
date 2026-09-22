import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { paymentRateLimiter } from '../../lib/rate-limiter.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { initializeTransaction } from '../../lib/paystack.js'
import { generatePaystackReference } from '../../utils/generate-code.js'
import { AppError } from '../../types/index.js'

const subscribeSchema = z.object({
  planId: z.string().min(1),
})

interface PlanDoc {
  id: number
  name: string
  price: number
  isActive: boolean
  paystackPlanCode: string
}

interface UserDoc {
  id: number
  email: string
}

interface SubscriptionDoc {
  status: 'active' | 'cancelled' | 'expired'
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  await paymentRateLimiter.check(req, user.id)
  const body = parseBody(subscribeSchema, await readJsonBody(req))
  if (!isValidPayloadId(body.planId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid plan id')
  }

  const payload = req.payload

  const plan = (await payload
    .findByID({ collection: 'plans', id: body.planId, depth: 0 })
    .catch(() => null)) as unknown as PlanDoc | null
  if (!plan || !plan.isActive) {
    throw new AppError('NOT_FOUND', 'Plan not found')
  }

  const activeSubscriptions = await payload.find({
    collection: 'subscriptions',
    where: { and: [{ user: { equals: user.id } }, { status: { equals: 'active' } }] },
    limit: 1,
  })
  if (activeSubscriptions.totalDocs > 0) {
    const existing = activeSubscriptions.docs[0] as unknown as SubscriptionDoc
    if (existing.status === 'active') {
      throw new AppError('ALREADY_EXISTS', 'You already have an active subscription')
    }
  }

  const userDoc = (await payload.findByID({
    collection: 'users',
    id: user.id,
    depth: 0,
  })) as unknown as UserDoc

  const reference = generatePaystackReference('subscription', user.id)
  const order = await payload.create({
    collection: 'orders',
    data: {
      user: user.id,
      type: 'subscription',
      plan: plan.id,
      amount: plan.price,
      currency: 'NGN',
      status: 'pending',
      reference,
    },
    overrideAccess: true,
  })

  const paystackResponse = await initializeTransaction({
    amount: Math.round(plan.price * 100),
    email: userDoc.email,
    reference,
    callback_url: `${FRONTEND_URL}/subscriptions/callback`,
    currency: 'NGN',
    plan: plan.paystackPlanCode,
    metadata: {
      userId: user.id,
      type: 'subscription',
      orderId: order.id,
      planId: plan.id,
    },
  })

  return sendSuccess(
    { authorizationUrl: paystackResponse.data.authorization_url, reference, orderId: order.id },
    undefined,
    201,
  )
}

export const subscribeEndpoint: Endpoint = {
  path: '/subscriptions/subscribe',
  method: 'post',
  handler: asyncHandler(handler),
}
