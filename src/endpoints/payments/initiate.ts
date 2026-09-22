import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { paymentRateLimiter } from '../../lib/rate-limiter.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { initializeTransaction } from '../../lib/paystack.js'
import { generatePaystackReference } from '../../utils/generate-code.js'
import { AppError } from '../../types/index.js'

const initiateSchema = z.object({
  type: z.enum(['course', 'subscription']),
  courseId: z.string().optional(),
  planId: z.string().optional(),
})

interface CourseDoc {
  id: number
  title: string
  price: number
  status: 'draft' | 'published'
}

interface PlanDoc {
  id: number
  name: string
  price: number
  isActive: boolean
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
    if (course.price <= 0) {
      throw new AppError('VALIDATION_ERROR', 'This course is free and does not require payment')
    }
    amount = course.price
    courseId = course.id
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
    amount = plan.price
    planId = plan.id
    description = plan.name
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
