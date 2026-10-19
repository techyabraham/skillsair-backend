import type { Endpoint, PayloadRequest, Where } from 'payload'
import { asyncHandler, sendSuccess } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { paymentRateLimiter } from '../../lib/rate-limiter.js'
import { subscriptionManageLink } from '../../lib/paystack.js'
import { relationId } from '../../lib/leads.js'
import { logger } from '../../lib/logger.js'
import { AppError } from '../../types/index.js'
import { isValidPayloadId } from '../../utils/sanitize.js'

interface SubscriptionRow {
  id: number
  status: 'active' | 'past_due' | 'cancelled' | 'expired'
  course: unknown
  paystackSubscriptionCode?: string | null
  updatedAt?: string
}

/**
 * GET /api/billing/update-card[?subscription=<id>]: where "Update my card" should go.
 *
 * - A renewal that failed (past_due) or a plan that has lapsed: Paystack doesn't retry failed
 *   renewals, so changing the card alone wouldn't pay for this month. The learner goes to
 *   checkout for the same programme, where their locked ₦2,000-a-month rate applies; the old
 *   subscription is switched off once the new one is paid.
 * - An active (or cancelled-but-running) plan: Paystack's hosted page to change the card
 *   before the next charge (for the upcoming-charge and expiring-card emails).
 * Returns { url, mode } for the website's /billing/update-card route to redirect to.
 */
async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  await paymentRateLimiter.check(req, user.id)
  const requested = new URL(req.url ?? '', 'http://localhost').searchParams.get('subscription')

  const where: Where = requested && isValidPayloadId(requested)
    ? { and: [{ user: { equals: user.id } }, { id: { equals: requested } }] }
    : { and: [{ user: { equals: user.id } }, { status: { in: ['past_due', 'active', 'cancelled', 'expired'] } }] }
  const found = await req.payload.find({ collection: 'subscriptions', where, sort: '-updatedAt', limit: 20, depth: 0, overrideAccess: true })
  const rows = found.docs as unknown as SubscriptionRow[]
  const priority: SubscriptionRow['status'][] = ['past_due', 'active', 'cancelled', 'expired']
  const subscription = [...rows].sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0]
  if (!subscription) throw new AppError('NOT_FOUND', 'No subscription found')

  if (subscription.status === 'past_due' || subscription.status === 'expired') {
    const courseId = relationId(subscription.course)
    const course = courseId ? await req.payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true }).catch(() => null) : null
    if (!course?.slug) throw new AppError('NOT_FOUND', 'Programme not found')
    return sendSuccess({ url: `/checkout?course=${encodeURIComponent(String(course.slug))}`, mode: 'restart' })
  }

  if (!subscription.paystackSubscriptionCode) throw new AppError('VALIDATION_ERROR', 'Your plan is still being confirmed by Paystack. Please try again in a few minutes.')
  try {
    const url = await subscriptionManageLink(subscription.paystackSubscriptionCode)
    return sendSuccess({ url, mode: 'manage' })
  } catch (err) {
    logger.error({ err, subscriptionId: subscription.id }, 'paystack_manage_link_failed')
    throw new AppError('INTERNAL_ERROR', "We couldn't open the card update page just now.")
  }
}

export const updateCardEndpoint: Endpoint = { path: '/billing/update-card', method: 'get', handler: asyncHandler(handler) }
