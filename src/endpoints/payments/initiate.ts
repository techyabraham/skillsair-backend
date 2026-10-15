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
import { relationId } from '../../lib/course-access.js'
import { effectiveCoursePrice, getScholarshipWindow, windowIsOpen } from '../../lib/pricing.js'

const initiateSchema = z.object({
  type: z.enum(['course', 'subscription']),
  courseId: z.string().optional(),
  planId: z.string().optional(),
  paymentMethod: z.enum(['paystack', 'bank_transfer']).optional(),
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
    // Between scholarship windows the standard fee is charged; this is what makes the deadline real.
    const coursePrice = effectiveCoursePrice(course, windowIsOpen(await getScholarshipWindow(payload)))
    if (coursePrice <= 0) {
      throw new AppError('VALIDATION_ERROR', 'This course is free and does not require payment')
    }
    amount = coursePrice
    courseId = course.id
    await requirePrerequisites(payload, user.id, course.id)
    const existingEnrollment = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: user.id } }, { course: { equals: course.id } }] }, limit: 1, overrideAccess: true })
    if (existingEnrollment.docs[0] && !existingEnrollment.docs[0].subscription) throw new AppError('ALREADY_EXISTS', 'You already own this course')
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
    if (!plan.paystackPlanCode) throw new AppError('VALIDATION_ERROR', 'Subscription plan is not configured for billing')
    await verifyPlanConfiguration(plan.paystackPlanCode, plan.price, plan.interval)
    const subscribedCourseId = relationId(plan.course)
    if (subscribedCourseId === undefined) throw new AppError('VALIDATION_ERROR', 'Subscription plan has no course')
    const subscribedCourse = await payload.findByID({ collection: 'courses', id: subscribedCourseId, depth: 0, overrideAccess: true }).catch(() => null)
    if (!subscribedCourse || subscribedCourse.status !== 'published') throw new AppError('NOT_FOUND', 'Subscription course is unavailable')
    await requirePrerequisites(payload, user.id, subscribedCourseId)
    const existingEnrollment = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: user.id } }, { course: { equals: subscribedCourseId } }] }, limit: 1, overrideAccess: true })
    if (existingEnrollment.docs[0] && !existingEnrollment.docs[0].subscription) throw new AppError('ALREADY_EXISTS', 'You already own this course')
    const active = await payload.find({ collection: 'subscriptions', where: { and: [{ user: { equals: user.id } }, { course: { equals: subscribedCourseId } }, { status: { equals: 'active' } }, { currentPeriodEnd: { greater_than: new Date().toISOString() } }] }, limit: 1, overrideAccess: true })
    if (active.totalDocs) throw new AppError('ALREADY_EXISTS', 'You already subscribe to this course')
    amount = plan.price
    planId = plan.id
    courseId = subscribedCourseId as number
    description = plan.name
    paystackPlanCode = plan.paystackPlanCode
  }

  const userDoc = (await payload.findByID({
    collection: 'users',
    id: user.id,
    depth: 0,
  })) as unknown as UserDoc

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
    },
    overrideAccess: true,
  })

  const paystackResponse = await initializeTransaction({
    amount: Math.round(amount * 100),
    email: userDoc.email,
    reference,
    callback_url: `${FRONTEND_URL}/payments/callback`,
    currency: 'NGN',
    ...(paystackPlanCode ? { plan: paystackPlanCode } : {}),
    ...(body.paymentMethod === 'bank_transfer' ? { channels: ['bank_transfer'] } : {}),
    metadata: {
      userId: user.id,
      type: body.type,
      orderId: order.id,
      courseId,
      planId,
      description,
    },
  })

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
