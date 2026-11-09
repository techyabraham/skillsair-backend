import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { leadRateLimiter } from '../../lib/rate-limiter.js'
import { signLeadToken } from '../../lib/jwt.js'
import { findLeadByEmail, findLeadByPhone, hashPhone, LEAD_SOURCES, normalizePhone, relationId, type LeadDoc } from '../../lib/leads.js'
import { queueOfferMessages } from '../../lib/lead-messaging.js'
import { sanitizeText } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'
import { attributeLead } from '../../lib/ambassadors/attribution.js'
import { logger } from '../../lib/logger.js'
import { evaluateQuiz, publishedProgrammes, queueQuizMessages, quizLeadData, quizSubmissionSchema, resolveTopOpen, saveQuizResult, type EvaluatedQuiz } from '../../lib/career-quiz.js'

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
  // Career Match quiz (source "quiz"): answer ids only; scores are recomputed here.
  quiz: quizSubmissionSchema.optional(),
  // Ambassador referral (the site's sa_ref cookie), attributed to this application.
  attribution: z.string().max(1000).optional(),
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
  // Validate and score the quiz before saving anything, so bad answers never create a lead.
  if (body.quiz && body.source !== 'quiz') throw new AppError('VALIDATION_ERROR', 'Quiz answers can only be sent from the quiz.')
  const quiz: EvaluatedQuiz | null = body.quiz ? evaluateQuiz(body.quiz) : null
  const topOpen = quiz ? resolveTopOpen(quiz.result, await publishedProgrammes(payload)) : null
  // A quiz applicant's programme is their best open match (the offer and WhatsApp are about it).
  const programmeSlug = quiz ? topOpen?.slug : body.programme
  const course = programmeSlug ? await findIdBySlug(req, 'courses', programmeSlug) : null
  const school = body.school ? await findIdBySlug(req, 'categories', body.school) : null
  const schoolId = school?.id ?? relationId(course?.categories?.[0])
  // A school the backend doesn't have yet is kept on the lead so Imisi can follow up.
  const schoolNote = body.school && !schoolId ? `Interested in school: ${sanitizeText(body.school)}` : ''
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
    if (course && !quiz) queueOfferMessages(payload, lead.id)
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
        ...(schoolNote ? { notes: schoolNote } : {}),
        marketingConsent: consentGiven,
        ...(consentGiven
          ? { marketingConsentAt: now, marketingConsentText: sanitizeText(body.marketingConsentText ?? '') }
          : {}),
        lastEventAt: now,
      },
      depth: 0,
      overrideAccess: true,
    })) as unknown as LeadDoc
    if (!quiz) queueOfferMessages(payload, lead.id)
  }

  if (body.attribution) {
    // Never fails the application: a bad or unknown referral just isn't recorded.
    try {
      await attributeLead(payload, { leadId: Number(lead.id), value: body.attribution })
    } catch (err) {
      logger.error({ err, leadId: lead.id }, 'ambassador_lead_attribution_failed')
    }
  }

  const accounts = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  let resultId: string | undefined
  if (quiz) {
    // Profile and context answers go on the applicant (Apply won't ask them again); the result
    // gets its own unguessable id for /quiz/result/<id>, linked to the account if there is one.
    const accountId = (accounts.docs[0] as unknown as { id: number } | undefined)?.id ?? null
    lead = (await payload.update({
      collection: 'leads',
      id: lead.id,
      data: { ...quizLeadData(quiz, topOpen?.courseId ?? null), ...(accountId && !lead.user ? { user: accountId } : {}) },
      depth: 0,
      overrideAccess: true,
    })) as unknown as LeadDoc
    resultId = await saveQuizResult(payload, lead, quiz, topOpen, accountId)
    queueQuizMessages(payload, lead.id, resultId, quiz, topOpen)
  }

  return sendSuccess(
    { leadId: lead.id, leadToken: signLeadToken(lead.id), hasAccount: accounts.totalDocs > 0, ...(resultId ? { resultId } : {}) },
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
