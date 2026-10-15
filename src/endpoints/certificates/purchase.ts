import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { paymentRateLimiter } from '../../lib/rate-limiter.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { initializeTransaction } from '../../lib/paystack.js'
import { generatePaystackReference } from '../../utils/generate-code.js'
import { AppError } from '../../types/index.js'
import { certificatePrice } from '../../lib/pricing.js'

const purchaseSchema = z.object({
  courseId: z.string().min(1),
  paymentMethod: z.enum(['paystack', 'bank_transfer']).optional(),
})

interface EnrollmentDoc {
  status: 'active' | 'completed' | 'refunded'
}

interface CourseDoc {
  id: number
  title: string
}

interface UserDoc {
  id: number
  email: string
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  await paymentRateLimiter.check(req, user.id)
  const body = parseBody(purchaseSchema, await readJsonBody(req))
  if (!isValidPayloadId(body.courseId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid course id')
  }

  const payload = req.payload

  const enrollments = await payload.find({
    collection: 'enrollments',
    where: {
      and: [{ student: { equals: user.id } }, { course: { equals: body.courseId } }],
    },
    limit: 1,
  })
  const enrollment = enrollments.docs[0] as unknown as EnrollmentDoc | undefined
  if (!enrollment || enrollment.status !== 'completed') {
    throw new AppError('VALIDATION_ERROR', 'You must complete this course before purchasing a certificate')
  }

  const existingCertificate = await payload.find({
    collection: 'certificates',
    where: { and: [{ student: { equals: user.id } }, { course: { equals: body.courseId } }] },
    limit: 1,
  })
  if (existingCertificate.totalDocs > 0) {
    throw new AppError('ALREADY_EXISTS', 'A certificate has already been issued for this course')
  }

  const course = (await payload.findByID({
    collection: 'courses',
    id: body.courseId,
    depth: 0,
  })) as unknown as CourseDoc
  const userDoc = (await payload.findByID({
    collection: 'users',
    id: user.id,
    depth: 0,
  })) as unknown as UserDoc

  const amount = certificatePrice()
  const reference = generatePaystackReference('certificate', user.id)

  const order = await payload.create({
    collection: 'orders',
    data: {
      user: user.id,
      type: 'certificate',
      course: course.id,
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
    ...(body.paymentMethod === 'bank_transfer' ? { channels: ['bank_transfer'] } : {}),
    metadata: {
      userId: user.id,
      type: 'certificate',
      orderId: order.id,
      courseId: course.id,
      description: `Certificate for ${course.title}`,
    },
  })

  return sendSuccess(
    { authorizationUrl: paystackResponse.data.authorization_url, reference, orderId: order.id },
    undefined,
    201,
  )
}

export const purchaseCertificateEndpoint: Endpoint = {
  path: '/certificates/purchase',
  method: 'post',
  handler: asyncHandler(handler),
}
