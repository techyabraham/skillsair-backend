import type { CollectionAfterChangeHook } from 'payload'
import { paymentConfirmationEmail, sendEmail } from '../../lib/resend.js'
import { logger } from '../../lib/logger.js'
import { addDays } from '../../utils/date-helpers.js'
import { issueCertificate } from '../courses/afterComplete.js'

interface UserDoc {
  email: string
  firstName: string
}

interface CourseDoc {
  title: string
}

interface PlanDoc {
  name: string
  interval: 'monthly' | 'annually'
}

function relationId(value: unknown): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return (value as { id: number | string }).id
  }
  return value as number | string
}

export const afterPayment: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update') return doc
  if (doc.status !== 'success' || previousDoc?.status === 'success') return doc

  try {
    const userId = relationId(doc.user)
    if (userId === undefined) return doc
    const user = (await req.payload.findByID({
      collection: 'users',
      id: userId,
      depth: 0,
    })) as unknown as UserDoc

    let itemDescription = 'your purchase'

    if (doc.type === 'course') {
      const courseId = relationId(doc.course)
      if (courseId !== undefined) {
        const course = (await req.payload.findByID({
          collection: 'courses',
          id: courseId,
          depth: 0,
        })) as unknown as CourseDoc
        itemDescription = course.title

        const existing = await req.payload.find({
          collection: 'enrollments',
          where: {
            and: [{ student: { equals: userId } }, { course: { equals: courseId } }],
          },
          limit: 1,
        })
        if (existing.totalDocs === 0) {
          await req.payload.create({
            collection: 'enrollments',
            data: {
              student: userId,
              course: courseId,
              status: 'active',
              orderId: typeof doc.reference === 'string' ? doc.reference : '',
            },
            overrideAccess: true,
          })
        }
      }
    } else if (doc.type === 'subscription') {
      const planId = relationId(doc.plan)
      if (planId !== undefined) {
        const plan = (await req.payload.findByID({
          collection: 'plans',
          id: planId,
          depth: 0,
        })) as unknown as PlanDoc
        itemDescription = `the ${plan.name} subscription`

        const periodDays = plan.interval === 'annually' ? 365 : 30
        const now = new Date()
        const periodEnd = addDays(now, periodDays)
        await req.payload.create({
          collection: 'subscriptions',
          data: {
            user: userId,
            plan: planId,
            status: 'active',
            currentPeriodStart: now.toISOString(),
            currentPeriodEnd: periodEnd.toISOString(),
          },
          overrideAccess: true,
        })
      }
    } else if (doc.type === 'certificate') {
      const courseId = relationId(doc.course)
      if (courseId !== undefined) {
        const course = (await req.payload.findByID({
          collection: 'courses',
          id: courseId,
          depth: 0,
        })) as unknown as CourseDoc
        itemDescription = `your certificate for ${course.title}`
        await issueCertificate(req.payload, userId, courseId)
      }
    }

    const amountFormatted = `₦${(doc.amount as number).toLocaleString('en-NG')}`
    const reference = typeof doc.reference === 'string' ? doc.reference : ''
    await sendEmail(user.email, paymentConfirmationEmail(user.firstName, reference, amountFormatted, itemDescription))
  } catch (err) {
    logger.error({ err, orderId: doc.id }, 'order_after_payment_failed')
  }
  return doc
}
