import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { quizSaveRateLimiter, quizStartRateLimiter } from '../../lib/rate-limiter.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'
import { courseAssessments, saveAnswers, startAttempt, submitAttempt } from '../../lib/assessment-service.js'

const answersSchema = z.object({ answers: z.record(z.string().regex(/^\d+$/), z.union([z.array(z.number().int().min(0)), z.number().int().min(0)])).default({}) })
const submitSchema = z.object({ answers: z.record(z.string().regex(/^\d+$/), z.union([z.array(z.number().int().min(0)), z.number().int().min(0)])).optional() })

function idParam(req: PayloadRequest, name: string): string {
  const value = getParam(req, name)
  if (!isValidPayloadId(value)) throw new AppError('VALIDATION_ERROR', 'Invalid id')
  return value
}

/** POST /api/quizzes/:id/start: starts (or resumes) an attempt; questions come without answers. */
export const startQuizEndpoint: Endpoint = {
  path: '/:id/start',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const user = await requireAuth(req)
    await quizStartRateLimiter.check(req, user.id)
    return sendSuccess(await startAttempt(req.payload, user.id, idParam(req, 'id')), undefined, 201)
  }),
}

/** PUT /api/quiz-attempts/:id/answers: autosave. */
export const saveAnswersEndpoint: Endpoint = {
  path: '/:id/answers',
  method: 'put',
  handler: asyncHandler(async (req) => {
    const user = await requireAuth(req)
    await quizSaveRateLimiter.check(req, user.id)
    const body = parseBody(answersSchema, await readJsonBody(req))
    return sendSuccess(await saveAnswers(req.payload, user.id, idParam(req, 'id'), body.answers ?? {}))
  }),
}

/** POST /api/quiz-attempts/:id/submit: scores on the server (idempotent). */
export const submitAttemptEndpoint: Endpoint = {
  path: '/:id/submit',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const user = await requireAuth(req)
    await quizStartRateLimiter.check(req, user.id)
    const body = parseBody(submitSchema, await readJsonBody(req).catch(() => ({})))
    return sendSuccess(await submitAttempt(req.payload, user.id, idParam(req, 'id'), body.answers))
  }),
}

/** GET /api/courses/:id/assessments: the learner's quizzes and exam status for a programme. */
export const courseAssessmentsEndpoint: Endpoint = {
  path: '/:id/assessments',
  method: 'get',
  handler: asyncHandler(async (req) => {
    const user = await requireAuth(req)
    return sendSuccess(await courseAssessments(req.payload, user.id, idParam(req, 'id')))
  }),
}
