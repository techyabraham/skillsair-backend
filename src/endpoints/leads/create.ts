import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { leadRateLimiter } from '../../lib/rate-limiter.js'
import { signLeadToken } from '../../lib/jwt.js'
import { findLeadByEmail, findLeadByPhone, hashPhone, LEAD_SOURCES, normalizePhone, relationId, type LeadDoc } from '../../lib/leads.js'
import { queueOfferMessages } from '../../lib/lead-messaging.js'
import { sanitizeText } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'

const optionalText = (max: number) => z.string().trim().max(max).optional()

const leadSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  // Optional only for the programme-page "curriculum on WhatsApp" request (name + WhatsApp).
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(7).max(25),
  school: optionalText(150),
  programme: optionalText(200),
  source: z.enum(LEAD_SOURCES).optional(),
  utm: z
    .object({
      source: optionalText(200),
      medium: optionalText(200),
      campaign: optionalText(200),
      content: optionalText(200),
      term: optionalText(200),
    })
    .optional(),
  referrer: optionalText(500),
  landingPath: optionalText(500),
  marketingConsent: z.boolean().optional(),
  marketingConsentText: optionalText(1000),
  message: optionalText(2000),
  // Honeypot: real people never see or fill this field.
  website: z.string().optional(),
})

interface RelatedDoc {
  id: number
  categories?: Array<number | { id: number }> | null
}

async function findIdBySlug(req: PayloadRequest, collection: 'courses' | 'categories', slug: string): Promise<RelatedDoc | null> {
  const result = await req.payload.find({
    collection,
    where: collection === 'courses'
      ? { and: [{ slug: { equals: slug } }, { status: { equals: 'published' } }] }
      : { slug: { equals: slug } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (result.docs[0] as unknown as RelatedDoc | undefined) ?? null
}

function cleanUtm(utm: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (!utm) return undefined
  const entries = Object.entries(utm).filter((entry): entry is [string, string] => Boolean(entry[1]))
  return entries.length ? Object.fromEntries(entries.map(([key, value]) => [key, sanitizeText(value)])) : undefined
}

async function handler(req: PayloadRequest): Promise<Response> {
  await leadRateLimiter.check(req)
  const body = parseBody(leadSchema, await readJsonBody(req))

  if (body.website) {
    // Quietly accept bot submissions without storing them.
    return sendSuccess({ leadId: 0, leadToken: '', hasAccount: false }, undefined, 201)
  }

  const phone = normalizePhone(body.phone)
  if (!phone) {
    throw new AppError('VALIDATION_ERROR', 'That number looks short. Nigerian numbers have 11 digits, like 0818 000 0000.', {
      phone: 'Invalid phone number',
    })
  }

  const payload = req.payload
  if (!body.email && body.source !== 'curriculum_request') {
    throw new AppError('VALIDATION_ERROR', "That email doesn't look right. Check for a typo?", { email: 'Required' })
  }
  // Without an email, the WhatsApp number identifies the lead (reserved .invalid placeholder, never emailed).
  const existingByPhone = body.email ? null : await findLeadByPhone(payload, phone)
  const email = body.email?.toLowerCase() ?? existingByPhone?.email ?? `wa-${hashPhone(phone).slice(0, 16)}@whatsapp.invalid`
  const course = body.programme ? await findIdBySlug(req, 'courses', body.programme) : null
  const school = body.school ? await findIdBySlug(req, 'categories', body.school) : null
  const schoolId = school?.id ?? relationId(course?.categories?.[0])
  const now = new Date().toISOString()

  // Attribution is first-touch: UTMs, referrer and landing path are only stored on creation.
  const existing = await findLeadByEmail(payload, email)
  const consentGiven = body.marketingConsent === true
  const utm = cleanUtm(body.utm)

  let lead: LeadDoc
  if (existing) {
    const data: Record<string, unknown> = {
      firstName: sanitizeText(body.firstName),
      phone,
      lastEventAt: now,
      ...(course ? { course: course.id } : {}),
      ...(schoolId ? { school: schoolId } : {}),
      ...(body.message ? { message: sanitizeText(body.message) } : {}),
    }
    // Never downgrade consent here; opting out happens explicitly (STOP or unsubscribe).
    if (consentGiven) {
      data.marketingConsent = true
      data.marketingConsentAt = now
      data.marketingConsentText = body.marketingConsentText ? sanitizeText(body.marketingConsentText) : existing.marketingConsentText
      data.optedOutAt = null
    }
    lead = (await payload.update({ collection: 'leads', id: existing.id, data, depth: 0, overrideAccess: true })) as unknown as LeadDoc
    // A returning applicant who now picked a programme gets their offer once (sends are de-duplicated).
    if (course) queueOfferMessages(payload, lead.id)
  } else {
    lead = (await payload.create({
      collection: 'leads',
      data: {
        firstName: sanitizeText(body.firstName),
        email,
        phone,
        source: body.source ?? 'apply',
        status: 'new',
        ...(course ? { course: course.id } : {}),
        ...(schoolId ? { school: schoolId } : {}),
        ...(utm ? { utm } : {}),
        ...(body.referrer ? { referrer: sanitizeText(body.referrer) } : {}),
        ...(body.landingPath ? { landingPath: sanitizeText(body.landingPath) } : {}),
        ...(body.message ? { message: sanitizeText(body.message) } : {}),
        marketingConsent: consentGiven,
        ...(consentGiven
          ? { marketingConsentAt: now, marketingConsentText: sanitizeText(body.marketingConsentText ?? '') }
          : {}),
        lastEventAt: now,
      },
      depth: 0,
      overrideAccess: true,
    })) as unknown as LeadDoc
    queueOfferMessages(payload, lead.id)
  }

  const accounts = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  return sendSuccess(
    { leadId: lead.id, leadToken: signLeadToken(lead.id), hasAccount: accounts.totalDocs > 0 },
    undefined,
    existing ? 200 : 201,
  )
}

export const createLeadEndpoint: Endpoint = {
  // Attached to the Leads collection, so it is served at POST /api/leads ahead of Payload's default create.
  path: '/',
  method: 'post',
  handler: asyncHandler(handler),
}
