import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { leadUpdateRateLimiter } from '../../lib/rate-limiter.js'
import { relationId, resolveLeadRequest, scoreLeadEvent, type LeadDoc } from '../../lib/leads.js'
import { AppError } from '../../types/index.js'

const updateSchema = z.object({
  currentStatus: z.enum(['student', 'graduate_nysc', 'working_switch', 'not_working']).optional(),
  device: z.enum(['laptop', 'phone_only', 'both']).optional(),
  weeklyHours: z.enum(['under_5', '5_8', '8_plus']).optional(),
  programme: z.string().trim().max(200).optional(),
  event: z.enum(['offer_viewed']).optional(),
})

async function handler(req: PayloadRequest): Promise<Response> {
  const { lead } = await resolveLeadRequest(req)
  if (!lead) throw new AppError('AUTH_REQUIRED', 'Apply first to see your offer')
  await leadUpdateRateLimiter.check(req, `lead-${lead.id}`)
  const body = parseBody(updateSchema, await readJsonBody(req))

  const data: Record<string, unknown> = {}
  if (body.currentStatus) data.currentStatus = body.currentStatus
  if (body.device) data.device = body.device
  if (body.weeklyHours) data.weeklyHours = body.weeklyHours
  if (body.programme) {
    const courses = await req.payload.find({
      collection: 'courses',
      where: { and: [{ slug: { equals: body.programme } }, { status: { equals: 'published' } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const course = courses.docs[0] as unknown as { id: number; categories?: unknown[] } | undefined
    if (!course) throw new AppError('NOT_FOUND', 'Programme not found')
    data.course = course.id
    const schoolId = relationId(course.categories?.[0])
    if (schoolId) data.school = schoolId
  }
  if (body.event === 'offer_viewed') Object.assign(data, scoreLeadEvent(lead, { type: 'offer_viewed' }))
  else data.lastEventAt = new Date().toISOString()

  const updated = (await req.payload.update({
    collection: 'leads',
    id: lead.id,
    data,
    depth: 0,
    overrideAccess: true,
  })) as unknown as LeadDoc

  return sendSuccess({
    leadId: updated.id,
    status: updated.status,
    device: updated.device ?? null,
    weeklyHours: updated.weeklyHours ?? null,
    currentStatus: updated.currentStatus ?? null,
  })
}

export const updateMyLeadEndpoint: Endpoint = {
  path: '/me',
  method: 'patch',
  handler: asyncHandler(handler),
}

/** The applicant's own details, used to prefill the account step. */
async function getHandler(req: PayloadRequest): Promise<Response> {
  const { lead } = await resolveLeadRequest(req)
  if (!lead) throw new AppError('AUTH_REQUIRED', 'Apply first to see your offer')
  await leadUpdateRateLimiter.check(req, `lead-${lead.id}`)
  const isPlaceholderEmail = lead.email.endsWith('.invalid')
  return sendSuccess({
    leadId: lead.id,
    firstName: lead.firstName,
    email: isPlaceholderEmail ? '' : lead.email,
    phone: lead.phone,
    status: lead.status,
    marketingConsent: Boolean(lead.marketingConsent) && !lead.optedOutAt,
    hasAccount: Boolean(lead.user),
  })
}

export const getMyLeadEndpoint: Endpoint = {
  path: '/me',
  method: 'get',
  handler: asyncHandler(getHandler),
}
