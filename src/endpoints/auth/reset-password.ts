import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { getPasswordResetUserId, deletePasswordResetToken } from '../../lib/redis.js'
import { hashToken } from '../../utils/generate-code.js'
import { isStrongPassword } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).refine(isStrongPassword, {
    message: 'Password must include uppercase, lowercase, a digit, and a special character',
  }),
})

async function handler(req: PayloadRequest): Promise<Response> {
  const body = parseBody(resetPasswordSchema, await readJsonBody(req))
  const hashedToken = hashToken(body.token)

  const userId = await getPasswordResetUserId(hashedToken)
  if (!userId) {
    throw new AppError('AUTH_REQUIRED', 'This password reset link is invalid or has expired')
  }

  const payload = req.payload
  await payload.update({
    collection: 'users',
    id: userId,
    data: { password: body.newPassword },
    overrideAccess: true,
  })
  await deletePasswordResetToken(hashedToken)

  return sendSuccess({ message: 'Password has been reset successfully' })
}

export const resetPasswordEndpoint: Endpoint = {
  path: '/auth/reset-password',
  method: 'post',
  handler: asyncHandler(handler),
}
