import { beforeAll, beforeEach, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { AMBASSADOR_TABLES, createTestUser, describeWithDb, getTestPayload, truncate } from '../../test/payload-harness.js'
import { writeAudit } from './audit.js'

describeWithDb('writeAudit', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getTestPayload()
  })

  beforeEach(async () => {
    await truncate(payload, [...AMBASSADOR_TABLES, 'users'])
  })

  it('records who did what to which record, before and after', async () => {
    const admin = await createTestUser(payload, { role: 'admin' })
    const row = await writeAudit(payload, {
      actorId: admin.id,
      action: 'ambassador.approve',
      targetCollection: 'ambassadors',
      targetId: 12,
      before: { status: 'pending' },
      after: { status: 'active' },
      ip: '203.0.113.7',
    })
    const stored = await payload.findByID({ collection: 'ambassador-audit-log', id: row.id, depth: 0, overrideAccess: true })
    expect(stored).toMatchObject({ actor: admin.id, action: 'ambassador.approve', targetCollection: 'ambassadors', targetId: '12', ip: '203.0.113.7' })
    expect(stored.before).toEqual({ status: 'pending' })
    expect(stored.after).toEqual({ status: 'active' })
  })

  it('never stores a full account number', async () => {
    const row = await writeAudit(payload, {
      actorId: null,
      action: 'bank_account.reveal',
      targetCollection: 'ambassador-bank-accounts',
      targetId: 3,
      after: { bank: { accountNumber: '0123456789', bankName: 'Test Bank' } },
    })
    expect(JSON.stringify(row.after)).not.toContain('0123456789')
    expect(row.after).toEqual({ bank: { accountNumber: '******6789', bankName: 'Test Bank' } })
  })
})
