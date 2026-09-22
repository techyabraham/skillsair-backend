import type { Endpoint, PayloadRequest } from 'payload'
import { sendSuccess, asyncHandler, getParam } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { verifyTransaction } from '../../lib/paystack.js'
import { AppError } from '../../types/index.js'

interface OrderDoc {
  id: number
  status: 'pending' | 'success' | 'failed' | 'refunded'
  user: number | string | { id: number | string }
}

function relationId(value: unknown): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return (value as { id: number | string }).id
  }
  return value as number | string
}

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const reference = getParam(req, 'reference')

  const payload = req.payload
  const orders = await payload.find({
    collection: 'orders',
    where: { reference: { equals: reference } },
    limit: 1,
  })
  const order = orders.docs[0] as unknown as OrderDoc | undefined
  if (!order) {
    throw new AppError('NOT_FOUND', 'Order not found')
  }
  if (relationId(order.user) !== user.id && user.role !== 'admin') {
    throw new AppError('INSUFFICIENT_PERMISSION', 'You cannot view this order')
  }

  if (order.status === 'success') {
    return sendSuccess({ status: 'success', order })
  }

  const verification = await verifyTransaction(reference)
  if (verification.data.status === 'success') {
    const updated = await payload.update({
      collection: 'orders',
      id: order.id,
      data: {
        status: 'success',
        paystackTransactionId: String(verification.data.id),
        paidAt: verification.data.paid_at ?? new Date().toISOString(),
      },
      overrideAccess: true,
    })
    return sendSuccess({ status: 'success', order: updated })
  }

  if (verification.data.status === 'failed' && order.status !== 'failed') {
    await payload.update({
      collection: 'orders',
      id: order.id,
      data: { status: 'failed' },
      overrideAccess: true,
    })
  }

  return sendSuccess({ status: verification.data.status, order })
}

export const verifyPaymentEndpoint: Endpoint = {
  path: '/payments/verify/:reference',
  method: 'get',
  handler: asyncHandler(handler),
}
