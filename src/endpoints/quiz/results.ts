import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { createPayloadRateLimiterFor } from '../../lib/rate-limiter.js'
import { relationId, resolveLeadRequest } from '../../lib/leads.js'
import { publishedProgrammes } from '../../lib/career-quiz.js'
import { careerStatus, isCareerId } from '../../content/career-quiz.js'
import { AppError } from '../../types/index.js'

const resultReadLimiter = createPayloadRateLimiterFor('quiz-result', 120, 15 * 60)
const waitlistLimiter = createPayloadRateLimiterFor('quiz-waitlist', 30, 15 * 60)

const PUBLIC_ID = /^[A-Za-z0-9_-]{16,32}$/

interface QuizResultDoc {
  id: number
  publicId: string
  quizVersion: string
  firstName?: string | null
  lead?: number | { id: number } | null
  user?: number | { id: number } | null
  topMatch?: string | null
  answers?: Record<string, string> | null
  tieBreaker?: string | null
  scores?: Array<{ career: string; percent: number }> | null
  traits?: Record<string, number> | null
  context?: Record<string, string> | null
  createdAt: string
}

async function loadResult(req: PayloadRequest): Promise<QuizResultDoc> {
  const publicId = getParam(req, 'publicId')
  if (!PUBLIC_ID.test(publicId)) throw new AppError('NOT_FOUND', 'Result not found')
  const found = await req.payload.find({ collection: 'quiz-results' as never, where: { publicId: { equals: publicId } }, limit: 1, depth: 0, overrideAccess: true })
  const doc = found.docs[0] as unknown as QuizResultDoc | undefined
  if (!doc) throw new AppError('NOT_FOUND', 'Result not found')
  return doc
}

async function waitlistedCareers(req: PayloadRequest, leadId: number | undefined): Promise<string[]> {
  if (!leadId) return []
  const rows = await req.payload.find({ collection: 'career-waitlist' as never, where: { lead: { equals: leadId } }, limit: 50, depth: 0, overrideAccess: true })
  return (rows.docs as unknown as Array<{ career: string }>).map((row) => row.career)
}

/**
 * GET /api/quiz-results/public/:publicId: a saved result for /quiz/result/<id>. First name
 * only: no email, phone or lead id. Open/waitlist status is resolved by the page from the
 * live catalogue, so publishing a course flips old results to "Apply" too.
 */
async function getHandler(req: PayloadRequest): Promise<Response> {
  await resultReadLimiter.check(req)
  const doc = await loadResult(req)
  return sendSuccess({
    publicId: doc.publicId,
    quizVersion: doc.quizVersion,
    firstName: doc.firstName ?? '',
    topMatch: doc.topMatch ?? null,
    answers: doc.answers ?? {},
    tieBreaker: doc.tieBreaker ?? null,
    scores: doc.scores ?? [],
    traits: doc.traits ?? {},
    context: doc.context ?? {},
    welcomeBack: Boolean(relationId(doc.user)),
    waitlisted: await waitlistedCareers(req, relationId(doc.lead) ?? undefined),
    createdAt: doc.createdAt,
  })
}

export const getQuizResultEndpoint: Endpoint = { path: '/public/:publicId', method: 'get', handler: asyncHandler(getHandler) }

const waitlistSchema = z.object({ career: z.string().max(40) })

/**
 * POST /api/quiz-results/public/:publicId/waitlist { career }: one-tap waitlist join with the
 * details already given at the quiz gate. Only the person who took the quiz (their applicant
 * cookie, or their account) can join from a result; a forwarded link can't sign them up.
 */
async function joinHandler(req: PayloadRequest): Promise<Response> {
  await waitlistLimiter.check(req)
  const doc = await loadResult(req)
  const { career } = parseBody(waitlistSchema, await readJsonBody(req))
  if (!isCareerId(career)) throw new AppError('VALIDATION_ERROR', 'Unknown career')
  const programmes = await publishedProgrammes(req.payload)
  if (careerStatus(career, new Set(programmes.keys())) === 'open') throw new AppError('VALIDATION_ERROR', 'This programme is open now. You can apply straight away.')

  const leadId = relationId(doc.lead)
  const { lead, user } = await resolveLeadRequest(req)
  const ownsResult = Boolean(leadId && lead && lead.id === leadId) || Boolean(user && relationId(doc.user) === user.id)
  if (!leadId || !ownsResult) throw new AppError('AUTH_REQUIRED', 'Open this on the phone you took the quiz on, or message us on WhatsApp to join.')

  const existing = await req.payload.find({
    collection: 'career-waitlist' as never,
    where: { and: [{ lead: { equals: leadId } }, { career: { equals: career } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (!existing.docs.length) {
    await req.payload.create({
      collection: 'career-waitlist' as never,
      data: { lead: leadId, career, joinedAt: new Date().toISOString(), source: 'quiz' } as never,
      depth: 0,
      overrideAccess: true,
    })
  }
  return sendSuccess({ career, waitlisted: true })
}

export const joinQuizWaitlistEndpoint: Endpoint = { path: '/public/:publicId/waitlist', method: 'post', handler: asyncHandler(joinHandler) }
