import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { sendSuccess, asyncHandler, parseBody, readJsonBody } from '../../middleware/validate.js'
import { getBearerToken, requireAuth } from '../../middleware/authenticate.js'
import { blacklistToken } from '../../lib/redis.js'
import { decodeTokenExpirySeconds } from '../../lib/jwt.js'

const logoutSchema = z.object({
  refreshToken: z.string().optional(),
})

async function handler(req: PayloadRequest): Promise<Response> {
  await requireAuth(req)
  const body = parseBody(logoutSchema, (await readJsonBody(req)) ?? {})
  const accessToken = getBearerToken(req)

  await blacklistToken(accessToken, decodeTokenExpirySeconds(accessToken))
  if (body.refreshToken) {
    await blacklistToken(body.refreshToken, decodeTokenExpirySeconds(body.refreshToken))
  }

  return sendSuccess({ loggedOut: true })
}

export const logoutEndpoint: Endpoint = {
  path: '/auth/logout',
  method: 'post',
  handler: asyncHandler(handler),
}
