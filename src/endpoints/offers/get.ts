import type { Endpoint, PayloadRequest } from 'payload'
import { asyncHandler, getParam, sendSuccess } from '../../middleware/validate.js'
import { relationId, resolveLeadRequest } from '../../lib/leads.js'
import { buildOffer, findPublishedCourseBySlug } from '../../lib/offers.js'
import { AppError } from '../../types/index.js'

/** The personal offer is only revealed to a lead (lead token) or a logged-in user. */
async function handler(req: PayloadRequest): Promise<Response> {
  const { lead, user } = await resolveLeadRequest(req)
  if (!lead && !user) throw new AppError('AUTH_REQUIRED', 'Apply first to see your offer')

  const slug = getParam(req, 'courseSlug')
  const course = await findPublishedCourseBySlug(req.payload, slug)
  if (!course) throw new AppError('NOT_FOUND', 'Programme not found')

  const userId = user?.id ?? relationId(lead?.user)
  const offer = await buildOffer(req.payload, course, userId ? Number(userId) : undefined)

  // Leads who see the closed state join the waitlist for the next window.
  if (lead && !offer.windowOpen && !offer.priceLocked && !lead.waitlist) {
    await req.payload.update({
      collection: 'leads',
      id: lead.id,
      data: { waitlist: true },
      depth: 0,
      overrideAccess: true,
    })
  }

  let firstName = lead?.firstName ?? ''
  if (!firstName && user) {
    const account = await req.payload
      .findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })
      .catch(() => null)
    firstName = String(account?.firstName ?? '')
  }

  return sendSuccess({
    ...offer,
    firstName,
    // The applicant's own answers; `weeklyHours` above is the programme's expected effort.
    applicantDevice: lead?.device ?? null,
    applicantWeeklyHours: lead?.weeklyHours ?? null,
    isLead: Boolean(lead),
    isUser: Boolean(user),
  })
}

export const getOfferEndpoint: Endpoint = {
  path: '/offers/:courseSlug',
  method: 'get',
  handler: asyncHandler(handler),
}
