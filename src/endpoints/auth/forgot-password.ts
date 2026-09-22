import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { canRequestPasswordReset, storePasswordResetToken } from '../../lib/redis.js'
import { generateSecureToken, hashToken } from '../../utils/generate-code.js'
import { passwordResetEmail, sendEmail } from '../../lib/resend.js'
import { AppError } from '../../types/index.js'
import { logger } from '../../lib/logger.js'

const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

interface UserDoc {
  id: number
  email: string
  firstName: string
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

async function handler(req: PayloadRequest): Promise<Response> {
  const body = parseBody(forgotPasswordSchema, await readJsonBody(req))
  const email = body.email.toLowerCase()

  const allowed = await canRequestPasswordReset(email)
  if (!allowed) {
    throw new AppError('RATE_LIMITED', 'Too many password reset requests. Please try again later')
  }

  const payload = req.payload
  const found = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
  })

  if (found.totalDocs > 0) {
    const user = found.docs[0] as unknown as UserDoc
    const token = generateSecureToken()
    await storePasswordResetToken(hashToken(token), user.id)
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`
    try {
      await sendEmail(user.email, passwordResetEmail(user.firstName, resetUrl))
    } catch (err) {
      logger.error({ err, userId: user.id }, 'password_reset_email_failed')
    }
  }

  return sendSuccess({
    message: 'If an account exists for this email, a password reset link has been sent',
  })
}

export const forgotPasswordEndpoint: Endpoint = {
  path: '/auth/forgot-password',
  method: 'post',
  handler: asyncHandler(handler),
}
