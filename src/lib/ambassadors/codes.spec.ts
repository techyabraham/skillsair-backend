import { beforeAll, beforeEach, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { AMBASSADOR_TABLES, createTestUser, describeWithDb, getTestPayload, truncate } from '../../test/payload-harness.js'
import { createTestAmbassador } from '../../test/ambassador-fixtures.js'
import { generateUniqueAmbassadorCode } from './codes.js'

describeWithDb('generateUniqueAmbassadorCode', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getTestPayload()
  })

  beforeEach(async () => {
    await truncate(payload, [...AMBASSADOR_TABLES, 'users'])
  })

  it('returns an 8-character code from generateReferralCode', async () => {
    expect(await generateUniqueAmbassadorCode(payload)).toMatch(/^[A-Z0-9]{8}$/)
  })

  it('skips codes held by an ambassador or by a user (legacy users.referralCode)', async () => {
    await createTestAmbassador(payload, { code: 'AAAAAAAA' })
    await payload.create({
      collection: 'users',
      data: { email: 'legacy@example.test', password: 'Test-password-1!', firstName: 'L', lastName: 'U', referralCode: 'BBBBBBBB' },
      overrideAccess: true,
      context: { skipWelcomeEmail: true },
    })
    const candidates = ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC']
    const code = await generateUniqueAmbassadorCode(payload, () => candidates.shift() ?? 'ZZZZZZZZ')
    expect(code).toBe('CCCCCCCC')
  })

  it('gives up after 10 attempts', async () => {
    const user = await createTestUser(payload)
    await createTestAmbassador(payload, { code: 'DDDDDDDD', userId: user.id })
    let calls = 0
    await expect(generateUniqueAmbassadorCode(payload, () => { calls += 1; return 'DDDDDDDD' })).rejects.toThrow(/10 attempts/)
    expect(calls).toBe(10)
  })
})
