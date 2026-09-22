import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { authRateLimiter } from '../../lib/rate-limiter.js'
import { verifyRefreshToken, decodeTokenExpirySeconds, generateAuthTokenPair } from '../../lib/jwt.js'
import { isTokenBlacklisted, blacklistToken } from '../../lib/redis.js'
import { AppError } from '../../types/index.js'

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

interface UserDoc {
  id: number
  role: 'admin' | 'instructor' | 'student'
  isActive: boolean
}

async function handler(req: PayloadRequest): Promise<Response> {
  await authRateLimiter.check(req)
  const body = parseBody(refreshSchema, await readJsonBody(req))

  if (await isTokenBlacklisted(body.refreshToken)) {
    throw new AppError('AUTH_REQUIRED', 'Refresh token has been revoked')
  }

  let payloadToken
  try {
    payloadToken = verifyRefreshToken(body.refreshToken)
  } catch {
    throw new AppError('AUTH_REQUIRED', 'Invalid or expired refresh token')
  }

  const payload = req.payload
  const user = (await payload.findByID({
    collection: 'users',
    id: payloadToken.userId,
    depth: 0,
  })) as unknown as UserDoc

  if (!user || !user.isActive) {
    throw new AppError('AUTH_REQUIRED', 'Account is no longer active')
  }

  await blacklistToken(body.refreshToken, decodeTokenExpirySeconds(body.refreshToken))
  const tokens = generateAuthTokenPair(user.id, user.role)
  return sendSuccess(tokens)
}

export const refreshEndpoint: Endpoint = {
  path: '/auth/refresh',
  method: 'post',
  handler: asyncHandler(handler),
}
