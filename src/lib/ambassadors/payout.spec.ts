import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { createTestAmbassador } from '../../test/ambassador-fixtures.js'
import { AMBASSADOR_TABLES, describeWithDb, getTestPayload, truncate } from '../../test/payload-harness.js'
import { resetFakeRedis } from '../../test/fake-redis.js'
import { sendEmail } from '../resend.js'
import { getWallet, insertLedgerEntry } from './ledger.js'
import { applyPayoutTransferEvent, processPayout, reconcilePayout, requestPayout, type PayoutDoc } from './payouts.js'
import { clearAmbassadorSettingsCache } from './settings.js'
import type { AmbassadorDoc } from './types.js'

vi.mock('../resend.js', async importOriginal => ({ ...await importOriginal<typeof import('../resend.js')>(), sendEmail: vi.fn().mockResolvedValue('test-email') }))
vi.mock('../paystack.js', async importOriginal => ({
  ...await importOriginal<typeof import('../paystack.js')>(),
  createTransferRecipient: vi.fn().mockResolvedValue('RCP_test'),
  initiateTransfer: vi.fn().mockImplementation(async ({ reference, amountKobo }: { reference: string; amountKobo: number }) => ({
    id: 1, reference, transfer_code: 'TRF_test', amount: amountKobo, currency: 'NGN', status: 'pending',
  })),
  verifyTransfer: vi.fn(),
}))
import { createTransferRecipient, initiateTransfer, verifyTransfer, PaystackTransferError } from '../paystack.js'

describeWithDb('ambassador payout requests', () => {
  let payload: Payload
  let ambassador: AmbassadorDoc
  beforeAll(async () => { payload = await getTestPayload() })
  beforeEach(async () => {
    vi.clearAllMocks()
    await truncate(payload, [...AMBASSADOR_TABLES, 'users', 'orders'])
    resetFakeRedis(); clearAmbassadorSettingsCache()
    await payload.updateGlobal({ slug: 'ambassador-settings', data: { payoutsEnabled: true, payoutMode: 'manual_review', minPayoutKobo: 500000 }, overrideAccess: true })
    ambassador = await createTestAmbassador(payload)
    const bank = await payload.create({
      collection: 'ambassador-bank-accounts',
      data: { ambassador: ambassador.id, bankCode: '058', bankName: 'Test Bank', accountName: 'Test User', accountNumber: '0123456789', accountLast4: '6789', resolvedAt: new Date().toISOString(), isCurrent: true },
      overrideAccess: true,
    })
    expect(bank.accountNumber).toBe('0123456789')
  })
  async function credit(amountKobo: number) {
    await insertLedgerEntry(payload, { ambassadorId: ambassador.id, type: 'commission', status: 'approved', amountKobo, saleKobo: amountKobo * 2, rateBps: 5000, idempotencyKey: `commission:order:${1000 + amountKobo}`, productType: 'course' })
  }

  it('reserves once for an idempotent request and enforces the minimum', async () => {
    await credit(1_000_000)
    const requestId = '12345678-1234-4234-9234-123456789012'
    const first = await requestPayout(payload, { ambassadorId: ambassador.id, amountKobo: 500_000, requestId })
    const retry = await requestPayout(payload, { ambassadorId: ambassador.id, amountKobo: 500_000, requestId })
    expect(first.created).toBe(true)
    expect(retry).toMatchObject({ created: false, payout: { id: first.payout.id } })
    expect((await getWallet(payload, ambassador.id)).availableKobo).toBe(500_000)
    await expect(requestPayout(payload, { ambassadorId: ambassador.id, amountKobo: 499_999, requestId: '22345678-1234-4234-9234-123456789012' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('serialises concurrent full-balance requests so only one is reserved', async () => {
    await credit(500_000)
    const outcomes = await Promise.allSettled([
      requestPayout(payload, { ambassadorId: ambassador.id, amountKobo: 500_000, requestId: '32345678-1234-4234-9234-123456789012' }),
      requestPayout(payload, { ambassadorId: ambassador.id, amountKobo: 500_000, requestId: '42345678-1234-4234-9234-123456789012' }),
    ])
    expect(outcomes.filter((value) => value.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((value) => value.status === 'rejected')).toHaveLength(1)
    expect((await getWallet(payload, ambassador.id)).availableKobo).toBe(0)
    expect((await payload.count({ collection: 'ambassador-payouts', where: { ambassador: { equals: ambassador.id } }, overrideAccess: true })).totalDocs).toBe(1)
  })

  it('rejects bank accounts inside the replacement hold', async () => {
    await credit(1_000_000)
    const banks = await payload.find({ collection: 'ambassador-bank-accounts', where: { ambassador: { equals: ambassador.id } }, limit: 1, depth: 0, overrideAccess: true })
    await payload.update({ collection: 'ambassador-bank-accounts', id: Number(banks.docs[0]!.id), data: { holdUntil: new Date(Date.now() + 60_000).toISOString() }, overrideAccess: true })
    await expect(requestPayout(payload, { ambassadorId: ambassador.id, amountKobo: 500_000, requestId: '52345678-1234-4234-9234-123456789012' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect((await getWallet(payload, ambassador.id)).availableKobo).toBe(1_000_000)
  })

  it('processes one approved transfer and marks the reservation paid once', async () => {
    await credit(1_000_000)
    const { payout } = await requestPayout(payload, { ambassadorId: ambassador.id, amountKobo: 500_000, requestId: '62345678-1234-4234-9234-123456789012' })
    await payload.update({ collection: 'ambassador-payouts', id: payout.id, data: { status: 'approved' }, overrideAccess: true })

    const processing = await processPayout(payload, payout.id)
    expect(processing?.status).toBe('processing')
    expect(initiateTransfer).toHaveBeenCalledTimes(1)
    expect(initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 500_000, reference: payout.reference }))

    const event = { event: 'transfer.success' as const, reference: payout.reference, amount: 500_000, currency: 'NGN', status: 'success', transferCode: 'TRF_test' }
    await applyPayoutTransferEvent(payload, event)
    await applyPayoutTransferEvent(payload, event)
    const completed = await payload.findByID({ collection: 'ambassador-payouts', id: payout.id, depth: 0, overrideAccess: true }) as unknown as PayoutDoc
    const ledger = await payload.find({ collection: 'ambassador-ledger', where: { payout: { equals: payout.id } }, limit: 5, depth: 0, overrideAccess: true })
    expect(completed.status).toBe('success')
    expect(ledger.docs).toHaveLength(1)
    expect(ledger.docs[0]?.status).toBe('paid')
    expect(await getWallet(payload, ambassador.id)).toMatchObject({ availableKobo: 500_000, inFlightKobo: 0, paidOutKobo: 500_000 })
  })

  it('returns a failed transfer reservation to the available balance', async () => {
    await credit(1_000_000)
    const { payout } = await requestPayout(payload, { ambassadorId: ambassador.id, amountKobo: 500_000, requestId: '72345678-1234-4234-9234-123456789012' })
    await payload.update({ collection: 'ambassador-payouts', id: payout.id, data: { status: 'approved' }, overrideAccess: true })
    await processPayout(payload, payout.id)

    await applyPayoutTransferEvent(payload, { event: 'transfer.failed', reference: payout.reference, amount: 500_000, currency: 'NGN', status: 'failed' })
    const failed = await payload.findByID({ collection: 'ambassador-payouts', id: payout.id, depth: 0, overrideAccess: true }) as unknown as PayoutDoc
    expect(failed.status).toBe('failed')
    expect(await getWallet(payload, ambassador.id)).toMatchObject({ availableKobo: 1_000_000, inFlightKobo: 0, paidOutKobo: 0 })
  })

  it('reconciles an ambiguous transfer by reference without starting a second transfer', async () => {
    await credit(1_000_000)
    const { payout } = await requestPayout(payload, { ambassadorId: ambassador.id, amountKobo: 500_000, requestId: '82345678-1234-4234-9234-123456789012' })
    await payload.update({ collection: 'ambassador-payouts', id: payout.id, data: { status: 'approved' }, overrideAccess: true })
    vi.mocked(initiateTransfer).mockRejectedValueOnce(new PaystackTransferError('ambiguous'))
    const stuck = await processPayout(payload, payout.id)
    expect(stuck?.status).toBe('processing')

    vi.mocked(verifyTransfer).mockResolvedValueOnce({ id: 1, reference: payout.reference, transfer_code: 'TRF_test', amount: 500_000, currency: 'NGN', status: 'success' })
    await reconcilePayout(payload, stuck as PayoutDoc)
    expect(initiateTransfer).toHaveBeenCalledTimes(1)
    const recovered = await payload.findByID({ collection: 'ambassador-payouts', id: payout.id, depth: 0, overrideAccess: true }) as unknown as PayoutDoc
    expect(recovered.status).toBe('success')
    expect(await getWallet(payload, ambassador.id)).toMatchObject({ availableKobo: 500_000, inFlightKobo: 0 })
  })

  it('alerts the admin when Paystack recipient setup remains unresolved for 24 hours', async () => {
    await credit(1_000_000)
    const { payout } = await requestPayout(payload, { ambassadorId: ambassador.id, amountKobo: 500_000, requestId: 'a2345678-1234-4234-9234-123456789012' })
    await payload.update({ collection: 'ambassador-payouts', id: payout.id, data: { status: 'approved' }, overrideAccess: true })
    vi.mocked(createTransferRecipient).mockRejectedValueOnce(new PaystackTransferError('ambiguous'))
    const stuck = await processPayout(payload, payout.id)
    expect(stuck?.status).toBe('processing')

    const after24Hours = new Date(Date.parse(payout.createdAt) + 25 * 60 * 60 * 1000)
    const originalAdminEmail = process.env.AMBASSADOR_ADMIN_EMAIL
    process.env.AMBASSADOR_ADMIN_EMAIL = 'payout-admin@example.test'
    try {
      await reconcilePayout(payload, stuck as PayoutDoc, after24Hours)
      expect(sendEmail).toHaveBeenCalledWith('payout-admin@example.test', expect.objectContaining({
        subject: 'SkillsAir Ambassadors payout needs attention',
        text: expect.stringContaining('unresolved for more than 24 hours'),
      }))
    } finally {
      if (originalAdminEmail === undefined) delete process.env.AMBASSADOR_ADMIN_EMAIL
      else process.env.AMBASSADOR_ADMIN_EMAIL = originalAdminEmail
    }
    const alerted = await payload.findByID({ collection: 'ambassador-payouts', id: payout.id, depth: 0, overrideAccess: true }) as unknown as PayoutDoc
    expect(alerted.providerPayload).toMatchObject({ stage: 'transfer_initiation_started', adminAlertedAt: after24Hours.toISOString() })
    expect(createTransferRecipient).toHaveBeenCalledTimes(2)
  })

  it('restores a successful transfer reversal with a new ledger entry, leaving the paid row immutable', async () => {
    await credit(1_000_000)
    const { payout } = await requestPayout(payload, { ambassadorId: ambassador.id, amountKobo: 500_000, requestId: '92345678-1234-4234-9234-123456789012' })
    await payload.update({ collection: 'ambassador-payouts', id: payout.id, data: { status: 'approved' }, overrideAccess: true })
    await processPayout(payload, payout.id)
    const event = { reference: payout.reference, amount: 500_000, currency: 'NGN', status: 'success' }
    await applyPayoutTransferEvent(payload, { ...event, event: 'transfer.success' })
    const before = await payload.find({ collection: 'ambassador-ledger', where: { payout: { equals: payout.id } }, limit: 5, depth: 0, overrideAccess: true })
    const paidRow = before.docs[0] as { id: number; amountKobo: number; status: string }

    await applyPayoutTransferEvent(payload, { ...event, status: 'reversed', event: 'transfer.reversed' })
    await applyPayoutTransferEvent(payload, { ...event, status: 'reversed', event: 'transfer.reversed' })
    const after = await payload.find({ collection: 'ambassador-ledger', where: { ambassador: { equals: ambassador.id } }, sort: 'createdAt', limit: 10, depth: 0, overrideAccess: true })
    const unchangedPaidRow = after.docs.find((row) => row.id === paidRow.id) as unknown as { amountKobo: number; status: string }
    expect(unchangedPaidRow).toMatchObject({ amountKobo: -500_000, status: 'paid' })
    expect(after.docs.filter((row) => row.type === 'payout_reversal')).toHaveLength(1)
    expect(await getWallet(payload, ambassador.id)).toMatchObject({ availableKobo: 1_000_000, paidOutKobo: 500_000 })
  })
})
