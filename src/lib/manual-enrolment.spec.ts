import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { createTestUser, describeWithDb, getTestPayload, truncate } from '../test/payload-harness.js'
import { resetFakeRedis } from '../test/fake-redis.js'
import { accessEndFrom, manualEnrol, nameFromEmail, sendManualEnrolmentEmail, type ManualEnrolmentInput } from './manual-enrolment.js'
import { MANUAL_ENROLLMENT_REF, ownsCourseOutright, requireCourseAccess } from './course-access.js'
import { fulfillOrder } from './order-fulfillment.js'
import { onLifecycleEvent } from './lifecycle/events.js'
import { loadPerson } from './lifecycle/context.js'
import { computeStages } from './lifecycle/stage.js'
import { getPasswordResetUserId } from './redis.js'
import { hashToken } from '../utils/generate-code.js'
import { sendEmail } from './resend.js'
import { enqueue } from './work-queue.js'

vi.mock('./resend.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./resend.js')>()), sendEmail: vi.fn().mockResolvedValue('test-email') }))
vi.mock('./work-queue.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./work-queue.js')>()), enqueue: vi.fn().mockResolvedValue('task') }))

const DAY = 86_400_000
const noWindow = { open: false, opensAt: null, closesAt: null, lastClosedAt: null }

describeWithDb('manual enrolment from Studio', () => {
  let payload: Payload
  let adminId: number
  let courseId: number
  let planId: number
  let serial = 0

  const input = (emails: string[], over: Partial<ManualEnrolmentInput> = {}): ManualEnrolmentInput => ({ emails, courseId, duration: { unit: 'months', amount: 3 }, notify: true, adminId, ...over })
  const addr = (name: string) => `${name}-${++serial}@example.com`
  const userByEmail = async (email: string) => (await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 5, depth: 0, overrideAccess: true })).docs
  const enrolments = async (student: number) => (await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: student } }, { course: { equals: courseId } }] }, depth: 0, overrideAccess: true })).docs
  const extensions = async (student: number) => (await payload.find({ collection: 'access-extensions', where: { student: { equals: student } }, sort: '-newExpiryDate', depth: 0, overrideAccess: true })).docs
  const setEnd = async (id: number | string, at: number) => {
    await payload.db.drizzle.execute(`UPDATE access_extensions SET new_expiry_date = '${new Date(at).toISOString()}' WHERE id = ${Number(id)}`)
  }
  const access = (student: number) => requireCourseAccess(payload, student, courseId)
  const subscribe = async (user: number, data: Record<string, unknown>) => payload.create({
    collection: 'subscriptions',
    data: { user, plan: planId, course: courseId, status: 'active', billing: 'card', currentPeriodStart: new Date().toISOString(), currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(), initialOrderReference: `sub-${++serial}`, ...data } as never,
    overrideAccess: true,
  })

  beforeAll(async () => { payload = await getTestPayload() })
  beforeEach(async () => {
    await truncate(payload, ['access_extensions', 'enrollments', 'subscriptions', 'orders', 'plans', 'courses', 'users'])
    resetFakeRedis()
    vi.mocked(sendEmail).mockClear()
    vi.mocked(enqueue).mockClear()
    adminId = (await createTestUser(payload)).id
    const course = await payload.create({ collection: 'courses', data: { title: 'Data Analysis', slug: `data-${++serial}`, status: 'published', price: 50000 } as never, overrideAccess: true, context: { skipCache: true } })
    courseId = Number(course.id)
    const plan = await payload.create({ collection: 'plans', data: { name: 'Monthly', course: courseId, price: 2000, interval: 'monthly', kind: 'standard', paystackPlanCode: `PLN_${serial}` } as never, overrideAccess: true })
    planId = Number(plan.id)
  })

  it('handles a mixed list: new, existing, invalid, duplicate, and no order or subscription', async () => {
    const fresh = addr('fresh')
    const existing = await createTestUser(payload)
    const results = await manualEnrol(payload, input([fresh, existing.email, 'not-an-email', fresh.toUpperCase()]))
    expect(results.map((r) => r.status)).toEqual(['created', 'enrolled', 'failed', 'skipped'])
    const [user] = await userByEmail(fresh)
    await expect(access(Number(user!.id))).resolves.toBeUndefined()
    await expect(access(existing.id)).resolves.toBeUndefined()
    expect((await enrolments(Number(user!.id)))[0]).toMatchObject({ orderId: MANUAL_ENROLLMENT_REF, status: 'active' })
    expect((await enrolments(Number(user!.id)))[0]!.planStartedAt).toBeTruthy()
    expect((await extensions(existing.id))[0]).toMatchObject({ extendedBy: adminId, reason: 'Admin enrolment: 3 months' })
    expect((await payload.count({ collection: 'orders', overrideAccess: true })).totalDocs).toBe(0)
    expect((await payload.count({ collection: 'subscriptions', overrideAccess: true })).totalDocs).toBe(0)
    expect(vi.mocked(enqueue)).toHaveBeenCalledTimes(2)
  })

  it('running the same list twice changes nothing the second time', async () => {
    const fresh = addr('twice')
    await manualEnrol(payload, input([fresh]))
    const again = await manualEnrol(payload, input([fresh]))
    expect(again[0]!.status).toBe('skipped')
    const users = await userByEmail(fresh)
    expect(users).toHaveLength(1)
    expect(await enrolments(Number(users[0]!.id))).toHaveLength(1)
    expect(await extensions(Number(users[0]!.id))).toHaveLength(1)
  })

  it('months and days end at the right time, and access stops there', async () => {
    const days = await createTestUser(payload)
    const before = Date.now()
    const [result] = await manualEnrol(payload, input([days.email], { duration: { unit: 'days', amount: 10 } }))
    const end = Date.parse(result!.accessEndsAt!)
    expect(end).toBeGreaterThanOrEqual(before + 10 * DAY)
    expect(end).toBeLessThan(before + 10 * DAY + 60_000)

    const months = await createTestUser(payload)
    const [monthly] = await manualEnrol(payload, input([months.email], { duration: { unit: 'months', amount: 2 } }))
    expect(monthly!.accessEndsAt!.slice(0, 7)).toBe(accessEndFrom(new Date(), { unit: 'months', amount: 2 }).toISOString().slice(0, 7))
    expect(accessEndFrom(new Date('2027-01-31T10:00:00Z'), { unit: 'months', amount: 1 }).toISOString()).toBe('2027-02-28T10:00:00.000Z')

    const extension = (await extensions(days.id))[0]!
    await setEnd(extension.id, Date.now() + 2000)
    await expect(access(days.id)).resolves.toBeUndefined()
    await setEnd(extension.id, Date.now() - 1000)
    await expect(access(days.id)).rejects.toMatchObject({ code: 'ACCESS_EXPIRED' })
  })

  it('adds time on top of what an enrolled learner already has', async () => {
    const user = await createTestUser(payload)
    const [first] = await manualEnrol(payload, input([user.email], { duration: { unit: 'days', amount: 10 } }))
    const [second] = await manualEnrol(payload, input([user.email], { duration: { unit: 'days', amount: 5 } }))
    expect(second!.status).toBe('extended')
    expect(Date.parse(second!.accessEndsAt!)).toBe(Date.parse(first!.accessEndsAt!) + 5 * DAY)
    expect(await enrolments(user.id)).toHaveLength(1)
  })

  it('leaves paying learners and permanent access alone, and revives a lapsed plan', async () => {
    const paying = await createTestUser(payload)
    const sub = await subscribe(paying.id, {})
    await payload.create({ collection: 'enrollments', data: { student: paying.id, course: courseId, status: 'active', orderId: 'pay-1', subscription: sub.id }, overrideAccess: true })
    const owner = await createTestUser(payload)
    await payload.create({ collection: 'enrollments', data: { student: owner.id, course: courseId, status: 'active', orderId: 'pay-2' }, overrideAccess: true })
    const lapsed = await createTestUser(payload)
    const old = await subscribe(lapsed.id, { status: 'expired', currentPeriodEnd: new Date(Date.now() - 40 * DAY).toISOString() })
    await payload.create({ collection: 'enrollments', data: { student: lapsed.id, course: courseId, status: 'active', orderId: 'pay-3', subscription: old.id }, overrideAccess: true })
    await expect(access(lapsed.id)).rejects.toMatchObject({ code: 'ACCESS_EXPIRED' })

    const results = await manualEnrol(payload, input([paying.email, owner.email, lapsed.email]))
    expect(results.map((r) => r.status)).toEqual(['skipped', 'skipped', 'extended'])
    expect(results[0]!.message).toContain('paid plan')
    expect(await extensions(paying.id)).toHaveLength(0)
    expect(await extensions(owner.id)).toHaveLength(0)
    await expect(access(owner.id)).resolves.toBeUndefined()
    await expect(access(lapsed.id)).resolves.toBeUndefined()
  })

  it('a learner can still pay once given access, and paying takes over', async () => {
    const user = await createTestUser(payload)
    await manualEnrol(payload, input([user.email], { duration: { unit: 'days', amount: 1 } }))
    expect(ownsCourseOutright((await enrolments(user.id))[0] as Record<string, unknown>)).toBe(false)
    const extension = (await extensions(user.id))[0]!
    await setEnd(extension.id, Date.now() - 1000)
    const order = await payload.create({ collection: 'orders', data: { user: user.id, type: 'course', course: courseId, amount: 50000, currency: 'NGN', reference: `ref-${++serial}`, status: 'success', paidAt: new Date().toISOString() } as never, overrideAccess: true })
    await fulfillOrder(payload, order.id)
    await expect(access(user.id)).resolves.toBeUndefined()
    expect(ownsCourseOutright((await enrolments(user.id))[0] as Record<string, unknown>)).toBe(true)
  })

  it('no win-back while access is extended, and a new account can set its password', async () => {
    const fresh = addr('newbie')
    await manualEnrol(payload, input([fresh]))
    const [user] = await userByEmail(fresh)
    const id = Number(user!.id)
    const person = await loadPerson(payload, { type: 'user', id })
    const tracks = computeStages(person!.snapshot, noWindow, Date.now()).map((stage) => stage.track)
    expect(tracks).toEqual([])
    const cycle = async () => Number((await enrolments(id))[0]!.lifecycleCycle ?? 0)
    await onLifecycleEvent(payload, { type: 'access_ended', userId: id, courseId, reason: 'lapsed' })
    expect(await cycle()).toBe(0)

    const task = vi.mocked(enqueue).mock.calls[0]![1] as never
    await sendManualEnrolmentEmail(payload, task)
    const [, email] = vi.mocked(sendEmail).mock.calls[0]!
    const token = /reset-password\?token=([\w-]+)/.exec(email.text ?? '')![1]!
    expect(await getPasswordResetUserId(hashToken(token))).toBe(id)
    await payload.update({ collection: 'users', id, data: { password: 'NewPass1!word' }, overrideAccess: true })
    await expect(payload.login({ collection: 'users', data: { email: fresh, password: 'NewPass1!word' } })).resolves.toMatchObject({ user: { email: fresh } })
  })

  it('names new accounts from the address', () => {
    expect(nameFromEmail('ada.obi@x.com')).toEqual({ firstName: 'Ada', lastName: 'Obi' })
    expect(nameFromEmail('123@x.com')).toEqual({ firstName: 'Learner', lastName: 'Learner' })
  })
})
