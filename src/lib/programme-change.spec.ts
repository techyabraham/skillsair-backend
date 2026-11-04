import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { createTestUser, describeWithDb, getTestPayload, truncate } from '../test/payload-harness.js'
import { resetFakeRedis } from '../test/fake-redis.js'
import { manualEnrol, type ManualEnrolmentInput } from './manual-enrolment.js'
import { changeProgramme, type ProgrammeChangeInput } from './programme-change.js'
import { requireCourseAccess } from './course-access.js'

vi.mock('./resend.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./resend.js')>()), sendEmail: vi.fn().mockResolvedValue('test-email') }))
vi.mock('./work-queue.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./work-queue.js')>()), enqueue: vi.fn().mockResolvedValue('task') }))

const DAY = 86_400_000

describeWithDb('changing a learner’s programme from Studio', () => {
  let payload: Payload
  let adminId: number
  let fromId: number
  let toId: number
  let planId: number
  let serial = 0

  const course = async (title: string, data: Record<string, unknown> = {}) =>
    Number((await payload.create({ collection: 'courses', data: { title, slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${++serial}`, status: 'published', price: 50000, ...data } as never, overrideAccess: true, context: { skipCache: true } })).id)
  const enrol = (entries: ManualEnrolmentInput['entries'], over: Partial<ManualEnrolmentInput> = {}) =>
    manualEnrol(payload, { entries, duration: { unit: 'months', amount: 3 }, notify: false, adminId, ...over })
  const move = (emails: string[], over: Partial<ProgrammeChangeInput> = {}) => changeProgramme(payload, { emails, fromCourseId: fromId, toCourseId: toId, adminId, ...over })
  const enrolments = async (student: number) => (await payload.find({ collection: 'enrollments', where: { student: { equals: student } }, depth: 0, overrideAccess: true })).docs
  const extensions = async (student: number, courseId: number) =>
    (await payload.find({ collection: 'access-extensions', where: { and: [{ student: { equals: student } }, { course: { equals: courseId } }] }, sort: '-newExpiryDate', depth: 0, overrideAccess: true })).docs

  beforeAll(async () => { payload = await getTestPayload() })
  beforeEach(async () => {
    await truncate(payload, ['access_extensions', 'certificate_entitlements', 'enrollments', 'subscriptions', 'orders', 'plans', 'courses', 'users'])
    resetFakeRedis()
    adminId = (await createTestUser(payload)).id
    fromId = await course('Data Analysis')
    toId = await course('UI UX')
    planId = Number((await payload.create({ collection: 'plans', data: { name: 'Monthly', course: fromId, price: 2000, interval: 'monthly', kind: 'standard', paystackPlanCode: `PLN_${serial}` } as never, overrideAccess: true })).id)
  })

  it('moves a Studio enrolment with its remaining time, and the old programme closes', async () => {
    const user = await createTestUser(payload)
    await enrol([{ email: user.email, courseIds: [fromId] }])
    const endsAt = (await extensions(user.id, fromId))[0]!.newExpiryDate
    await payload.update({ collection: 'enrollments', where: { student: { equals: user.id } }, data: { progressPercent: 40 }, overrideAccess: true })

    const [result] = await move([user.email.toUpperCase()], { note: 'asked to switch' })
    expect(result).toMatchObject({ status: 'changed' })
    expect(result!.message).toContain('Moved to UI UX')

    const [enrollment, ...others] = await enrolments(user.id)
    expect(others).toHaveLength(0)
    expect(enrollment).toMatchObject({ course: toId, status: 'active', progressPercent: 0 })
    const carried = (await extensions(user.id, toId))[0]!
    expect(carried).toMatchObject({ newExpiryDate: endsAt, extendedBy: adminId, reason: 'Programme changed from Data Analysis to UI UX (asked to switch)' })
    expect(await extensions(user.id, fromId)).toHaveLength(1)
    await expect(requireCourseAccess(payload, user.id, toId)).resolves.toBeUndefined()
    await expect(requireCourseAccess(payload, user.id, fromId)).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSION' })
  })

  it('moves a paid monthly plan so renewals and the price lock follow the learner', async () => {
    const user = await createTestUser(payload)
    const subscription = await payload.create({
      collection: 'subscriptions',
      data: { user: user.id, plan: planId, course: fromId, status: 'active', billing: 'card', priceLocked: true, currentPeriodStart: new Date().toISOString(), currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(), initialOrderReference: `sub-${++serial}` } as never,
      overrideAccess: true,
    })
    await payload.create({ collection: 'enrollments', data: { student: user.id, course: fromId, status: 'active', orderId: 'pay-1', subscription: subscription.id }, overrideAccess: true })

    const [result] = await move([user.email])
    expect(result!.status).toBe('changed')
    expect(result!.message).toContain('plan and payments carry over')
    const moved = await payload.findByID({ collection: 'subscriptions', id: subscription.id, depth: 0, overrideAccess: true })
    expect(moved).toMatchObject({ course: toId, priceLocked: true, status: 'active' })
    await expect(requireCourseAccess(payload, user.id, toId)).resolves.toBeUndefined()
    expect(await extensions(user.id, toId)).toHaveLength(0)
  })

  it('leaves alone anyone it shouldn’t move, and reports each one', async () => {
    const finished = await createTestUser(payload)
    await payload.create({ collection: 'enrollments', data: { student: finished.id, course: fromId, status: 'completed', orderId: 'pay-2' }, overrideAccess: true })
    const certificate = await createTestUser(payload)
    await payload.create({ collection: 'enrollments', data: { student: certificate.id, course: fromId, status: 'active', orderId: 'pay-3' }, overrideAccess: true })
    await payload.create({ collection: 'certificate-entitlements', data: { student: certificate.id, course: fromId, status: 'awaiting_exam' } as never, overrideAccess: true })
    const both = await createTestUser(payload)
    await enrol([{ email: both.email, courseIds: [fromId, toId] }])
    const elsewhere = await createTestUser(payload)

    const results = await move([finished.email, certificate.email, both.email, elsewhere.email, 'nobody@example.com', 'not-an-email', finished.email])
    expect(results.map((r) => r.status)).toEqual(['skipped', 'skipped', 'skipped', 'skipped', 'failed', 'failed', 'skipped'])
    expect(results[0]!.message).toContain('Finished Data Analysis')
    expect(results[1]!.message).toContain('certificate')
    expect(results[2]!.message).toContain('Already enrolled on UI UX')
    expect(results[3]!.message).toContain('Not enrolled on Data Analysis')
    expect((await enrolments(both.id)).map((doc) => doc.course).sort()).toEqual([fromId, toId].sort())
  })

  it('re-enrolling on the old programme after a move starts from today', async () => {
    const user = await createTestUser(payload)
    await enrol([{ email: user.email, courseIds: [fromId] }], { duration: { unit: 'months', amount: 6 } })
    await move([user.email])
    const before = Date.now()
    const [again] = await enrol([{ email: user.email, courseIds: [fromId] }], { duration: { unit: 'days', amount: 10 }, note: 'back again' })
    expect(again!.status).toBe('enrolled')
    expect(Date.parse(again!.accessEndsAt!)).toBeLessThan(before + 10 * DAY + 60_000)
  })

  it('refuses the same programme twice, and a bonus course', async () => {
    await expect(move(['a@example.com'], { toCourseId: fromId })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const bonus = await course('CV and LinkedIn', { isBonus: true })
    await expect(move(['a@example.com'], { toCourseId: bonus })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

describeWithDb('enrolling learners on different and several programmes', () => {
  let payload: Payload
  let adminId: number
  let serial = 0

  const course = async (title: string, data: Record<string, unknown> = {}) =>
    Number((await payload.create({ collection: 'courses', data: { title, slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${++serial}`, status: 'published', price: 50000, ...data } as never, overrideAccess: true, context: { skipCache: true } })).id)

  beforeAll(async () => { payload = await getTestPayload() })
  beforeEach(async () => {
    await truncate(payload, ['access_extensions', 'enrollments', 'subscriptions', 'orders', 'plans', 'courses', 'users'])
    resetFakeRedis()
    adminId = (await createTestUser(payload)).id
  })

  it('gives each learner their own programmes, creates each account once, and reports per programme', async () => {
    const data = await course('Data Analysis')
    const design = await course('UI UX')
    const draft = await course('Coming Soon', { status: 'draft' })
    const results = await manualEnrol(payload, {
      entries: [
        { email: 'ada@example.com', courseIds: [data, design] },
        { email: 'tobi@example.com', courseIds: [design] },
        { email: 'ADA@example.com', courseIds: [data, draft] },
        { email: 'kemi@example.com', courseIds: [] },
      ],
      duration: { unit: 'months', amount: 2 },
      notify: false,
      adminId,
    })
    expect(results.map((r) => [r.email, r.programme ?? null, r.status])).toEqual([
      ['ada@example.com', 'Data Analysis', 'created'],
      ['ada@example.com', 'UI UX', 'enrolled'],
      ['tobi@example.com', 'UI UX', 'created'],
      ['ada@example.com', 'Data Analysis', 'skipped'],
      ['ada@example.com', null, 'failed'],
      ['kemi@example.com', null, 'failed'],
    ])
    const ada = (await payload.find({ collection: 'users', where: { email: { equals: 'ada@example.com' } }, depth: 0, overrideAccess: true })).docs
    expect(ada).toHaveLength(1)
    await expect(requireCourseAccess(payload, Number(ada[0]!.id), data)).resolves.toBeUndefined()
    await expect(requireCourseAccess(payload, Number(ada[0]!.id), design)).resolves.toBeUndefined()
  })
})
