import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'
import { startAttempt, submitAttempt } from '../../lib/assessment-service.js'
import { quizStartRateLimiter } from '../../lib/rate-limiter.js'

/**
 * Legacy one-shot submit (POST /api/quizzes/:quizId/submit), kept until every client uses
 * start/answers/submit. It runs the new engine: starts an attempt, maps the original option indexes
 * onto the order served, then submits it, so scoring and attempt rules are the same.
 */
const schema = z.object({ answers: z.array(z.object({ questionId: z.number().int().positive(), optionIndex: z.number().int().min(0) })).min(1) })

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  await quizStartRateLimiter.check(req, user.id)
  const quizId = getParam(req, 'quizId')
  if (!isValidPayloadId(quizId)) throw new AppError('VALIDATION_ERROR', 'Invalid quiz id')
  const { answers } = parseBody(schema, await readJsonBody(req))
  const started = await startAttempt(req.payload, user.id, quizId)
  const attempt = await req.payload.findByID({ collection: 'quiz-attempts', id: started.attemptId, depth: 0, overrideAccess: true }) as unknown as { servedOptionOrder?: Record<string, number[]> | null }
  const orders = attempt.servedOptionOrder ?? {}
  const mapped: Record<string, number[]> = {}
  for (const answer of answers) {
    const order = orders[String(answer.questionId)]
    const shown = order ? order.indexOf(answer.optionIndex) : answer.optionIndex
    if (shown >= 0) mapped[String(answer.questionId)] = [shown]
  }
  const result = await submitAttempt(req.payload, user.id, started.attemptId, mapped)
  return sendSuccess({ id: result.attemptId, score: result.score, passed: result.passed }, undefined, 201)
}

export const quizSubmitEndpoint: Endpoint = { path: '/quizzes/:quizId/submit', method: 'post', handler: asyncHandler(handler) }
