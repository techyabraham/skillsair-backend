import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { leadUpdateRateLimiter } from '../../lib/rate-limiter.js'
import { findLeadForUser, normalizePhone, relationId, resolveLeadRequest, scoreLeadEvent, type LeadDoc } from '../../lib/leads.js'
import { signLeadToken } from '../../lib/jwt.js'
import { queueOfferMessages } from '../../lib/lead-messaging.js'
import { resolveAuthUser } from '../../middleware/authenticate.js'
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
    // A course can be in several schools; keep the one the applicant chose if it's one of them.
    const courseSchools = (course.categories ?? []).map(relationId).filter(Boolean)
    const chosenSchool = relationId(lead.school)
    const schoolId = chosenSchool && courseSchools.includes(chosenSchool) ? chosenSchool : courseSchools[0]
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

const startSchema = z.object({
  programme: z.string().trim().min(1).max(200),
  school: z.string().trim().max(150).optional(),
})

/**
 * POST /api/leads/me: a signed-in learner applies for a programme without retyping their
 * name, WhatsApp number and email. Their application (lead) is found or created from their
 * own account, linked to it and pointed at the programme. Returns whether the three quick
 * questions were already answered, so the Apply flow can skip them too.
 */
async function startHandler(req: PayloadRequest): Promise<Response> {
  const user = await resolveAuthUser(req)
  if (!user) throw new AppError('AUTH_REQUIRED', 'Log in to apply with your account')
  await leadUpdateRateLimiter.check(req, `lead-user-${user.id}`)
  const body = parseBody(startSchema, await readJsonBody(req))
  const payload = req.payload

  const courses = await payload.find({
    collection: 'courses',
    where: { and: [{ slug: { equals: body.programme } }, { status: { equals: 'published' } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const course = courses.docs[0] as unknown as { id: number; categories?: unknown[] } | undefined
  if (!course) throw new AppError('NOT_FOUND', 'Programme not found')
  const courseSchools = (course.categories ?? []).map(relationId).filter(Boolean)
  const chosen = body.school
    ? ((await payload.find({ collection: 'categories', where: { slug: { equals: body.school } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as { id: number } | undefined)
    : undefined
  const schoolId = chosen && courseSchools.includes(chosen.id) ? chosen.id : courseSchools[0]

  const account = (await payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })) as unknown as {
    firstName?: string | null
    phone?: string | null
  }
  const now = new Date().toISOString()
  const programmeData = { course: course.id, ...(schoolId ? { school: schoolId } : {}), lastEventAt: now }
  const existing = await findLeadForUser(payload, user)

  let lead: LeadDoc
  if (existing) {
    lead = (await payload.update({ collection: 'leads', id: existing.id, data: { ...programmeData, user: user.id }, depth: 0, overrideAccess: true })) as unknown as LeadDoc
  } else {
    const phone = normalizePhone(account.phone ?? '')
    // Accounts from the old site may have no WhatsApp number; the form asks for it once.
    if (!phone) throw new AppError('VALIDATION_ERROR', 'Add your WhatsApp number to continue.', { phone: 'Required' })
    lead = (await payload.create({
      collection: 'leads',
      data: {
        firstName: account.firstName?.trim() || user.email.split('@')[0],
        email: user.email.toLowerCase(),
        phone,
        source: 'apply',
        status: 'new',
        user: user.id,
        marketingConsent: false,
        ...programmeData,
      },
      depth: 0,
      overrideAccess: true,
    })) as unknown as LeadDoc
  }
  // Sends the offer email and WhatsApp once per applicant (repeat calls are de-duplicated).
  queueOfferMessages(payload, lead.id)

  return sendSuccess({
    leadId: lead.id,
    leadToken: signLeadToken(lead.id),
    answered: Boolean(lead.currentStatus && lead.device && lead.weeklyHours),
  })
}

export const startMyApplicationEndpoint: Endpoint = {
  path: '/me',
  method: 'post',
  handler: asyncHandler(startHandler),
}
