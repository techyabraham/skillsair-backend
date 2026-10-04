import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { requireAdmin } from '../../middleware/authorize.js'
import { adminRateLimiter } from '../../lib/rate-limiter.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { resolveExtensionBaseDate, addDays } from '../../utils/date-helpers.js'
import { accessExtendedEmail, sendEmail } from '../../lib/resend.js'
import { AppError } from '../../types/index.js'
import { logger } from '../../lib/logger.js'

const extendAccessSchema = z.object({
  studentId: z.string().min(1),
  daysAdded: z.number().int().min(1).max(3650),
  reason: z.string().min(3).max(500),
  courseId: z.string().optional(),
})

interface UserDoc {
  id: number
  email: string
  firstName: string
  accessExpiresAt: string | null | undefined
  accessExtensions: Array<Record<string, unknown>> | null | undefined
}

async function handler(req: PayloadRequest): Promise<Response> {
  const admin = await requireAdmin(req)
  await adminRateLimiter.check(req, admin.id)
  const body = parseBody(extendAccessSchema, await readJsonBody(req))
  if (!isValidPayloadId(body.studentId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid student id')
  }
  if (body.courseId && !isValidPayloadId(body.courseId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid course id')
  }

  const payload = req.payload
  const student = (await payload
    .findByID({ collection: 'users', id: body.studentId, depth: 0 })
    .catch(() => null)) as unknown as UserDoc | null
  if (!student) {
    throw new AppError('NOT_FOUND', 'Student not found')
  }

  let previousExpiryDate = student.accessExpiresAt ?? null
  if (body.courseId) {
    const prior = await payload.find({ collection: 'access-extensions', where: { and: [{ student: { equals: student.id } }, { course: { equals: body.courseId } }] }, sort: '-newExpiryDate', limit: 1, overrideAccess: true })
    const enrollments = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: student.id } }, { course: { equals: body.courseId } }] }, limit: 1, overrideAccess: true })
    if (!enrollments.totalDocs) throw new AppError('NOT_FOUND', 'Student is not enrolled in this course')
    const subscriptionValue = enrollments.docs[0]?.subscription
    const subscriptionId = typeof subscriptionValue === 'object' && subscriptionValue ? subscriptionValue.id : subscriptionValue
    const subscription = subscriptionId ? await payload.findByID({ collection: 'subscriptions', id: subscriptionId, depth: 0, overrideAccess: true }).catch(() => null) : null
    previousExpiryDate = prior.docs[0]?.newExpiryDate ?? subscription?.currentPeriodEnd ?? student.accessExpiresAt ?? null
  }
  const baseDate = resolveExtensionBaseDate(previousExpiryDate)
  const newExpiryDate = addDays(baseDate, body.daysAdded)

  const extensionRecord = {
    extendedAt: new Date().toISOString(),
    extendedBy: admin.id,
    daysAdded: body.daysAdded,
    reason: body.reason,
    newExpiryDate: newExpiryDate.toISOString(),
  }

  if (!body.courseId) {
    await payload.update({
      collection: 'users', id: student.id,
      data: { accessExpiresAt: newExpiryDate.toISOString(), accessExtensions: [...(student.accessExtensions ?? []), extensionRecord] },
      overrideAccess: true,
    })
  }

  const logEntry = await payload.create({
    collection: 'access-extensions',
    data: {
      student: student.id,
      course: body.courseId,
      extendedBy: admin.id,
      daysAdded: body.daysAdded,
      reason: body.reason,
      previousExpiryDate,
      newExpiryDate: newExpiryDate.toISOString(),
    },
    overrideAccess: true,
  })

  try {
    await sendEmail(
      student.email,
      accessExtendedEmail(
        student.firstName,
        newExpiryDate.toLocaleDateString('en-GB'),
        body.daysAdded,
        body.reason,
      ),
    )
  } catch (err) {
    logger.error({ err, studentId: student.id }, 'access_extended_email_failed')
  }

  return sendSuccess(logEntry, undefined, 201)
}

export const extendAccessEndpoint: Endpoint = {
  path: '/admin/extend-access',
  method: 'post',
  handler: asyncHandler(handler),
}
