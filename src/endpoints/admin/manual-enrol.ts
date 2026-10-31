import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { requireAdmin } from '../../lib/ambassadors/access.js'
import { manualEnrolRateLimiter } from '../../lib/rate-limiter.js'
import { MANUAL_ENROL_BATCH_MAX, manualEnrol } from '../../lib/manual-enrolment.js'

/** Emails stay plain strings here: a bad one is reported on its own line, not by failing the batch. */
const manualEnrolSchema = z.object({
  courseId: z.number().int().positive(),
  emails: z.array(z.string().max(320)).min(1).max(MANUAL_ENROL_BATCH_MAX),
  duration: z.discriminatedUnion('unit', [
    z.object({ unit: z.literal('months'), amount: z.number().int().min(1).max(60) }),
    z.object({ unit: z.literal('days'), amount: z.number().int().min(1).max(1825) }),
  ]),
  note: z.string().trim().max(200).optional(),
  notify: z.boolean().optional().default(true),
})

async function handler(req: PayloadRequest): Promise<Response> {
  const admin = await requireAdmin(req)
  await manualEnrolRateLimiter.check(req, admin.id)
  const body = parseBody(manualEnrolSchema, await readJsonBody(req))
  const results = await manualEnrol(req.payload, { ...body, note: body.note || undefined, notify: body.notify ?? true, adminId: admin.id })
  return sendSuccess({ results })
}

/** POST /api/studio/manual-enrolment: the Enrol learners screen (see src/lib/manual-enrolment.ts). */
export const manualEnrolEndpoint: Endpoint = {
  path: '/studio/manual-enrolment',
  method: 'post',
  handler: asyncHandler(handler),
}
