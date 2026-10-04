import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { paymentRateLimiter } from '../../lib/rate-limiter.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { initializeTransaction, verifyPlanConfiguration } from '../../lib/paystack.js'
import { generatePaystackReference } from '../../utils/generate-code.js'
import { AppError } from '../../types/index.js'
import { relationId } from '../../lib/course-access.js'
import { requirePrerequisites } from '../../lib/prerequisites.js'

const subscribeSchema = z.object({
  planId: z.string().min(1),
})

interface PlanDoc {
  id: number
  name: string
  price: number
  isActive: boolean
  paystackPlanCode: string
  course: number | { id: number }
  interval: 'monthly' | 'annually'
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
  if (!plan.paystackPlanCode) throw new AppError('VALIDATION_ERROR', 'Subscription plan is not configured for billing')
  await verifyPlanConfiguration(plan.paystackPlanCode, plan.price, plan.interval)
  const courseId = relationId(plan.course)
  if (courseId === undefined) throw new AppError('VALIDATION_ERROR', 'Subscription plan has no course')
  const subscribedCourse = await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!subscribedCourse || subscribedCourse.status !== 'published') throw new AppError('NOT_FOUND', 'Subscription course is unavailable')
  await requirePrerequisites(payload, user.id, courseId)

  const activeSubscriptions = await payload.find({
    collection: 'subscriptions',
    where: { and: [{ user: { equals: user.id } }, { course: { equals: courseId } }, { status: { equals: 'active' } }, { currentPeriodEnd: { greater_than: new Date().toISOString() } }] },
    limit: 1,
  })
  if (activeSubscriptions.totalDocs > 0) {
    const existing = activeSubscriptions.docs[0] as unknown as SubscriptionDoc
    if (existing.status === 'active') {
      throw new AppError('ALREADY_EXISTS', 'You already have an active subscription')
    }
  }
  const existingEnrollment = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: user.id } }, { course: { equals: courseId } }] }, limit: 1, overrideAccess: true })
  if (existingEnrollment.docs[0] && !existingEnrollment.docs[0].subscription) throw new AppError('ALREADY_EXISTS', 'You already own this course')

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
      course: courseId,
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
