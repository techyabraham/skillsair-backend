import type { Payload } from 'payload'
import { relationId } from './course-access.js'
import { logger } from './logger.js'

/**
 * "Complete payment" on a pending order starts a fresh payment for the same item (current price,
 * rules and payment method). Once that payment is open, the old pending order is closed so the
 * learner's history doesn't fill up with duplicates. Only the learner's own pending order for the
 * same item is touched. If money for the old reference still arrives later (a slow transfer),
 * the webhook fulfils it anyway, so nobody loses a payment.
 */
export async function closeReplacedOrder(
  payload: Payload,
  input: { userId: number; replacesOrderId: number | string | undefined; newOrderId: number | string; type: string; courseId: number | undefined },
): Promise<void> {
  if (!input.replacesOrderId) return
  try {
    const old = (await payload.findByID({ collection: 'orders', id: input.replacesOrderId, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as {
      id: number
      user: unknown
      course?: unknown
      type: string
      status: string
      metadata?: Record<string, unknown> | null
    } | null
    if (!old || old.status !== 'pending' || String(old.id) === String(input.newOrderId)) return
    if (String(relationId(old.user)) !== String(input.userId)) return
    if (old.type !== input.type || String(relationId(old.course) ?? '') !== String(input.courseId ?? '')) return
    await payload.update({
      collection: 'orders',
      id: old.id,
      data: { status: 'failed', metadata: { ...(old.metadata ?? {}), replacedBy: Number(input.newOrderId) } },
      overrideAccess: true,
    })
  } catch (err) {
    logger.warn({ err, replacesOrderId: input.replacesOrderId }, 'order_replace_failed')
  }
}
