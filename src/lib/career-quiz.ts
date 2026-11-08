/**
 * Career Match quiz on the server: validates answers, recomputes scores (never trusting the
 * client), saves the result, puts the quiz profile on the applicant and sends the result.
 * The quiz itself (questions, weights, scoring) is src/content/career-quiz.ts, an exact copy of
 * the frontend's src/content/quiz-v2.ts.
 */
import crypto from 'node:crypto'
import type { Payload } from 'payload'
import { z } from 'zod'
import {
  QUIZ_VERSION,
  careerStatus,
  careers,
  matchLabel,
  scoreQuiz,
  topOpenMatch,
  validateAnswers,
  validateContext,
  type CareerId,
  type QuizAnswers,
  type QuizContext,
  type QuizResult,
} from '../content/career-quiz.js'
import { AppError } from '../types/index.js'
import { logger } from './logger.js'
import { hasFollowUp, type LeadDoc } from './leads.js'
import { isDeliverableEmail, sendOfferMessages } from './lead-messaging.js'
import { sendEmail } from './resend.js'
import { quizResult as quizResultEmail } from '../emails/quiz-result.js'
import { loadPerson } from './lifecycle/context.js'
import { recordMessage } from './lifecycle/send.js'
import { idempotencyKey } from './lifecycle/plan.js'

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

export const quizSubmissionSchema = z.object({
  version: z.literal(QUIZ_VERSION),
  answers: z.record(z.string(), z.string().max(40)),
  tieBreaker: z.string().max(40).nullable().optional(),
  context: z.record(z.string(), z.string().max(40)),
})

export type QuizSubmission = z.infer<typeof quizSubmissionSchema>

export interface EvaluatedQuiz {
  answers: QuizAnswers
  context: QuizContext
  tieBreaker: string | null
  result: QuizResult
}

/** Validates every answer id and recomputes the scores. Throws a 400 for anything unknown. */
export function evaluateQuiz(submission: QuizSubmission): EvaluatedQuiz {
  const answers = validateAnswers(submission.answers)
  if (!answers.ok) throw new AppError('VALIDATION_ERROR', 'Some quiz answers were not recognised. Please retake the quiz.', { quiz: answers.error })
  const context = validateContext(submission.context)
  if (!context.ok) throw new AppError('VALIDATION_ERROR', 'Some quiz answers were not recognised. Please retake the quiz.', { quiz: context.error })
  const result = scoreQuiz(answers.value, submission.tieBreaker ?? null)
  return { answers: answers.value, context: context.value, tieBreaker: result.tieBreaker?.winner ?? null, result }
}

interface CourseRow {
  id: number
  slug?: string | null
  categories?: Array<number | { id: number }> | null
}

/** Published, paid programmes by slug (bonus courses such as Freelancer's Academy are never a match). */
export async function publishedProgrammes(payload: Payload): Promise<Map<string, CourseRow>> {
  const result = await payload.find({
    collection: 'courses',
    where: { and: [{ status: { equals: 'published' } }, { isBonus: { not_equals: true } }] },
    limit: 500,
    depth: 0,
    pagination: false,
    overrideAccess: true,
    select: { slug: true, categories: true } as never,
  })
  const map = new Map<string, CourseRow>()
  for (const doc of result.docs as unknown as CourseRow[]) if (doc.slug) map.set(doc.slug, doc)
  return map
}

/** 128 random bits, URL-safe (22 characters). Unguessable, with no personal data in it. */
export function generatePublicId(): string {
  return crypto.randomBytes(16).toString('base64url')
}

/** The lead fields for a quiz result: profile, context answers and the best open programme. */
export function quizLeadData(evaluated: EvaluatedQuiz, topOpenCourseId: number | null): Record<string, unknown> {
  const { result, answers, context } = evaluated
  return {
    quizVersion: result.quizVersion,
    quizAnswers: answers,
    quizScores: result.scores.map(({ career, percent }) => ({ career, percent })),
    traits: result.traits,
    topMatch: result.topMatch,
    topOpenMatch: topOpenCourseId,
    currentStatus: context.currentStatus,
    device: context.device,
    weeklyHours: context.weeklyHours,
  }
}

export interface SavedQuiz {
  publicId: string
  topOpen: { career: CareerId; courseId: number; slug: string } | null
}

/** The best open career and its course, from the published catalogue. */
export function resolveTopOpen(result: QuizResult, programmes: Map<string, CourseRow>): SavedQuiz['topOpen'] {
  const open = topOpenMatch(result.scores, new Set(programmes.keys()))
  if (!open) return null
  const slug = careers[open.career].programmeSlug!
  const course = programmes.get(slug)
  return course ? { career: open.career, courseId: course.id, slug } : null
}

export async function saveQuizResult(
  payload: Payload,
  lead: Pick<LeadDoc, 'id' | 'firstName'>,
  evaluated: EvaluatedQuiz,
  topOpen: SavedQuiz['topOpen'],
  userId: number | null,
): Promise<string> {
  const publicId = generatePublicId()
  await payload.create({
    collection: 'quiz-results' as never,
    data: {
      publicId,
      quizVersion: evaluated.result.quizVersion,
      firstName: lead.firstName,
      lead: lead.id,
      ...(userId ? { user: userId } : {}),
      topMatch: evaluated.result.topMatch,
      topOpenMatch: topOpen?.courseId ?? null,
      answers: evaluated.answers,
      tieBreaker: evaluated.tieBreaker,
      scores: evaluated.result.scores.map(({ career, percent }) => ({ career, percent })),
      traits: evaluated.result.traits,
      context: evaluated.context,
    } as never,
    depth: 0,
    overrideAccess: true,
  })
  return publicId
}

export const quizResultUrl = (publicId: string) => `${FRONTEND_URL}/quiz/result/${publicId}`
export const quizCardUrl = (publicId: string) => `${FRONTEND_URL}/quiz/result/${publicId}/card`

/**
 * Sends the result: the quiz-result email (static result card, one button) in place of the A0
 * offer email, then the usual WhatsApp offer template (sendOfferMessages, de-duplicated). Runs
 * after the lead and result are committed; a failure never blocks the quiz.
 */
export async function sendQuizMessages(payload: Payload, leadId: number, publicId: string, evaluated: EvaluatedQuiz, topOpen: SavedQuiz['topOpen']): Promise<void> {
  const lead = (await payload.findByID({ collection: 'leads', id: leadId, depth: 0, overrideAccess: true })) as unknown as LeadDoc & { emailSuppressed?: string | null }
  const key = `email_quiz:${publicId}`
  if (!hasFollowUp(lead, key) && isDeliverableEmail(lead.email) && !lead.emailSuppressed) {
    const top = evaluated.result.scores[0]!
    const programmes = new Set(topOpen ? [careers[topOpen.career].programmeSlug!] : [])
    try {
      const rendered = quizResultEmail.render({
        firstName: lead.firstName,
        topMatch: careers[top.career].name,
        matchLabel: matchLabel(top.percent),
        percent: top.percent,
        comingSoon: careerStatus(top.career, programmes) === 'waitlist',
        openProgramme: topOpen ? careers[topOpen.career].name : null,
        resultUrl: quizResultUrl(publicId),
        cardUrl: quizCardUrl(publicId),
      })
      const providerId = await sendEmail(lead.email, rendered, { tags: { track: 'A', step: 'A0-quiz' } })
      const now = new Date().toISOString()
      // Marking email_offer too means the A0 offer email isn't sent on top of the result.
      const followUpsSent = [...(lead.followUpsSent ?? []), { key, sentAt: now }, ...(hasFollowUp(lead, 'email_offer') ? [] : [{ key: 'email_offer', sentAt: now }])]
      await payload.update({ collection: 'leads', id: lead.id, data: { followUpsSent }, depth: 0, overrideAccess: true })
      const person = await loadPerson(payload, { type: 'lead', id: lead.id })
      if (person) {
        await recordMessage(payload, {
          person, channel: 'email', kind: 'transactional', track: 'A', stepId: 'A0-quiz', template: 'quiz-result',
          subjectId: `quiz:${publicId}`, cycle: 0, idempotencyKey: idempotencyKey('A', 'A0-quiz', `quiz:${publicId}`, 0), status: 'sent', sentAt: now, providerId,
        })
      }
    } catch (err) {
      logger.error({ err, leadId }, 'quiz_result_email_failed')
    }
  }
  // WhatsApp offer template (needs a programme on the lead, i.e. an open match).
  await sendOfferMessages(payload, leadId)
}

export function queueQuizMessages(payload: Payload, leadId: number, publicId: string, evaluated: EvaluatedQuiz, topOpen: SavedQuiz['topOpen']): void {
  void sendQuizMessages(payload, leadId, publicId, evaluated, topOpen).catch((err: unknown) => logger.error({ err, leadId }, 'quiz_messages_failed'))
}
