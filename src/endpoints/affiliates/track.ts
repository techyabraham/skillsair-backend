import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'

const trackSchema = z.object({
  affiliateCode: z.string().min(1),
})

interface AffiliateDoc {
  id: number
  totalClicks: number
}

async function handler(req: PayloadRequest): Promise<Response> {
  const body = parseBody(trackSchema, await readJsonBody(req))
  const payload = req.payload

  const result = await payload.find({
    collection: 'affiliates',
    where: { affiliateCode: { equals: body.affiliateCode.toUpperCase() } },
    limit: 1,
    overrideAccess: true,
  })
  const affiliate = result.docs[0] as unknown as AffiliateDoc | undefined
  if (affiliate) {
    await payload.update({
      collection: 'affiliates',
      id: affiliate.id,
      data: { totalClicks: affiliate.totalClicks + 1 },
      overrideAccess: true,
    })
  }

  return sendSuccess({ tracked: true })
}

export const trackAffiliateEndpoint: Endpoint = {
  path: '/affiliates/track',
  method: 'post',
  handler: asyncHandler(handler),
}
