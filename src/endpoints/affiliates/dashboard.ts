import type { Endpoint, PayloadRequest } from 'payload'
import { sendSuccess, asyncHandler } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { AppError } from '../../types/index.js'

interface AffiliateDoc {
  id: number
}

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const payload = req.payload

  const affiliates = await payload.find({
    collection: 'affiliates',
    where: { user: { equals: user.id } },
    limit: 1,
  })
  const affiliate = affiliates.docs[0] as unknown as AffiliateDoc | undefined
  if (!affiliate) {
    throw new AppError('NOT_FOUND', 'You are not registered as an affiliate')
  }

  const referrals = await payload.find({
    collection: 'referrals',
    where: { referrer: { equals: user.id } },
    sort: '-createdAt',
    limit: 100,
  })

  return sendSuccess({ affiliate: affiliates.docs[0], referrals: referrals.docs })
}

export const affiliateDashboardEndpoint: Endpoint = {
  path: '/affiliates/dashboard',
  method: 'get',
  handler: asyncHandler(handler),
}
