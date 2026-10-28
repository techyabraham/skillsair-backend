import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Payload, PayloadRequest } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { AMBASSADOR_TABLES, createTestUser, describeWithDb, execute, getTestPayload, truncate } from '../../test/payload-harness.js'
import { createTestAmbassador, createTestOrder } from '../../test/ambassador-fixtures.js'
import { resetFakeRedis } from '../../test/fake-redis.js'
import { attributeUser, attributionSnapshot, resolveReferral } from './attribution.js'
import { signAttributionToken } from './attribution-token.js'
import { clearAmbassadorSettingsCache } from './settings.js'
import { recordCommissionForInvoice, recordCommissionForOrder } from './commissions.js'
import { handleInvoiceRefund, handleOrderRefund } from './refunds.js'
import { getWallet, insertLedgerEntry, markPayoutPaid, reservePayout, transitionLedgerEntry } from './ledger.js'
import { runAmbassadorCommissions } from '../../jobs/ambassador-commissions.js'
import { ambassadorTrackEndpoint } from '../../endpoints/ambassadors/track.js'
import { handleAmbassadorRefund } from '../../endpoints/ambassadors/refund-webhook.js'
import { relationId } from '../course-access.js'
import { applyPaidInvoice } from '../subscription-events.js'
import { fulfillOrder } from '../order-fulfillment.js'
import { applyPayoutTransferEvent } from './payouts.js'
import { sendEmail } from '../resend.js'
import type { AmbassadorDoc, LedgerDoc } from './types.js'
vi.mock('../resend.js', async importOriginal => ({ ...await importOriginal<typeof import('../resend.js')>(), sendEmail: vi.fn().mockResolvedValue('test-email') }))
vi.mock('../lifecycle/events.js', () => ({ onLifecycleEvent: vi.fn().mockResolvedValue(undefined) }))
const DAY = 86400000

describeWithDb('ambassador earning engine', () => {
  let payload: Payload
  let ambassador: AmbassadorDoc
  let buyerId: number
  beforeAll(async () => { process.env.AMBASSADOR_ATTRIBUTION_SECRET = 'integration-attribution-secret-0123456789abcdef'; payload = await getTestPayload() })
  beforeEach(async () => {
    await truncate(payload, [...AMBASSADOR_TABLES, 'users', 'orders', 'subscriptions'])
    resetFakeRedis(); vi.mocked(sendEmail).mockClear(); clearAmbassadorSettingsCache()
    await payload.updateGlobal({ slug: 'ambassador-settings', data: { commissionRateBps: 5000, approvalDelayDays: 7, attributionModel: 'first_click', attributionLifetimeDays: null, commissionableTypes: ['course', 'subscription', 'renewal'] }, overrideAccess: true })
    ambassador = await createTestAmbassador(payload)
    buyerId = (await createTestUser(payload)).id
  })
  const token = (amb: AmbassadorDoc = ambassador) => signAttributionToken({ ambassadorId: amb.id, code: amb.code, clickedAt: new Date().toISOString() }, 30)
  const attribute = (value = token()) => attributeUser(payload, { userId: buyerId, value, source: 'cookie_register' })
  async function order() {
    const { id } = await createTestOrder(payload, { userId: buyerId })
    await payload.update({ collection: 'orders', id, data: { paidAt: new Date().toISOString(), fulfilledAt: new Date().toISOString(), metadata: await attributionSnapshot(payload, buyerId) }, overrideAccess: true })
    return id
  }
  async function entries() { return (await payload.find({ collection: 'ambassador-ledger', limit: 100, depth: 0, sort: 'id', overrideAccess: true })).docs as unknown as LedgerDoc[] }
  it('first click wins and concurrent attributions create exactly one record', async () => {
    const other = await createTestAmbassador(payload)
    expect(await attribute()).toEqual({ attributed: true })
    await attribute(token(other))
    expect((await attributionSnapshot(payload, buyerId)).ambassadorId).toBe(ambassador.id)
    const fresh = (await createTestUser(payload)).id
    await Promise.all([ambassador, other].map(amb => attributeUser(payload, { userId: fresh, value: token(amb), source: 'cookie_checkout' })))
    expect((await payload.count({ collection: 'referral-attributions', where: { referredUser: { equals: fresh } }, overrideAccess: true })).totalDocs).toBe(1)
  })
  it('last click replaces only expired finite attributions; permanent ones stay', async () => {
    await attribute()
    const other = await createTestAmbassador(payload)
    await payload.updateGlobal({ slug: 'ambassador-settings', data: { attributionModel: 'last_click' }, overrideAccess: true })
    await attribute(token(other))
    expect((await attributionSnapshot(payload, buyerId)).ambassadorId).toBe(ambassador.id)
    const row = await attributionSnapshot(payload, buyerId)
    await payload.update({ collection: 'referral-attributions', id: row.attributionId!, data: { lockedUntil: new Date(Date.now() - DAY).toISOString() }, overrideAccess: true })
    await attribute(token(other))
    expect((await attributionSnapshot(payload, buyerId)).ambassadorId).toBe(other.id)
  })
  it('blocks self-referrals, inactive ambassadors and forged signed identities', async () => {
    const ownId = Number(relationId(ambassador.user))
    expect(await attributeUser(payload, { userId: ownId, value: token(), source: 'cookie_checkout' })).toMatchObject({ reason: 'self_referral' })
    const ownOrder = await createTestOrder(payload, { userId: ownId })
    await payload.update({ collection: 'orders', id: ownOrder.id, data: { metadata: { ambassadorId: ambassador.id } }, overrideAccess: true })
    await recordCommissionForOrder(payload, ownOrder.id)
    expect(await entries()).toHaveLength(0)
    await payload.update({ collection: 'ambassadors', id: ambassador.id, data: { status: 'blocked' }, overrideAccess: true })
    expect(await attribute()).toMatchObject({ reason: 'inactive_or_missing' })
  })
  it('resolves legacy numeric links and flags shared phones without rejecting attribution', async () => {
    await payload.update({ collection: 'ambassadors', id: ambassador.id, data: { legacyWpRef: '125' }, overrideAccess: true })
    expect((await resolveReferral(payload, '125'))?.id).toBe(ambassador.id)
    for (const id of [Number(relationId(ambassador.user)), buyerId]) await payload.update({ collection: 'users', id, data: { phone: '+2348012345678' }, overrideAccess: true })
    expect(await attribute('code:125')).toEqual({ attributed: true })
    const fresh = await payload.findByID({ collection: 'ambassadors', id: ambassador.id, overrideAccess: true })
    expect(fresh.riskFlags).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'self_referral_suspected' })]))
  })
  it('creates one 50% commission, preserves the snapshot, and never recalculates old rates', async () => {
    await attribute(); const id = await order()
    await Promise.all([recordCommissionForOrder(payload, id), recordCommissionForOrder(payload, id)])
    let rows = await entries()
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ amountKobo: 1250000, saleKobo: 2500000, rateBps: 5000, status: 'pending' })
    const paid = await payload.findByID({ collection: 'orders', id, overrideAccess: true })
    expect(Date.parse(rows[0]!.availableAt!) - Date.parse(String(paid.paidAt))).toBe(7 * DAY)
    await payload.updateGlobal({ slug: 'ambassador-settings', data: { commissionRateBps: 3000 }, overrideAccess: true })
    const next = await order(); await recordCommissionForOrder(payload, next)
    rows = await entries(); expect(rows.map(r => r.amountKobo)).toEqual([1250000, 750000])
  })
  it('order-time ambassador snapshot survives admin reassignment', async () => {
    await attribute(); const id = await order(); const other = await createTestAmbassador(payload)
    const snapshot = await attributionSnapshot(payload, buyerId)
    await payload.update({ collection: 'referral-attributions', id: snapshot.attributionId!, data: { ambassador: other.id }, overrideAccess: true })
    await recordCommissionForOrder(payload, id)
    expect((await entries())[0]!.ambassador).toBe(ambassador.id)
  })
  it('blocked ambassadors earn nothing new while approved earnings remain', async () => {
    await attribute(); const first = await order(); await recordCommissionForOrder(payload, first)
    await transitionLedgerEntry(payload, (await entries())[0]!.id, 'approved')
    await payload.update({ collection: 'ambassadors', id: ambassador.id, data: { status: 'blocked' }, overrideAccess: true })
    await recordCommissionForOrder(payload, await order())
    expect(await entries()).toHaveLength(1)
    expect((await getWallet(payload, ambassador.id)).availableKobo).toBe(1250000)
  })
  it('excludes certificates and zero-rate sales', async () => {
    await attribute(); const id = await order()
    await payload.update({ collection: 'orders', id, data: { type: 'certificate' }, overrideAccess: true }); await recordCommissionForOrder(payload, id)
    await payload.updateGlobal({ slug: 'ambassador-settings', data: { commissionRateBps: 0 }, overrideAccess: true }); await recordCommissionForOrder(payload, await order())
    expect(await entries()).toHaveLength(0)
  })
  it('fulfilment replay creates one enrollment and one commission', async () => {
    await attribute()
    const course = await payload.create({ collection: 'courses', data: { title: 'Test course', slug: 'earning-test-' + Date.now(), status: 'published', price: 25000 }, overrideAccess: true })
    const id = await order()
    await payload.update({ collection: 'orders', id, data: { course: course.id, fulfilledAt: null }, overrideAccess: true })
    await fulfillOrder(payload, id); await fulfillOrder(payload, id)
    expect((await entries()).filter(r => r.order === id)).toHaveLength(1)
    expect((await payload.count({ collection: 'enrollments', where: { student: { equals: buyerId } }, overrideAccess: true })).totalDocs).toBe(1)
  })
  it('subscription initial payment earns once; renewal invoice replay earns once and can be refunded', async () => {
    await attribute()
    const course = await payload.create({ collection: 'courses', data: { title: 'Subscription test', slug: 'renewal-test-' + Date.now(), status: 'published', price: 25000 }, overrideAccess: true })
    const plan = await payload.create({ collection: 'plans', data: { name: 'Monthly learning', course: course.id, price: 25000, interval: 'monthly' }, overrideAccess: true })
    const id = await order()
    const initial = await payload.update({ collection: 'orders', id, data: { type: 'subscription', plan: plan.id, course: course.id }, overrideAccess: true })
    await recordCommissionForOrder(payload, id)
    const subscription = await payload.create({ collection: 'subscriptions', data: { user: buyerId, course: course.id, plan: plan.id, status: 'active', initialOrderReference: initial.reference, paystackSubscriptionCode: 'SUB_test', currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString() }, overrideAccess: true })
    await recordCommissionForInvoice(payload, { subscriptionId: Number(subscription.id), invoiceCode: 'INV_first', amountKobo: 2500000, paidAt: new Date().toISOString(), transactionReference: String(initial.reference) })
    expect(await entries()).toHaveLength(1)
    const invoice = { paid: true, status: 'success', invoice_code: 'INV_renewal', period_start: new Date().toISOString(), period_end: new Date(Date.now() + 60 * DAY).toISOString(), subscription: { subscription_code: 'SUB_test' }, transaction: { reference: 'renewal-reference', status: 'success', amount: 2500000, currency: 'NGN' } }
    for (let i = 0; i < 3; i++) await applyPaidInvoice(payload, invoice)
    expect(await entries()).toHaveLength(2)
    const row = (await entries()).find(r => r.invoiceCode === 'INV_renewal')!
    await handleInvoiceRefund(payload, { transactionReference: 'renewal-reference', refundedKobo: 500000, refundKey: 'r-partial-1' })
    await handleInvoiceRefund(payload, { transactionReference: 'renewal-reference', refundedKobo: 500000, refundKey: 'r-partial-2' })
    await handleInvoiceRefund(payload, { transactionReference: 'renewal-reference', refundedKobo: 500000, refundKey: 'r-partial-2' })
    const remainder = (await entries()).find(r => r.invoiceCode === 'INV_renewal' && r.status === 'pending')!
    expect(remainder).toMatchObject({ amountKobo: 750000, saleKobo: 1500000, idempotencyKey: 'commission:invoice:INV_renewal:partial:r-partial-2' })
    await transitionLedgerEntry(payload, remainder.id, 'approved')
    await handleInvoiceRefund(payload, { transactionReference: 'renewal-reference', refundedKobo: 1500000, refundKey: 'r-full' })
    await handleInvoiceRefund(payload, { transactionReference: 'renewal-reference', refundedKobo: 1500000, refundKey: 'r-full' })
    const reversals = (await entries()).filter(r => r.type === 'reversal')
    expect(reversals).toHaveLength(1)
    expect(reversals[0]!.idempotencyKey).toBe('reversal:invoice:INV_renewal:r-full')
  })
  it('full pending refund voids once; partial refund preserves the right remainder', async () => {
    await attribute(); const id = await order(); await recordCommissionForOrder(payload, id)
    await handleOrderRefund(payload, { orderId: id, refundedKobo: 2500000, refundKey: 'r1' })
    await handleOrderRefund(payload, { orderId: id, refundedKobo: 2500000, refundKey: 'r1' })
    expect((await getWallet(payload, ambassador.id)).totalEarnedKobo).toBe(0)
    const second = await order(); await recordCommissionForOrder(payload, second)
    const row = (await entries()).find(r => r.order === second)!
    await handleOrderRefund(payload, { orderId: second, refundedKobo: 1000000, refundKey: 'r2' })
    const partial = (await entries()).find(r => r.idempotencyKey.endsWith(':partial:r2'))!
    expect(partial).toMatchObject({ amountKobo: 750000, status: 'pending', availableAt: row.availableAt })
    await handleOrderRefund(payload, { orderId: second, refundedKobo: 500000, refundKey: 'r3' })
    const finalRemainder = (await entries()).find(r => r.idempotencyKey.endsWith(':partial:r3'))!
    expect(finalRemainder).toMatchObject({ amountKobo: 500000, saleKobo: 1000000, status: 'pending' })
    await handleOrderRefund(payload, { orderId: second, refundedKobo: 500000, refundKey: 'r3' })
    expect((await getWallet(payload, ambassador.id)).pendingKobo).toBe(500000)
  })
  it('refund after payout creates one reversal and a negative available balance', async () => {
    await attribute(); const id = await order(); await recordCommissionForOrder(payload, id)
    await transitionLedgerEntry(payload, (await entries())[0]!.id, 'approved')
    const payout = await payload.create({ collection: 'ambassador-payouts', data: { ambassador: ambassador.id, amountKobo: 1250000, status: 'processing' }, overrideAccess: true })
    await reservePayout(payload, { ambassadorId: ambassador.id, payoutId: Number(payout.id), amountKobo: 1250000 }); await markPayoutPaid(payload, Number(payout.id))
    for (let i = 0; i < 3; i++) await handleOrderRefund(payload, { orderId: id, refundedKobo: 2500000, refundKey: 'r1' })
    expect((await entries()).filter(r => r.type === 'reversal')).toHaveLength(1)
    expect((await getWallet(payload, ambassador.id)).availableKobo).toBe(-1250000)
  })
  it('restores a completed payout reversal with an append-only wallet row', async () => {
    await insertLedgerEntry(payload, { ambassadorId: ambassador.id, type: 'adjustment', status: 'approved', amountKobo: 500000, note: 'Test opening wallet credit', idempotencyKey: 'adjustment:12345678-1234-4234-9234-123456789012' })
    const payout = await payload.create({ collection: 'ambassador-payouts', data: { ambassador: ambassador.id, amountKobo: 500000, status: 'success', reference: 'amb_0123456789abcdef0123456789abcdef' }, overrideAccess: true })
    await reservePayout(payload, { ambassadorId: ambassador.id, payoutId: Number(payout.id), amountKobo: 500000 })
    await markPayoutPaid(payload, Number(payout.id))
    const event = { event: 'transfer.reversed' as const, reference: 'amb_0123456789abcdef0123456789abcdef', amount: 500000, currency: 'NGN', status: 'reversed', transferCode: 'TRF_test' }
    await applyPayoutTransferEvent(payload, event)
    await applyPayoutTransferEvent(payload, event)
    const rows = await entries()
    expect(rows.filter(r => r.type === 'payout')).toMatchObject([{ status: 'paid', amountKobo: -500000 }])
    expect(rows.filter(r => r.type === 'payout_reversal')).toMatchObject([{ status: 'approved', amountKobo: 500000, idempotencyKey: `payout-reversal:${payout.id}` }])
    expect((await getWallet(payload, ambassador.id)).availableKobo).toBe(500000)
    expect((await payload.findByID({ collection: 'ambassador-payouts', id: Number(payout.id), overrideAccess: true })).status).toBe('failed')
  })
  it('refund webhook accepts the documented string kobo amount and refuses missing identifiers', async () => {
    await attribute(); const id = await order()
    const doc = await payload.findByID({ collection: 'orders', id, overrideAccess: true })
    await handleAmbassadorRefund(payload, { status: 'processed', transaction_reference: String(doc.reference), refund_reference: 'refund-test-1', amount: '2500000', currency: 'NGN' })
    expect((await payload.findByID({ collection: 'orders', id, overrideAccess: true })).status).toBe('refunded')
    expect((await entries())[0]!.status).toBe('void')
    await expect(handleAmbassadorRefund(payload, { status: 'processed', transaction_reference: String(doc.reference), amount: '2500000', currency: 'NGN' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
  it('job groups approval email per ambassador, repairs missing commissions, and is idempotent', async () => {
    await attribute(); const repairId = await order()
    for (const index of [1, 2]) await insertLedgerEntry(payload, { ambassadorId: ambassador.id, type: 'commission', status: 'pending', amountKobo: 1000, availableAt: new Date(Date.now() - DAY), idempotencyKey: 'commission:order:' + (900000 + index) })
    expect(await runAmbassadorCommissions(payload)).toEqual({ approved: 2, repaired: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(await runAmbassadorCommissions(payload)).toEqual({ approved: 0, repaired: 0 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect((await entries()).some(r => r.order === repairId)).toBe(true)
  })
  it('tracks daily uniques, strips referrer details, keeps first-click tokens, and skips bots', async () => {
    const request = (ref: string, existing?: string, ua = 'Mozilla/5.0') => {
      const req = new Request('http://localhost/api/ambassadors/track', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua }, body: JSON.stringify({ ref, existing, visitorId: 'cfe12644-a3ae-48e1-b892-88db3ef1c888', landingPath: '/courses/design', referrer: 'https://example.com/private?secret=x' }) })
      return Object.assign(req, { payload }) as PayloadRequest
    }
    const invoke = async (req: PayloadRequest) => (await ambassadorTrackEndpoint.handler(req)).json()
    const first = await invoke(request(ambassador.code)) as { data: { token: string } }
    const other = await createTestAmbassador(payload)
    const second = await invoke(request(other.code, first.data.token)) as { data: { token: string } }
    expect(second.data.token).toBe(first.data.token)
    await invoke(request(ambassador.code)); await invoke(request(ambassador.code, undefined, 'WhatsApp'))
    const clicks = await payload.find({ collection: 'referral-clicks', depth: 0, limit: 10, overrideAccess: true })
    expect(clicks.docs).toHaveLength(3)
    expect(clicks.docs.every(r => r.referrerHost === 'example.com')).toBe(true)
    expect(clicks.docs.filter(r => r.isUnique)).toHaveLength(2)
  })
})
