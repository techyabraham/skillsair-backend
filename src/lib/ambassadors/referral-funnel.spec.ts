import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { handleEndpoints, type Payload } from 'payload'
import { AMBASSADOR_TABLES, createTestUser, describeWithDb, getTestPayload, truncate } from '../../test/payload-harness.js'
import { createTestAmbassador } from '../../test/ambassador-fixtures.js'
import { resetFakeRedis } from '../../test/fake-redis.js'
import { signAccessToken } from '../jwt.js'
import { attributeLead, attributeUser, attributionSnapshot, claimLeadAttribution } from './attribution.js'
import { clearAmbassadorSettingsCache } from './settings.js'
import type { AmbassadorDoc } from './types.js'

vi.mock('../lifecycle/events.js', () => ({ onLifecycleEvent: vi.fn().mockResolvedValue(undefined) }))

describeWithDb('ambassador referral funnel: applied, signed up, paid', () => {
  let payload: Payload
  let ambassador: AmbassadorDoc
  let other: AmbassadorDoc
  let leadSeq = 0

  beforeAll(async () => {
    payload = await getTestPayload()
  })

  beforeEach(async () => {
    await truncate(payload, [...AMBASSADOR_TABLES, 'leads', 'users', 'orders'])
    resetFakeRedis()
    clearAmbassadorSettingsCache()
    await payload.updateGlobal({ slug: 'ambassador-settings', data: { attributionModel: 'first_click', attributionLifetimeDays: null, showReferredEmails: true }, overrideAccess: true })
    ambassador = await createTestAmbassador(payload)
    other = await createTestAmbassador(payload)
  })

  const link = (amb: AmbassadorDoc = ambassador) => `code:${amb.code}`

  async function createLead(email: string, firstName = 'Chiamaka'): Promise<number> {
    leadSeq += 1
    const lead = await payload.create({
      collection: 'leads',
      data: { firstName, email, phone: `+23481800000${String(leadSeq).padStart(2, '0')}`, source: 'apply', status: 'new' },
      depth: 0,
      overrideAccess: true,
    })
    return Number(lead.id)
  }

  async function signUp(email: string, firstName = 'Chiamaka'): Promise<number> {
    return (await createTestUser(payload, { email, firstName })).id
  }

  async function pay(userId: number): Promise<void> {
    await payload.create({
      collection: 'orders',
      data: { user: userId, type: 'course', amount: 25_000, currency: 'NGN', status: 'success', reference: `FUNNEL-${userId}-${Date.now()}`, paidAt: new Date().toISOString() },
      overrideAccess: true,
    })
  }

  async function portal(path: string, amb: AmbassadorDoc = ambassador): Promise<{ data: unknown; meta?: { total?: number } }> {
    const { default: config } = await import('../../../payload.config.js')
    const response = await handleEndpoints({
      config,
      request: new Request(`http://localhost/api/ambassadors/${path}`, { headers: { authorization: `Bearer ${signAccessToken(Number(amb.user), 'student')}` } }),
    })
    expect(response.status, path).toBe(200)
    return (await response.json()) as { data: unknown; meta?: { total?: number } }
  }

  const segment = async (name: 'applicants' | 'prospects' | 'customers') => {
    const body = await portal(`me/referrals?segment=${name}`)
    return { rows: body.data as Array<Record<string, unknown>>, total: body.meta?.total }
  }
  const totals = async () => ((await portal('me/summary')).data as { totals: Record<string, number> }).totals

  it('someone who only applied shows as an applicant, with their programme-ready details', async () => {
    const leadId = await createLead('chiamaka@example.test')
    expect(await attributeLead(payload, { leadId, value: link() })).toEqual({ attributed: true })

    const applicants = await segment('applicants')
    expect(applicants.total).toBe(1)
    expect(applicants.rows[0]).toMatchObject({ stage: 'applied', name: 'Chiamaka', email: 'chiamaka@example.test', joinedAt: null, paidOrders: 0 })
    expect((await segment('prospects')).total).toBe(0)
    expect(await totals()).toMatchObject({ applicants: 1, prospects: 0, customers: 0 })
  })

  it('moves from applied to signed up to paid as the person goes on', async () => {
    const leadId = await createLead('tunde@example.test', 'Tunde')
    await attributeLead(payload, { leadId, value: link() })

    const userId = await signUp('tunde@example.test', 'Tunde')
    expect(await claimLeadAttribution(payload, userId)).toBe(true)
    expect(await totals()).toMatchObject({ applicants: 0, prospects: 1, customers: 0 })
    expect((await segment('prospects')).rows[0]).toMatchObject({ stage: 'signed_up', name: 'Tunde U.' })

    await pay(userId)
    expect(await totals()).toMatchObject({ applicants: 0, prospects: 0, customers: 1 })
    expect((await segment('customers')).rows[0]).toMatchObject({ stage: 'paid', paidOrders: 1 })
    expect(await attributionSnapshot(payload, userId)).toMatchObject({ ambassadorId: ambassador.id })
  })

  it('first touch wins: an applicant who later signs up through another link stays with the first ambassador', async () => {
    const leadId = await createLead('ada@example.test', 'Ada')
    await attributeLead(payload, { leadId, value: link(ambassador) })
    const userId = await signUp('ada@example.test', 'Ada')
    await claimLeadAttribution(payload, userId)
    expect(await attributeUser(payload, { userId, value: link(other), source: 'cookie_register' })).toMatchObject({ reason: 'already_attributed' })
    expect(await attributionSnapshot(payload, userId)).toMatchObject({ ambassadorId: ambassador.id })
  })

  it('a checkout picks up an application attribution that sign-up missed', async () => {
    const leadId = await createLead('bola@example.test', 'Bola')
    await attributeLead(payload, { leadId, value: link() })
    const userId = await signUp('bola@example.test', 'Bola')
    expect(await attributionSnapshot(payload, userId)).toMatchObject({ ambassadorId: ambassador.id })
  })

  it('someone who already has an account and applies through a link is attributed as signed up', async () => {
    const userId = await signUp('kemi@example.test', 'Kemi')
    const leadId = await createLead('kemi@example.test', 'Kemi')
    expect(await attributeLead(payload, { leadId, value: link() })).toEqual({ attributed: true })
    expect(await totals()).toMatchObject({ applicants: 0, prospects: 1 })
    expect(await attributionSnapshot(payload, userId)).toMatchObject({ ambassadorId: ambassador.id })
  })

  it('an ambassador applying through their own link is not attributed', async () => {
    const owner = await payload.findByID({ collection: 'users', id: Number(ambassador.user), depth: 0, overrideAccess: true })
    const leadId = await createLead(String(owner.email))
    expect(await attributeLead(payload, { leadId, value: link() })).toMatchObject({ attributed: false, reason: 'self_referral' })
    expect(await totals()).toMatchObject({ applicants: 0 })
  })

  it('applying twice through different links keeps the first; WhatsApp-only applications show no email', async () => {
    const leadId = await createLead('wa-abc@whatsapp.invalid', 'Musa')
    await attributeLead(payload, { leadId, value: link(ambassador) })
    expect(await attributeLead(payload, { leadId, value: link(other) })).toMatchObject({ reason: 'already_attributed' })
    const row = (await segment('applicants')).rows[0]!
    expect(row.name).toBe('Musa')
    expect(row).not.toHaveProperty('email')
  })

  it('hides emails when the setting is off', async () => {
    await payload.updateGlobal({ slug: 'ambassador-settings', data: { showReferredEmails: false }, overrideAccess: true })
    clearAmbassadorSettingsCache()
    const leadId = await createLead('private@example.test', 'Ngozi')
    await attributeLead(payload, { leadId, value: link() })
    expect((await segment('applicants')).rows[0]).not.toHaveProperty('email')
  })
})
