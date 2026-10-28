import type { Payload } from 'payload'
import { z } from 'zod'
import { parseBody } from '../../middleware/validate.js'
import { AppError } from '../../types/index.js'
import { logger } from '../../lib/logger.js'
import { recordCommissionForOrder } from '../../lib/ambassadors/commissions.js'
import { handleInvoiceRefund, handleOrderRefund } from '../../lib/ambassadors/refunds.js'
import type { PaystackRefundProcessedData } from '../../types/paystack.js'

const schema = z.object({ status: z.literal('processed'), transaction_reference: z.string().min(1).max(200), refund_reference: z.string().regex(/^[A-Za-z0-9_:.-]{1,120}$/).nullish(), id: z.number().int().positive().optional(), amount: z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number).refine(v => Number.isSafeInteger(v) && v > 0), currency: z.literal('NGN') })
export async function handleAmbassadorRefund(payload: Payload, raw: PaystackRefundProcessedData): Promise<void> {
  const data = parseBody(schema, raw)
  // Sample shape only: provider customer objects, notes and addresses must never enter logs.
  logger.info({ status: data.status, amountType: typeof raw.amount, hasRefundReference: Boolean(data.refund_reference), hasRefundId: Boolean(data.id) }, 'ambassador_refund_payload_shape')
  const refundKey = data.id ? String(data.id) : data.refund_reference
  if (!refundKey) throw new AppError('VALIDATION_ERROR', 'Processed refund is missing a stable refund identifier')
  const found = await payload.find({ collection: 'orders', where: { reference: { equals: data.transaction_reference } }, limit: 1, depth: 0, overrideAccess: true })
  const order = found.docs[0]
  if (order) {
    // A refund can race the non-blocking commission hook; recover it before applying the refund.
    await recordCommissionForOrder(payload, Number(order.id))
    await handleOrderRefund(payload, { orderId: Number(order.id), refundedKobo: Number(data.amount), refundKey: String(refundKey) })
  } else await handleInvoiceRefund(payload, { transactionReference: data.transaction_reference, refundedKobo: Number(data.amount), refundKey: String(refundKey) })
}
