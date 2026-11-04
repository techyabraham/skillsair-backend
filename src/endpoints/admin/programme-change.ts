import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { requireAdmin } from '../../lib/ambassadors/access.js'
import { manualEnrolRateLimiter } from '../../lib/rate-limiter.js'
import { PROGRAMME_CHANGE_BATCH_MAX, changeProgramme } from '../../lib/programme-change.js'

/** Emails stay plain strings here: a bad one is reported on its own line, not by failing the batch. */
const programmeChangeSchema = z.object({
  fromCourseId: z.number().int().positive(),
  toCourseId: z.number().int().positive(),
  emails: z.array(z.string().max(320)).min(1).max(PROGRAMME_CHANGE_BATCH_MAX),
  note: z.string().trim().max(200).optional(),
})

async function handler(req: PayloadRequest): Promise<Response> {
  const admin = await requireAdmin(req)
  await manualEnrolRateLimiter.check(req, admin.id)
  const body = parseBody(programmeChangeSchema, await readJsonBody(req))
  const results = await changeProgramme(req.payload, { ...body, note: body.note || undefined, adminId: admin.id })
  return sendSuccess({ results })
}

/** POST /api/studio/programme-change: Enrol learners → Change programme (see src/lib/programme-change.ts). */
export const programmeChangeEndpoint: Endpoint = {
  path: '/studio/programme-change',
  method: 'post',
  handler: asyncHandler(handler),
}
