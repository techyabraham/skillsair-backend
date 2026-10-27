import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { accountIdentity, authAccountRateLimiter, authIpRateLimiter } from '../../lib/rate-limiter.js'
import { generateAuthTokenPair } from '../../lib/jwt.js'
import { recordFailedLogin, getLoginLockStatus, clearFailedLogins } from '../../lib/redis.js'
import { AppError } from '../../types/index.js'
import { logSecurityEvent } from '../../lib/logger.js'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

interface UserDoc {
  id: number
  email: string
  role: 'admin' | 'instructor' | 'student'
  firstName: string
  lastName: string
  isActive: boolean
}

async function handler(req: PayloadRequest): Promise<Response> {
  const body = parseBody(loginSchema, await readJsonBody(req))
  const email = body.email.toLowerCase()
  await authAccountRateLimiter.check(req, accountIdentity(email))
  await authIpRateLimiter.check(req)

  const lockStatus = await getLoginLockStatus(email)
  if (lockStatus.locked) {
    throw new AppError(
      'RATE_LIMITED',
      `Too many failed login attempts. Try again in ${lockStatus.retryAfterSeconds ?? 0} seconds`,
    )
  }

  const payload = req.payload

  try {
    const result = await payload.login({
      collection: 'users',
      data: { email, password: body.password },
    })
    const user = result.user as unknown as UserDoc
    if (!user.isActive) {
      throw new AppError('INSUFFICIENT_PERMISSION', 'This account has been deactivated')
    }
    await clearFailedLogins(email)
    await payload.update({
      collection: 'users',
      id: user.id,
      data: { lastLoginAt: new Date().toISOString() },
      overrideAccess: true,
    })

    const tokens = generateAuthTokenPair(user.id, user.role)
    return sendSuccess({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      ...tokens,
    })
  } catch (err) {
    if (err instanceof AppError) throw err
    const status = await recordFailedLogin(email)
    logSecurityEvent('failed_login', { email })
    if (status.locked) {
      throw new AppError(
        'RATE_LIMITED',
        `Too many failed login attempts. Try again in ${status.retryAfterSeconds ?? 0} seconds`,
      )
    }
    throw new AppError('AUTH_REQUIRED', 'Invalid email or password')
  }
}

export const loginEndpoint: Endpoint = {
  path: '/auth/login',
  method: 'post',
  handler: asyncHandler(handler),
}
