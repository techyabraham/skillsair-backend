import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleEndpoints, type Payload, type PayloadRequest } from 'payload'
import { AMBASSADOR_TABLES, createTestUser, describeWithDb, getTestPayload, truncate } from '../../test/payload-harness.js'
import { createTestAmbassador } from '../../test/ambassador-fixtures.js'
import { signAccessToken } from '../jwt.js'
import { AppError } from '../../types/index.js'
import { loadAmbassadorForUser, requireAdmin, requireAmbassador } from './access.js'

describeWithDb('ambassador access', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getTestPayload()
  })

  beforeEach(async () => {
    await truncate(payload, [...AMBASSADOR_TABLES, 'users'])
  })

  function reqFor(token?: string, user: PayloadRequest['user'] = null): PayloadRequest {
    const headers = new Headers(token ? { authorization: `Bearer ${token}` } : {})
    return { headers, payload, user, url: 'http://localhost/test' } as unknown as PayloadRequest
  }

  async function reasonOf(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      const appError = err as AppError
      expect(appError.code).toBe('INSUFFICIENT_PERMISSION')
      return appError.fields?.reason
    }
    throw new Error('expected a denial')
  }

  describe('requireAmbassador / loadAmbassadorForUser', () => {
    it('needs a signed-in user', async () => {
      await expect(requireAmbassador(reqFor())).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    })

    it('denies a user with no ambassador record (not_ambassador); loadAmbassadorForUser returns null', async () => {
      const user = await createTestUser(payload)
      const req = reqFor(signAccessToken(user.id, 'student'))
      expect(await reasonOf(requireAmbassador(req))).toBe('not_ambassador')
      expect((await loadAmbassadorForUser(req)).ambassador).toBeNull()
    })

    it('reports pending, blocked and email_unverified', async () => {
      const pending = await createTestAmbassador(payload, { status: 'pending' })
      const blocked = await createTestAmbassador(payload, { status: 'blocked' })
      const selfUser = await createTestUser(payload)
      await payload.create({
        collection: 'ambassadors',
        data: { user: selfUser.id, code: 'SELF0001', username: 'self_applicant', status: 'active', source: 'self' },
        overrideAccess: true,
      })
      const tokenOf = (ambassador: { user: unknown }) => signAccessToken(Number(ambassador.user), 'student')
      expect(await reasonOf(requireAmbassador(reqFor(tokenOf(pending))))).toBe('pending')
      expect(await reasonOf(requireAmbassador(reqFor(tokenOf(blocked))))).toBe('blocked')
      expect(await reasonOf(requireAmbassador(reqFor(signAccessToken(selfUser.id, 'student'))))).toBe('email_unverified')
      // Any status loads for the status screen.
      expect((await loadAmbassadorForUser(reqFor(tokenOf(blocked)))).ambassador?.status).toBe('blocked')
    })

    it('lets an active ambassador in', async () => {
      const ambassador = await createTestAmbassador(payload, { status: 'active' })
      const { user, ambassador: loaded } = await requireAmbassador(reqFor(signAccessToken(Number(ambassador.user), 'student')))
      expect(user.id).toBe(Number(ambassador.user))
      expect(loaded.id).toBe(ambassador.id)
    })
  })

  describe('requireAdmin', () => {
    it('accepts an admin from the Payload session or the app JWT', async () => {
      const admin = await createTestUser(payload, { role: 'admin' })
      expect((await requireAdmin(reqFor(undefined, { id: admin.id, email: admin.email, role: 'admin' } as unknown as PayloadRequest['user']))).id).toBe(admin.id)
      expect((await requireAdmin(reqFor(signAccessToken(admin.id, 'admin')))).id).toBe(admin.id)
    })

    it('refuses students and anonymous requests', async () => {
      const student = await createTestUser(payload)
      await expect(requireAdmin(reqFor(signAccessToken(student.id, 'student')))).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSION' })
      await expect(requireAdmin(reqFor(undefined, { id: student.id, role: 'student' } as unknown as PayloadRequest['user']))).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSION' })
      await expect(requireAdmin(reqFor())).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    })
  })

  describe('collections through the REST API', () => {
    async function call(method: string, path: string, authorization?: string, body?: unknown): Promise<Response> {
      const { default: config } = await import('../../../payload.config.js')
      const request = new Request(`http://localhost/api/${path}`, {
        method,
        headers: { ...(authorization ? { authorization } : {}), 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      return handleEndpoints({ config, request })
    }

    async function payloadToken(email: string, password: string): Promise<string> {
      const { token } = await payload.login({ collection: 'users', data: { email, password } })
      return `JWT ${token}`
    }

    it('students cannot read or write any ambassador collection', async () => {
      const student = await createTestUser(payload)
      const ambassador = await createTestAmbassador(payload, { userId: student.id })
      const auth = await payloadToken(student.email, student.password)
      for (const slug of ['ambassadors', 'ambassador-bank-accounts', 'ambassador-ledger', 'ambassador-payouts', 'ambassador-audit-log', 'referral-clicks', 'referral-attributions']) {
        expect((await call('GET', slug, auth)).status, slug).toBe(403)
      }
      expect((await call('GET', `ambassadors/${ambassador.id}`, auth)).status).toBe(403)
      expect((await call('PATCH', `ambassadors/${ambassador.id}`, auth, { status: 'active' })).status).toBe(403)
      expect((await call('GET', 'globals/ambassador-settings', auth)).status).toBe(403)
      expect((await call('GET', 'ambassadors', `Bearer ${signAccessToken(student.id, 'student')}`)).status).toBe(403)
    })

    it('admins can read and edit ambassadors and the settings', async () => {
      const admin = await createTestUser(payload, { role: 'admin' })
      const ambassador = await createTestAmbassador(payload, { status: 'pending' })
      const auth = await payloadToken(admin.email, admin.password)
      expect((await call('GET', 'ambassadors', auth)).status).toBe(200)
      expect((await call('PATCH', `ambassadors/${ambassador.id}`, auth, { status: 'active' })).status).toBe(200)
      const settings = await call('GET', 'globals/ambassador-settings', auth)
      expect(settings.status).toBe(200)
      expect((await call('GET', 'ambassadors', `Bearer ${signAccessToken(admin.id, 'admin')}`)).status).toBe(200)
    })

    it('nobody, admins included, can create, update or delete ledger, payout or audit rows through the API', async () => {
      const admin = await createTestUser(payload, { role: 'admin' })
      const ambassador = await createTestAmbassador(payload)
      const auth = await payloadToken(admin.email, admin.password)
      const ledgerBody = { ambassador: ambassador.id, type: 'adjustment', status: 'approved', amountKobo: 100, idempotencyKey: 'adjustment:3b241101-e2bb-4255-8caf-4136c566a962' }
      expect((await call('POST', 'ambassador-ledger', auth, ledgerBody)).status).toBe(403)
      expect((await call('POST', 'ambassador-payouts', auth, { ambassador: ambassador.id, amountKobo: 100 })).status).toBe(403)
      expect((await call('POST', 'ambassador-audit-log', auth, { action: 'x' })).status).toBe(403)

      const audit = await payload.create({ collection: 'ambassador-audit-log', data: { action: 'test' }, overrideAccess: true })
      expect((await call('PATCH', `ambassador-audit-log/${audit.id}`, auth, { action: 'changed' })).status).toBe(403)
      expect((await call('DELETE', `ambassador-audit-log/${audit.id}`, auth)).status).toBe(403)
      expect((await call('GET', `ambassador-audit-log/${audit.id}`, auth)).status).toBe(200)
    })
  })
})
