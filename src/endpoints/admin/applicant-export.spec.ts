import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload, PayloadRequest } from 'payload'
import { describeWithDb, getTestPayload, truncate } from '../../test/payload-harness.js'
import { resetFakeRedis } from '../../test/fake-redis.js'
import { applicantExportEndpoint, parseExportQuery } from './applicant-export.js'

describe('GET /api/studio/applicants/export query', () => {
  it('reads the filters, defaulting to a preview of everyone who hasn’t paid', () => {
    expect(parseExportQuery(new URLSearchParams(''))).toEqual({ format: 'preview', payment: 'unpaid', courseIds: [], statuses: [], from: undefined, to: undefined })
    expect(parseExportQuery(new URLSearchParams('format=xlsx&payment=all&course=3,4&status=new,lost&from=2026-11-01&to=2026-11-30'))).toMatchObject({
      format: 'xlsx', payment: 'all', courseIds: [3, 4], statuses: ['new', 'lost'], from: '2026-11-01', to: '2026-11-30',
    })
    expect(() => parseExportQuery(new URLSearchParams('format=pdf'))).toThrow()
    expect(() => parseExportQuery(new URLSearchParams('status=vip'))).toThrow()
    expect(() => parseExportQuery(new URLSearchParams('from=1st November'))).toThrow()
  })
})

describeWithDb('GET /api/studio/applicants/export', () => {
  let payload: Payload

  const get = (query: string, user: Record<string, unknown> | null = { id: 1, email: 'admin@example.com', role: 'admin' }) =>
    applicantExportEndpoint.handler({ payload, user, url: `http://localhost/api/studio/applicants/export?${query}`, headers: new Headers() } as unknown as PayloadRequest)

  beforeAll(async () => { payload = await getTestPayload() })
  beforeEach(async () => {
    await truncate(payload, ['leads', 'orders', 'enrollments', 'courses', 'users'])
    resetFakeRedis()
    const course = await payload.create({ collection: 'courses', data: { title: 'Cyber Security', slug: 'cyber-export', status: 'published', price: 50000 } as never, overrideAccess: true, context: { skipCache: true } })
    await payload.create({ collection: 'leads', data: { firstName: 'Ada', email: 'ada@example.com', phone: '+2348031234567', course: course.id, source: 'apply' } as never, overrideAccess: true })
  })

  it('is for admins only', async () => {
    expect((await get('format=csv', { id: 2, email: 'learner@example.com', role: 'student' })).status).toBe(403)
    expect((await get('format=csv', null)).status).toBe(401)
  })

  it('previews the count and downloads each format as an attachment', async () => {
    const preview = (await (await get('format=preview')).json()) as { data: { total: number; rows: Array<{ name: string; localPhone: string; programme: string }> } }
    expect(preview.data.total).toBe(1)
    expect(preview.data.rows[0]).toMatchObject({ name: 'Ada', localPhone: '08031234567', programme: 'Cyber Security' })

    const csv = await get('format=csv')
    expect(csv.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(csv.headers.get('Content-Disposition')).toMatch(/^attachment; filename="skillsair-applicants-not-paid-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(await csv.text()).toContain('Ada,+2348031234567,08031234567')

    const xlsx = await get('format=xlsx')
    expect(xlsx.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString()).toBe('PK')

    const text = await get('format=txt&payment=all')
    expect(await text.text()).toContain('Ada · 08031234567 · Cyber Security · New · not paid')
  })
})
