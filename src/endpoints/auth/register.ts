import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { authRateLimiter } from '../../lib/rate-limiter.js'
import { sanitizeText, isStrongPassword, isValidE164Phone } from '../../utils/sanitize.js'
import { generateAuthTokenPair } from '../../lib/jwt.js'
import { AppError } from '../../types/index.js'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).refine(isStrongPassword, {
    message: 'Password must include uppercase, lowercase, a digit, and a special character',
  }),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().optional(),
  referralCode: z.string().optional(),
})

interface UserDoc {
  id: number
  email: string
  role: 'admin' | 'instructor' | 'student'
  firstName: string
  lastName: string
}

async function handler(req: PayloadRequest): Promise<Response> {
  await authRateLimiter.check(req)
  const body = parseBody(registerSchema, await readJsonBody(req))

  if (body.phone && !isValidE164Phone(body.phone)) {
    throw new AppError('VALIDATION_ERROR', 'Phone number must be in E.164 format', {
      phone: 'Invalid phone format',
    })
  }

  const payload = req.payload

  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: body.email.toLowerCase() } },
    limit: 1,
  })
  if (existing.totalDocs > 0) {
    throw new AppError('ALREADY_EXISTS', 'An account with this email already exists')
  }

  let referredBy: number | undefined
  if (body.referralCode) {
    const referrer = await payload.find({
      collection: 'users',
      where: { referralCode: { equals: body.referralCode.toUpperCase() } },
      limit: 1,
    })
    if (referrer.totalDocs > 0) {
      referredBy = referrer.docs[0]?.id as number
    }
  }

  const created = (await payload.create({
    collection: 'users',
    data: {
      email: body.email.toLowerCase(),
      password: body.password,
      firstName: sanitizeText(body.firstName),
      lastName: sanitizeText(body.lastName),
      phone: body.phone,
      role: 'student',
      referredBy,
    },
    overrideAccess: true,
  })) as unknown as UserDoc

  if (referredBy) {
    await payload.create({
      collection: 'referrals',
      data: {
        referrer: referredBy,
        referredUser: created.id,
        referralCode: body.referralCode?.toUpperCase() ?? '',
        status: 'registered',
      },
      overrideAccess: true,
    })
  }

  const tokens = generateAuthTokenPair(created.id, created.role)
  return sendSuccess(
    {
      user: {
        id: created.id,
        email: created.email,
        firstName: created.firstName,
        lastName: created.lastName,
        role: created.role,
      },
      ...tokens,
    },
    undefined,
    201,
  )
}

export const registerEndpoint: Endpoint = {
  path: '/auth/register',
  method: 'post',
  handler: asyncHandler(handler),
}
