import { beforeAll, expect, it } from 'vitest'
import { handleEndpoints, type Payload } from 'payload'
import { createTestUser, describeWithDb, getTestPayload, truncate } from '../test/payload-harness.js'
import { signAccessToken } from '../lib/jwt.js'

describeWithDb('PATCH /api/affiliates/:id', () => {
  let payload: Payload
  let student: { id: number; email: string; password: string }
  let affiliateId: number

  beforeAll(async () => {
    payload = await getTestPayload()
    await truncate(payload, ['users', 'affiliates'])
    // Student first (user id 1), then another user whose affiliate record also gets id 1.
    student = await createTestUser(payload)
    const other = await createTestUser(payload)
    const affiliate = await payload.create({
      collection: 'affiliates',
      data: { user: other.id, affiliateCode: 'AFFTEST1', isApproved: true },
      overrideAccess: true,
    })
    affiliateId = Number(affiliate.id)
    expect(affiliateId).toBe(student.id)
  })

  async function patch(authorization: string): Promise<Response> {
    const { default: config } = await import('../../payload.config.js')
    const request = new Request(`http://localhost/api/affiliates/${affiliateId}`, {
      method: 'PATCH',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ accountNumber: '0123456789', commissionRate: 100 }),
    })
    return handleEndpoints({ config, request })
  }

  it('a student signed in through Payload gets 403, even when the id equals their user id', async () => {
    const { token } = await payload.login({ collection: 'users', data: { email: student.email, password: student.password } })
    expect(token).toBeTruthy()
    const response = await patch(`JWT ${token}`)
    expect(response.status).toBe(403)
  })

  it('a student with the app (custom JWT) token gets 403 too', async () => {
    const response = await patch(`Bearer ${signAccessToken(student.id, 'student')}`)
    expect(response.status).toBe(403)
  })

  it('the record is unchanged', async () => {
    const doc = await payload.findByID({ collection: 'affiliates', id: affiliateId, overrideAccess: true })
    expect(doc.commissionRate).toBe(10)
    expect(doc.accountNumber ?? null).toBeNull()
  })
})
