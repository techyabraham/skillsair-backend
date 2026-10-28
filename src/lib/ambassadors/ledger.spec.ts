import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { AMBASSADOR_TABLES, describeWithDb, getTestPayload, truncate } from '../../test/payload-harness.js'
import { createTestAmbassador, createTestOrder } from '../../test/ambassador-fixtures.js'
import { resetFakeRedis } from '../../test/fake-redis.js'
import { withLock } from '../locks.js'
import type { AmbassadorDoc } from './types.js'
import {
  LedgerError,
  approveDueCommissions,
  getWallet,
  insertLedgerEntry,
  markPayoutPaid,
  recordAdjustment,
  recordReversal,
  reservePayout,
  transitionLedgerEntry,
  voidPayout,
  voidPendingCommission,
  withTransaction,
  type Wallet,
} from './ledger.js'

const DAY = 24 * 60 * 60 * 1000

describeWithDb('ambassador ledger', () => {
  let payload: Payload
  let ambassador: AmbassadorDoc
  let orderSeq = 0

  beforeAll(async () => {
    payload = await getTestPayload()
  })

  beforeEach(async () => {
    await truncate(payload, [...AMBASSADOR_TABLES, 'orders', 'users'])
    resetFakeRedis()
    ambassador = await createTestAmbassador(payload)
  })

  async function createPayout(amountKobo: number, ambassadorId = ambassador.id): Promise<number> {
    const doc = await payload.create({ collection: 'ambassador-payouts', data: { ambassador: ambassadorId, amountKobo, status: 'requested' }, overrideAccess: true })
    return Number(doc.id)
  }

  async function commission(amountKobo: number, opts: { availableAt?: Date; ambassadorId?: number; status?: 'pending' | 'approved' } = {}) {
    orderSeq += 1
    const { entry } = await insertLedgerEntry(payload, {
      ambassadorId: opts.ambassadorId ?? ambassador.id,
      type: 'commission',
      status: opts.status ?? 'pending',
      amountKobo,
      saleKobo: amountKobo * 2,
      rateBps: 5000,
      productType: 'course',
      availableAt: opts.availableAt ?? new Date(Date.now() + 7 * DAY),
      idempotencyKey: `commission:order:${orderSeq}`,
    })
    return entry
  }

  describe('insertLedgerEntry', () => {
    it('the same key twice: one row, and the second call returns created: false', async () => {
      const entry = {
        ambassadorId: ambassador.id,
        type: 'commission' as const,
        status: 'pending' as const,
        amountKobo: 12_500,
        saleKobo: 25_000,
        rateBps: 5000,
        idempotencyKey: 'commission:order:900',
      }
      const first = await insertLedgerEntry(payload, entry)
      const second = await insertLedgerEntry(payload, entry)
      expect(first.created).toBe(true)
      expect(second.created).toBe(false)
      expect(second.entry.id).toBe(first.entry.id)
      const { totalDocs } = await payload.count({ collection: 'ambassador-ledger', where: { idempotencyKey: { equals: 'commission:order:900' } }, overrideAccess: true })
      expect(totalDocs).toBe(1)
    })

    it('stores integers and copies the rate onto the row', async () => {
      const row = await commission(1_250_000)
      expect(row.amountKobo).toBe(1_250_000)
      expect(row.saleKobo).toBe(2_500_000)
      expect(row.rateBps).toBe(5000)
      expect(row.status).toBe('pending')
    })

    it.each([
      ['commission with a negative amount', { type: 'commission', status: 'pending', amountKobo: -1, idempotencyKey: 'commission:order:1' }],
      ['commission of zero', { type: 'commission', status: 'pending', amountKobo: 0, idempotencyKey: 'commission:order:1' }],
      ['reversal with a positive amount', { type: 'reversal', status: 'approved', amountKobo: 100, idempotencyKey: 'reversal:order:1:rf_1' }],
      ['payout with a positive amount', { type: 'payout', status: 'reserved', amountKobo: 100, idempotencyKey: 'payout:1' }],
      ['adjustment of zero', { type: 'adjustment', status: 'approved', amountKobo: 0, note: 'A long enough note', idempotencyKey: 'adjustment:3b241101-e2bb-4255-8caf-4136c566a962' }],
      ['commission created as void', { type: 'commission', status: 'void', amountKobo: 1, idempotencyKey: 'commission:order:1' }],
      ['reversal created as pending', { type: 'reversal', status: 'pending', amountKobo: -1, idempotencyKey: 'reversal:order:1:rf_1' }],
      ['fractional kobo', { type: 'commission', status: 'pending', amountKobo: 1.5, idempotencyKey: 'commission:order:1' }],
      ['a key in the wrong format', { type: 'commission', status: 'pending', amountKobo: 1, idempotencyKey: 'order-1' }],
      ['a payout key on a commission', { type: 'commission', status: 'pending', amountKobo: 1, idempotencyKey: 'payout:1' }],
    ] as const)('refuses a %s', async (_label, partial) => {
      await expect(insertLedgerEntry(payload, { ambassadorId: ambassador.id, ...partial })).rejects.toBeInstanceOf(LedgerError)
    })
  })

  describe('wallet', () => {
    // Each step acts on the state the previous steps left, then checks the figures that changed.
    const steps: Array<{ name: string; act: (ctx: Record<string, number>) => Promise<void>; expect: Partial<Wallet> }> = [
      {
        name: 'a) +12500 pending',
        act: async (ctx) => { ctx.c1 = (await commission(12_500)).id },
        expect: { pendingKobo: 12_500, availableKobo: 0, totalEarnedKobo: 12_500, inFlightKobo: 0, paidOutKobo: 0 },
      },
      {
        name: 'b) approve it',
        act: async (ctx) => { await transitionLedgerEntry(payload, ctx.c1!, 'approved') },
        expect: { pendingKobo: 0, availableKobo: 12_500, totalEarnedKobo: 12_500 },
      },
      {
        name: 'c) reserve payout 10000',
        act: async (ctx) => { ctx.p1 = await createPayout(10_000); await reservePayout(payload, { ambassadorId: ambassador.id, payoutId: ctx.p1, amountKobo: 10_000 }) },
        expect: { availableKobo: 2_500, inFlightKobo: 10_000, paidOutKobo: 0 },
      },
      {
        name: 'd) mark payout paid',
        act: async (ctx) => { await markPayoutPaid(payload, ctx.p1!) },
        expect: { availableKobo: 2_500, inFlightKobo: 0, paidOutKobo: 10_000 },
      },
      {
        name: 'e) reversal -12500 (refund after payout)',
        act: async () => {
          const order = await createTestOrder(payload)
          await recordReversal(payload, { ambassadorId: ambassador.id, orderId: order.id, amountKobo: -12_500, key: `reversal:order:${order.id}:rf_1` })
        },
        expect: { availableKobo: -10_000, totalEarnedKobo: 0, paidOutKobo: 10_000 },
      },
      {
        name: 'f) new +25000 commission approved',
        act: async () => { const row = await commission(25_000); await transitionLedgerEntry(payload, row.id, 'approved') },
        expect: { availableKobo: 15_000, pendingKobo: 0, totalEarnedKobo: 25_000 },
      },
      {
        name: 'g) reserve 5000 then void it',
        act: async () => {
          const payoutId = await createPayout(5_000)
          await reservePayout(payload, { ambassadorId: ambassador.id, payoutId, amountKobo: 5_000 })
          expect((await getWallet(payload, ambassador.id)).inFlightKobo).toBe(5_000)
          await voidPayout(payload, payoutId)
        },
        expect: { availableKobo: 15_000, inFlightKobo: 0, paidOutKobo: 10_000 },
      },
    ]

    it('follows the scenario table step by step', async () => {
      const ctx: Record<string, number> = {}
      for (const step of steps) {
        await step.act(ctx)
        expect(await getWallet(payload, ambassador.id), step.name).toMatchObject(step.expect)
      }
    })

    it('is all zeros for an ambassador with no rows, and only counts their own rows', async () => {
      const other = await createTestAmbassador(payload)
      await commission(5_000, { ambassadorId: other.id })
      expect(await getWallet(payload, ambassador.id)).toEqual({ pendingKobo: 0, availableKobo: 0, inFlightKobo: 0, paidOutKobo: 0, totalEarnedKobo: 0 })
    })

    it('counts approved adjustments, positive and negative', async () => {
      await recordAdjustment(payload, { ambassadorId: ambassador.id, amountKobo: 3_000, note: 'Bonus for the launch week', createdBy: 1 })
      await recordAdjustment(payload, { ambassadorId: ambassador.id, amountKobo: -1_000, note: 'Duplicate commission corrected', createdBy: 1 })
      expect(await getWallet(payload, ambassador.id)).toMatchObject({ availableKobo: 2_000, totalEarnedKobo: 2_000 })
    })
  })

  describe('status transitions', () => {
    it('refuses approved -> pending', async () => {
      const row = await commission(1_000)
      await transitionLedgerEntry(payload, row.id, 'approved')
      await expect(transitionLedgerEntry(payload, row.id, 'pending')).rejects.toMatchObject({ code: 'invalid_transition' })
    })

    it('refuses paid -> reserved', async () => {
      await commission(10_000, { status: 'approved' })
      const payoutId = await createPayout(5_000)
      const { entry } = await reservePayout(payload, { ambassadorId: ambassador.id, payoutId, amountKobo: 5_000 })
      await markPayoutPaid(payload, payoutId)
      await expect(transitionLedgerEntry(payload, entry.id, 'reserved')).rejects.toMatchObject({ code: 'invalid_transition' })
    })

    it('refuses approving twice, voiding an approved commission and voiding a paid payout', async () => {
      const row = await commission(1_000)
      await transitionLedgerEntry(payload, row.id, 'approved')
      await expect(transitionLedgerEntry(payload, row.id, 'approved')).rejects.toMatchObject({ code: 'invalid_transition' })
      await expect(voidPendingCommission(payload, row.id, 'refund')).rejects.toMatchObject({ code: 'invalid_transition' })
      const payoutId = await createPayout(500)
      await reservePayout(payload, { ambassadorId: ambassador.id, payoutId, amountKobo: 500 })
      await markPayoutPaid(payload, payoutId)
      await expect(voidPayout(payload, payoutId)).rejects.toMatchObject({ code: 'invalid_transition' })
    })

    it('voids a pending commission, and refuses to void a payout through voidPendingCommission', async () => {
      const row = await commission(1_000)
      expect((await voidPendingCommission(payload, row.id, 'refunded before approval')).status).toBe('void')
      await commission(1_000, { status: 'approved' })
      const payoutId = await createPayout(500)
      const { entry } = await reservePayout(payload, { ambassadorId: ambassador.id, payoutId, amountKobo: 500 })
      await expect(voidPendingCommission(payload, entry.id, 'x')).rejects.toMatchObject({ code: 'invalid_transition' })
    })

    it('reports a missing row', async () => {
      await expect(transitionLedgerEntry(payload, 999_999, 'approved')).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  describe('reversals, adjustments and payouts', () => {
    it('a reversal key must name its order', async () => {
      await expect(recordReversal(payload, { ambassadorId: ambassador.id, orderId: 5, amountKobo: -10, key: 'reversal:order:6:rf' })).rejects.toBeInstanceOf(LedgerError)
    })

    it('a repeated reversal (same refund) is recorded once', async () => {
      const order = await createTestOrder(payload)
      const args = { ambassadorId: ambassador.id, orderId: order.id, amountKobo: -10, key: `reversal:order:${order.id}:rf_9` }
      expect((await recordReversal(payload, args)).created).toBe(true)
      expect((await recordReversal(payload, args)).created).toBe(false)
    })

    it('an adjustment needs a note of 10 characters and a non-zero amount', async () => {
      await expect(recordAdjustment(payload, { ambassadorId: ambassador.id, amountKobo: 100, note: 'too short', createdBy: 1 })).rejects.toBeInstanceOf(LedgerError)
      await expect(recordAdjustment(payload, { ambassadorId: ambassador.id, amountKobo: 0, note: 'Long enough note', createdBy: 1 })).rejects.toBeInstanceOf(LedgerError)
      const row = await recordAdjustment(payload, { ambassadorId: ambassador.id, amountKobo: 100, note: 'Long enough note', createdBy: 1 })
      expect(row.idempotencyKey).toMatch(/^adjustment:[0-9a-f-]{36}$/)
    })

    it('refuses to reserve more than the available balance', async () => {
      await commission(1_000, { status: 'approved' })
      const payoutId = await createPayout(1_001)
      await expect(reservePayout(payload, { ambassadorId: ambassador.id, payoutId, amountKobo: 1_001 })).rejects.toMatchObject({ code: 'insufficient_balance' })
    })

    it('two concurrent reservations under withLock for one ambassador: exactly one succeeds', async () => {
      await commission(10_000, { status: 'approved' })
      const [p1, p2] = [await createPayout(8_000), await createPayout(8_000)]
      const reserve = (payoutId: number) =>
        withLock(`ambassador-withdraw:${ambassador.id}`, 30, () => reservePayout(payload, { ambassadorId: ambassador.id, payoutId, amountKobo: 8_000 }))
      const results = await Promise.allSettled([reserve(p1), reserve(p2)])
      const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value !== null)
      expect(succeeded).toHaveLength(1)
      const wallet = await getWallet(payload, ambassador.id)
      expect(wallet).toMatchObject({ availableKobo: 2_000, inFlightKobo: 8_000 })
    })

    it('a second reservation for the same payout is not re-checked against the balance and returns the same row', async () => {
      await commission(1_000, { status: 'approved' })
      const payoutId = await createPayout(1_000)
      const first = await reservePayout(payload, { ambassadorId: ambassador.id, payoutId, amountKobo: 1_000 })
      const second = await reservePayout(payload, { ambassadorId: ambassador.id, payoutId, amountKobo: 1_000 })
      expect(second).toMatchObject({ created: false })
      expect(second.entry.id).toBe(first.entry.id)
    })
  })

  describe('approveDueCommissions', () => {
    it('approves only rows whose availableAt has passed, and is idempotent', async () => {
      const now = new Date()
      const due = await commission(1_000, { availableAt: new Date(now.getTime() - DAY) })
      const exactlyNow = await commission(2_000, { availableAt: now })
      const notYet = await commission(4_000, { availableAt: new Date(now.getTime() + DAY) })

      const first = await approveDueCommissions(payload, now, 100)
      expect(first).toHaveLength(1)
      expect(first[0]!.ambassadorId).toBe(ambassador.id)
      expect(first[0]!.entries.map((e) => e.id).sort()).toEqual([due.id, exactlyNow.id].sort())
      expect(first[0]!.entries.every((e) => e.status === 'approved')).toBe(true)

      expect(await approveDueCommissions(payload, now, 100)).toEqual([])
      const still = await payload.findByID({ collection: 'ambassador-ledger', id: notYet.id, overrideAccess: true })
      expect(still.status).toBe('pending')
      expect(await getWallet(payload, ambassador.id)).toMatchObject({ pendingKobo: 4_000, availableKobo: 3_000 })
    })

    it('groups by ambassador, includes blocked ambassadors, skips pending ones, and respects the limit', async () => {
      const past = new Date(Date.now() - DAY)
      const blocked = await createTestAmbassador(payload, { status: 'blocked' })
      const pending = await createTestAmbassador(payload, { status: 'pending' })
      await commission(100, { availableAt: past })
      await commission(200, { availableAt: past, ambassadorId: blocked.id })
      await commission(300, { availableAt: past, ambassadorId: pending.id })

      const limited = await approveDueCommissions(payload, new Date(), 1)
      expect(limited.flatMap((g) => g.entries)).toHaveLength(1)
      const rest = await approveDueCommissions(payload, new Date(), 100)
      const all = [...limited, ...rest]
      expect(new Set(all.map((g) => g.ambassadorId))).toEqual(new Set([ambassador.id, blocked.id]))
      expect((await getWallet(payload, pending.id)).pendingKobo).toBe(300)
    })
  })

  describe('withTransaction', () => {
    it('rolls back every ledger write when the work fails', async () => {
      await expect(withTransaction(payload, async (req) => {
        await insertLedgerEntry(payload, { ambassadorId: ambassador.id, type: 'commission', status: 'pending', amountKobo: 700, idempotencyKey: 'commission:order:777' }, req)
        expect((await getWallet(payload, ambassador.id, req)).pendingKobo).toBe(700)
        throw new Error('fail after insert')
      })).rejects.toThrow('fail after insert')
      expect((await getWallet(payload, ambassador.id)).pendingKobo).toBe(0)
    })

    it('commits when the work succeeds', async () => {
      await withTransaction(payload, (req) =>
        insertLedgerEntry(payload, { ambassadorId: ambassador.id, type: 'commission', status: 'pending', amountKobo: 700, idempotencyKey: 'commission:order:778' }, req))
      expect((await getWallet(payload, ambassador.id)).pendingKobo).toBe(700)
    })
  })
})
