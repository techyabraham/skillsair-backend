import type { Endpoint, PayloadRequest } from 'payload'
import { asyncHandler, getParam, sendSuccess } from '../../middleware/validate.js'
import { leadResumeRateLimiter } from '../../lib/rate-limiter.js'
import { signLeadToken } from '../../lib/jwt.js'
import { relationId, type LeadDoc } from '../../lib/leads.js'
import { AppError } from '../../types/index.js'

/** Exchanges a personal resume code (from WhatsApp or email) for a fresh lead token. */
async function handler(req: PayloadRequest): Promise<Response> {
  await leadResumeRateLimiter.check(req)
  const code = getParam(req, 'code')
  if (!/^[A-Za-z0-9]{10}$/.test(code)) throw new AppError('NOT_FOUND', 'Offer link not found')

  const result = await req.payload.find({
    collection: 'leads',
    where: { resumeCode: { equals: code } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const lead = result.docs[0] as unknown as LeadDoc | undefined
  if (!lead) throw new AppError('NOT_FOUND', 'Offer link not found')

  let programme: string | null = null
  const courseId = relationId(lead.course)
  if (courseId) {
    const course = await req.payload
      .findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true })
      .catch(() => null)
    if (course && course.status === 'published') programme = String(course.slug ?? '') || null
  }

  return sendSuccess({ leadToken: signLeadToken(lead.id), programme })
}

export const resumeLeadEndpoint: Endpoint = {
  path: '/resume/:code',
  method: 'get',
  handler: asyncHandler(handler),
}
