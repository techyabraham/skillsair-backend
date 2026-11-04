import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { requireAdmin } from '../../lib/ambassadors/access.js'
import { manualEnrolRateLimiter } from '../../lib/rate-limiter.js'
import { MANUAL_ENROL_BATCH_MAX, manualEnrol } from '../../lib/manual-enrolment.js'

const courseIds = z.array(z.number().int().positive()).max(20)

/**
 * Emails stay plain strings here: a bad one is reported on its own line, not by failing the batch.
 * `entries` gives each learner their own programmes; the older `courseId` + `emails` form (one
 * programme for everyone) still works.
 */
export const manualEnrolSchema = z
  .object({
    entries: z.array(z.object({ email: z.string().max(320), courseIds })).min(1).max(MANUAL_ENROL_BATCH_MAX).optional(),
    courseId: z.number().int().positive().optional(),
    emails: z.array(z.string().max(320)).min(1).max(MANUAL_ENROL_BATCH_MAX).optional(),
    duration: z.discriminatedUnion('unit', [
      z.object({ unit: z.literal('months'), amount: z.number().int().min(1).max(60) }),
      z.object({ unit: z.literal('days'), amount: z.number().int().min(1).max(1825) }),
    ]),
    note: z.string().trim().max(200).optional(),
    notify: z.boolean().optional().default(true),
  })
  .refine((body) => Boolean(body.entries ?? (body.courseId && body.emails)), { message: 'Add at least one learner', path: ['entries'] })
  .refine((body) => (body.entries ?? []).reduce((sum, entry) => sum + Math.max(1, entry.courseIds.length), 0) <= MANUAL_ENROL_BATCH_MAX, {
    message: `At most ${MANUAL_ENROL_BATCH_MAX} learner-programme pairs per request`,
    path: ['entries'],
  })

async function handler(req: PayloadRequest): Promise<Response> {
  const admin = await requireAdmin(req)
  await manualEnrolRateLimiter.check(req, admin.id)
  const { entries, courseId, emails, ...body } = parseBody(manualEnrolSchema, await readJsonBody(req))
  const results = await manualEnrol(req.payload, {
    ...body,
    entries: entries ?? (emails ?? []).map((email) => ({ email, courseIds: [courseId!] })),
    note: body.note || undefined,
    notify: body.notify ?? true,
    adminId: admin.id,
  })
  return sendSuccess({ results })
}

/** POST /api/studio/manual-enrolment: the Enrol learners screen (see src/lib/manual-enrolment.ts). */
export const manualEnrolEndpoint: Endpoint = {
  path: '/studio/manual-enrolment',
  method: 'post',
  handler: asyncHandler(handler),
}
