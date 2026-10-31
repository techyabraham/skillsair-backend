import { attributeUser, attributionSnapshot } from '../../lib/ambassadors/attribution.js'
import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { paymentRateLimiter } from '../../lib/rate-limiter.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { initializeTransaction, verifyPlanConfiguration } from '../../lib/paystack.js'
import { generatePaystackReference } from '../../utils/generate-code.js'
import { AppError } from '../../types/index.js'
import { requirePrerequisites } from '../../lib/prerequisites.js'
import { ownsCourseOutright, relationId } from '../../lib/course-access.js'
import { oneOffCoursePrice } from '../../lib/pricing.js'
import { assertCanStartPlan, assertManualRenewalAllowed, assertNoCurrentSubscription, findRenewableManualSubscription } from '../../lib/subscription-guards.js'
import { billingFor, PAYMENT_METHODS, paystackChannels, paystackFee, withPaystackFee } from '../../lib/billing.js'
import { closeReplacedOrder } from '../../lib/order-replace.js'

const initiateSchema = z.object({
  attribution: z.string().max(1000).optional(),
  type: z.enum(['course', 'subscription']),
  courseId: z.string().optional(),
  planId: z.string().optional(),
  // Bank transfer is the default; see PAYMENT_METHODS in billing.ts.
  paymentMethod: z.enum(PAYMENT_METHODS).optional().default('bank_transfer'),
  // "Complete payment" from order history: the learner's pending order this payment replaces.
  replacesOrderId: z.union([z.string(), z.number()]).optional(),
})

interface CourseDoc {
  id: number
  title: string
  price: number
  standardPrice?: number | null
  status: 'draft' | 'published'
}

interface PlanDoc {
  id: number
  name: string
  price: number
  isActive: boolean
  paystackPlanCode: string
  course: number | { id: number }
  interval: 'monthly' | 'annually'
  kind?: 'scholarship' | 'standard' | null
}

interface UserDoc {
  id: number
  email: string
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  await paymentRateLimiter.check(req, user.id)
  const body = parseBody(initiateSchema, await readJsonBody(req))
  const payload = req.payload

  let amount = 0
  let courseId: number | undefined
  let planId: number | undefined
  let description = ''
  let paystackPlanCode: string | undefined
  // Month-by-month (transfer/OPay) payment that extends the learner's current plan by a month.
  let renewsSubscriptionId: number | undefined
  const paymentMethod = body.paymentMethod ?? 'bank_transfer'
  const billing = billingFor(paymentMethod)

  if (body.type === 'course') {
    if (!body.courseId || !isValidPayloadId(body.courseId)) {
      throw new AppError('VALIDATION_ERROR', 'A valid courseId is required')
    }
    const course = (await payload
      .findByID({ collection: 'courses', id: body.courseId, depth: 0 })
      .catch(() => null)) as unknown as CourseDoc | null
    if (!course || course.status !== 'published') {
      throw new AppError('NOT_FOUND', 'Course not found')
    }
    // The Access Scholarship is billed monthly through the course's scholarship plan, so a one-off
    // course payment is always the standard fee (when the course has one).
    const coursePrice = oneOffCoursePrice(course)
    if (coursePrice <= 0) {
      throw new AppError('VALIDATION_ERROR', 'This course is free and does not require payment')
    }
    amount = coursePrice
    courseId = course.id
    await requirePrerequisites(payload, user.id, course.id)
    const existingEnrollment = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: user.id } }, { course: { equals: course.id } }] }, limit: 1, overrideAccess: true })
    if (ownsCourseOutright(existingEnrollment.docs[0])) throw new AppError('ALREADY_EXISTS', 'You already own this course')
    description = course.title
  } else {
    if (!body.planId || !isValidPayloadId(body.planId)) {
      throw new AppError('VALIDATION_ERROR', 'A valid planId is required')
    }
    const plan = (await payload
      .findByID({ collection: 'plans', id: body.planId, depth: 0 })
      .catch(() => null)) as unknown as PlanDoc | null
    if (!plan || !plan.isActive) {
      throw new AppError('NOT_FOUND', 'Plan not found')
    }
    await assertCanStartPlan(payload, plan, user.id)
    const subscribedCourseId = relationId(plan.course)
    if (subscribedCourseId === undefined) throw new AppError('VALIDATION_ERROR', 'Subscription plan has no course')
    const subscribedCourse = await payload.findByID({ collection: 'courses', id: subscribedCourseId, depth: 0, overrideAccess: true }).catch(() => null)
    if (!subscribedCourse || subscribedCourse.status !== 'published') throw new AppError('NOT_FOUND', 'Subscription course is unavailable')
    await requirePrerequisites(payload, user.id, subscribedCourseId)
    const existingEnrollment = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: user.id } }, { course: { equals: subscribedCourseId } }] }, limit: 1, overrideAccess: true })
    if (ownsCourseOutright(existingEnrollment.docs[0])) throw new AppError('ALREADY_EXISTS', 'You already own this course')
    const renewable = await findRenewableManualSubscription(payload, user.id, Number(subscribedCourseId))
    if (renewable) {
      assertManualRenewalAllowed(renewable, billing)
      if (billing === 'manual') renewsSubscriptionId = renewable.id
    } else {
      await assertNoCurrentSubscription(payload, user.id, Number(subscribedCourseId))
    }
    // Card payments become a Paystack subscription, so the plan must exist at Paystack with the
    // same price; transfer and OPay pay one month at a time and don't use the Paystack plan.
    if (billing === 'card') {
      if (!plan.paystackPlanCode) throw new AppError('VALIDATION_ERROR', 'Subscription plan is not configured for billing')
      // The Paystack plan charges the price plus the Paystack fee each month.
      await verifyPlanConfiguration(plan.paystackPlanCode, withPaystackFee(plan.price), plan.interval)
    }
    amount = plan.price
    planId = plan.id
    courseId = subscribedCourseId as number
    description = plan.name
    // Only card payments become a Paystack subscription; transfer and OPay pay for one month.
    if (billing === 'card') paystackPlanCode = plan.paystackPlanCode
  }

  const userDoc = (await payload.findByID({
    collection: 'users',
    id: user.id,
    depth: 0,
  })) as unknown as UserDoc

  // Enrolments pass Paystack's fee on to the learner: the order is for what they're charged.
  const price = amount
  const fee = paystackFee(price)
  amount = price + fee

  await attributeUser(payload, { userId: user.id, value: body.attribution, source: 'cookie_checkout' })
  const snapshot = await attributionSnapshot(payload, user.id)
  const reference = generatePaystackReference(body.type, user.id)

  const order = await payload.create({
    collection: 'orders',
    data: {
      user: user.id,
      type: body.type,
      course: courseId,
      plan: planId,
      amount,
      currency: 'NGN',
      status: 'pending',
      reference,
      metadata: { ...snapshot, paymentMethod, price, paystackFee: fee, ...(body.type === 'subscription' ? { billing } : {}), ...(renewsSubscriptionId ? { renewsSubscriptionId } : {}) },
    },
    overrideAccess: true,
  })

  const channels = paystackChannels(paymentMethod, Boolean(paystackPlanCode))
  const paystackResponse = await initializeTransaction({
    amount: Math.round(amount * 100),
    email: userDoc.email,
    reference,
    callback_url: `${FRONTEND_URL}/payments/callback`,
    currency: 'NGN',
    ...(paystackPlanCode ? { plan: paystackPlanCode } : {}),
    // Card subscriptions renew from the saved card, so they're card-only; transfer and OPay use
    // their own channel; a one-off "Paystack" payment shows every option.
    ...(channels ? { channels } : {}),
    metadata: {
      userId: user.id,
      type: body.type,
      orderId: order.id,
      courseId,
      planId,
      description,
      paymentMethod,
      ...(body.type === 'subscription' ? { billing } : {}),
      ...(renewsSubscriptionId ? { renewsSubscriptionId } : {}),
    },
  })

  await closeReplacedOrder(payload, { userId: user.id, replacesOrderId: body.replacesOrderId, newOrderId: order.id, type: body.type, courseId })

  return sendSuccess(
    {
      authorizationUrl: paystackResponse.data.authorization_url,
      reference,
      orderId: order.id,
    },
    undefined,
    201,
  )
}

export const initiatePaymentEndpoint: Endpoint = {
  path: '/payments/initiate',
  method: 'post',
  handler: asyncHandler(handler),
}
