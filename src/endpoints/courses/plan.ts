import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { planReadRateLimiter, planWriteRateLimiter } from '../../lib/rate-limiter.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'
import { adminResetPlan, assertGuidedPlanEnabled, getCoursePlan, getMyPlans, resetPlan, setPace } from '../../lib/guided-plan-service.js'

/** Guided 12-week plan endpoints (src/lib/guided-plan-service.ts). Guidance only: nothing is locked. */

const paceSchema = z.object({ pace: z.enum(['guided', 'self_paced']) }).strict()

function idParam(req: PayloadRequest, name: string): number {
  const value = getParam(req, name)
  if (!isValidPayloadId(value)) throw new AppError('VALIDATION_ERROR', 'Invalid id')
  return Number(value)
}

/** GET /api/courses/:id/plan: the learner's plan for a programme, with their progress. */
export const coursePlanEndpoint: Endpoint = {
  path: '/:id/plan',
  method: 'get',
  handler: asyncHandler(async (req) => {
    assertGuidedPlanEnabled()
    const user = await requireAuth(req)
    await planReadRateLimiter.check(req, user.id)
    return sendSuccess(await getCoursePlan(req.payload, user, idParam(req, 'id')))
  }),
}

/** PATCH /api/courses/:id/plan { pace }: guided or self-paced. */
export const coursePlanPaceEndpoint: Endpoint = {
  path: '/:id/plan',
  method: 'patch',
  handler: asyncHandler(async (req) => {
    assertGuidedPlanEnabled()
    const user = await requireAuth(req)
    await planWriteRateLimiter.check(req, user.id)
    const body = parseBody(paceSchema, await readJsonBody(req))
    return sendSuccess(await setPace(req.payload, user, idParam(req, 'id'), body.pace))
  }),
}

/** POST /api/courses/:id/plan/reset: "Move my plan" (once every 14 days, learners who are behind). */
export const coursePlanResetEndpoint: Endpoint = {
  path: '/:id/plan/reset',
  method: 'post',
  handler: asyncHandler(async (req) => {
    assertGuidedPlanEnabled()
    const user = await requireAuth(req)
    await planWriteRateLimiter.check(req, user.id)
    return sendSuccess(await resetPlan(req.payload, user, idParam(req, 'id')))
  }),
}

/** GET /api/plans/me: a summary per active programme, for the dashboard (moved onto the plans collection). */
export const myPlansEndpoint: Endpoint = {
  path: '/plans/me',
  method: 'get',
  handler: asyncHandler(async (req) => {
    assertGuidedPlanEnabled()
    const user = await requireAuth(req)
    await planReadRateLimiter.check(req, user.id)
    return sendSuccess({ plans: await getMyPlans(req.payload, user.id) })
  }),
}

/** POST /api/studio/enrollments/:id/plan-reset: Learner 360 "Reset plan" (admins, no cooldown). */
export const studioPlanResetEndpoint: Endpoint = {
  path: '/studio/enrollments/:id/plan-reset',
  method: 'post',
  handler: asyncHandler(async (req) => {
    if (req.user?.role !== 'admin') throw new AppError('INSUFFICIENT_PERMISSION', 'Admins only')
    assertGuidedPlanEnabled()
    return sendSuccess(await adminResetPlan(req.payload, idParam(req, 'id')))
  }),
}
