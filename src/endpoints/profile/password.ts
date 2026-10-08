import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { AppError } from '../../types/index.js'
import { isStrongPassword } from '../../utils/sanitize.js'

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).refine(isStrongPassword, {
    message: 'Password must include uppercase, lowercase, a digit, and a special character',
  }),
})

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const body = parseBody(passwordSchema, await readJsonBody(req))
  try {
    await req.payload.login({ collection: 'users', data: { email: user.email, password: body.currentPassword } })
  } catch {
    throw new AppError('AUTH_REQUIRED', 'Current password is incorrect')
  }
  await req.payload.update({
    collection: 'users',
    id: user.id,
    data: { password: body.newPassword },
    overrideAccess: true,
  })
  return sendSuccess({ changed: true })
}

export const changePasswordEndpoint: Endpoint = {
  path: '/profile/password',
  method: 'post',
  handler: asyncHandler(handler),
}
