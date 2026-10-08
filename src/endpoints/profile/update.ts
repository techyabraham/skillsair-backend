import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { AppError } from '../../types/index.js'
import { isValidE164Phone, sanitizeText } from '../../utils/sanitize.js'

const profileSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().optional(),
})

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const body = parseBody(profileSchema, await readJsonBody(req))
  if (body.phone && !isValidE164Phone(body.phone)) {
    throw new AppError('VALIDATION_ERROR', 'Phone number must be in E.164 format')
  }
  const updated = await req.payload.update({
    collection: 'users',
    id: user.id,
    data: {
      firstName: sanitizeText(body.firstName),
      lastName: sanitizeText(body.lastName),
      email: body.email.toLowerCase(),
      phone: body.phone || undefined,
    },
    overrideAccess: true,
  })
  return sendSuccess({ id: updated.id, firstName: updated.firstName, lastName: updated.lastName, email: updated.email, phone: updated.phone })
}

export const updateProfileEndpoint: Endpoint = {
  path: '/profile/update',
  method: 'patch',
  handler: asyncHandler(handler),
}
