import type { Endpoint } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { AppError } from '../../types/index.js'
import { ambassadorWithdrawRateLimiter } from '../../lib/rate-limiter.js'
import { requireAmbassador } from '../../lib/ambassadors/access.js'
import { listAmbassadorPayouts, requestPayout } from '../../lib/ambassadors/payouts.js'

const requestSchema = z.object({ amountKobo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()

export const ambassadorPayoutRequestEndpoint: Endpoint = {
  path: '/ambassadors/me/payouts',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const { user, ambassador } = await requireAmbassador(req)
    await ambassadorWithdrawRateLimiter.check(req, user.id)
    const requestId = req.headers.get('idempotency-key')
    if (!requestId) throw new AppError('VALIDATION_ERROR', 'Idempotency-Key is required.', { 'Idempotency-Key': 'Send a UUID v4 Idempotency-Key header.' })
    const body = parseBody(requestSchema, await readJsonBody(req))
    const result = await requestPayout(req.payload, { ambassadorId: ambassador.id, amountKobo: body.amountKobo, requestId })
    const payout = result.payout
    return sendSuccess({
      payout: {
        id: payout.id,
        amountKobo: payout.amountKobo,
        status: payout.status,
        bankName: payout.bankName ?? '',
        accountLast4: payout.accountLast4 ?? '',
        createdAt: payout.createdAt,
      },
    }, undefined, result.created ? 201 : 200)
  }),
}

export const ambassadorPayoutListEndpoint: Endpoint = {
  path: '/ambassadors/me/payouts',
  method: 'get',
  handler: asyncHandler(async (req) => {
    const { ambassador } = await requireAmbassador(req)
    const url = new URL(req.url ?? 'http://localhost')
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20))
    const result = await listAmbassadorPayouts(req.payload, ambassador.id, page, limit)
    return sendSuccess(result.rows, { page: result.page, total: result.total })
  }),
}
