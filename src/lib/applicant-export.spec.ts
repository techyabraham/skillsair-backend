import { inflateRawSync } from 'node:zlib'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { createTestUser, describeWithDb, getTestPayload, truncate } from '../test/payload-harness.js'
import { resetFakeRedis } from '../test/fake-redis.js'
import { applicantsCsv, applicantsText, applicantsXlsx, collectApplicants, csvField, lagosDayStart, localPhone, whatsappLink, type ApplicantExportFilters, type ApplicantRow } from './applicant-export.js'

/** Reads the files out of a zip (stored or deflated) so the .xlsx can be checked without a library. */
function unzip(zip: Buffer): Map<string, string> {
  const files = new Map<string, string>()
  for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
    const method = zip.readUInt16LE(at + 8)
    const size = zip.readUInt32LE(at + 18)
    const nameLength = zip.readUInt16LE(at + 26)
    const extra = zip.readUInt16LE(at + 28)
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8')
    const data = zip.subarray(at + 30 + nameLength + extra, at + 30 + nameLength + extra + size)
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'))
    at += 30 + nameLength + extra + size
  }
  return files
}

const row = (over: Partial<ApplicantRow> = {}): ApplicantRow => ({
  kind: 'Applicant', id: 7, name: 'Ada Obi', phone: '+2348031234567', email: 'ada@example.com', programme: 'Data Analysis', status: 'New', paid: false,
  appliedAt: '2026-11-01T09:30:00.000Z', lastActivityAt: '', source: 'Apply', score: 40, optedOut: false, notes: 'Call after 5pm', ...over,
})

describe('applicant export files', () => {
  it('writes Nigerian numbers both ways, with a WhatsApp link', () => {
    expect(localPhone('+2348031234567')).toBe('08031234567')
    expect(localPhone('+447700900123')).toBe('+447700900123')
    expect(whatsappLink('+2348031234567')).toBe('https://wa.me/2348031234567')
    expect(lagosDayStart('2026-11-05')).toBe('2026-11-04T23:00:00.000Z')
    expect(lagosDayStart('2026-11-05', true)).toBe('2026-11-05T23:00:00.000Z')
  })

  it('keeps form text from running as a spreadsheet formula, but leaves phone numbers alone', () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvField('+2348031234567')).toBe('+2348031234567')
    expect(csvField('-1')).toBe("'-1")
    expect(csvField('Obi, Ada')).toBe('"Obi, Ada"')
  })

  it('CSV and text list carry the name, phone and programme', () => {
    const csv = applicantsCsv([row()]).toString('utf8')
    expect(csv.startsWith('﻿Name,Phone,Phone (local),WhatsApp,Email,Programme')).toBe(true)
    expect(csv).toContain('Ada Obi,+2348031234567,08031234567,https://wa.me/2348031234567,ada@example.com,Data Analysis,New,No')
    const text = applicantsText([row(), row({ name: 'Tobi', phone: '+2349012345678', programme: '', paid: true })], 'Not paid').toString('utf8')
    expect(text).toContain('Ada Obi · 08031234567 · Data Analysis · New · not paid')
    expect(text).toContain('Tobi · 09012345678 · (no programme) · New · paid')
  })

  it('Excel file is a valid workbook with every phone number as text', () => {
    const files = unzip(applicantsXlsx([row(), row({ name: 'Kemi & <Co>', phone: '+2347042369143' })]))
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml'])
    const sheet = files.get('xl/worksheets/sheet1.xml')!
    expect(sheet).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">+2348031234567</t></is></c>')
    expect(sheet).toContain('Kemi &amp; &lt;Co&gt;')
    expect(sheet).toContain('<pane ySplit="1"')
    expect(sheet).not.toMatch(/<f>/)
  })
})

describeWithDb('collecting applicants to call', () => {
  let payload: Payload
  let dataId: number
  let designId: number
  let serial = 0

  const filters = (over: Partial<ApplicantExportFilters> = {}): ApplicantExportFilters => ({ payment: 'unpaid', courseIds: [], statuses: [], includeOptedOut: false, includeSignups: false, ...over })
  const lead = (data: Record<string, unknown>) =>
    payload.create({ collection: 'leads', data: { firstName: 'Applicant', email: `lead-${++serial}@example.com`, phone: `+23480312345${String(serial).padStart(2, '0')}`, source: 'apply', ...data } as never, overrideAccess: true })
  const names = (rows: ApplicantRow[]) => rows.map((item) => item.name).sort()

  beforeAll(async () => { payload = await getTestPayload() })
  beforeEach(async () => {
    await truncate(payload, ['leads', 'orders', 'enrollments', 'courses', 'users'])
    resetFakeRedis()
    dataId = Number((await payload.create({ collection: 'courses', data: { title: 'Data Analysis', slug: `data-${++serial}`, status: 'published', price: 50000 } as never, overrideAccess: true, context: { skipCache: true } })).id)
    designId = Number((await payload.create({ collection: 'courses', data: { title: 'UI/UX', slug: `uiux-${++serial}`, status: 'published', price: 50000 } as never, overrideAccess: true, context: { skipCache: true } })).id)
  })

  it('lists who hasn’t paid, with their decrypted phone and programme, and leaves out payers and opt-outs', async () => {
    await lead({ firstName: 'Ada', course: dataId, status: 'new' })
    await lead({ firstName: 'Bola', course: designId, status: 'contacted' })
    await lead({ firstName: 'Chidi', course: dataId, status: 'paid' })
    await lead({ firstName: 'Dami', course: dataId, optedOutAt: new Date().toISOString() })
    const buyer = await createTestUser(payload, { firstName: 'Efe' })
    await lead({ firstName: 'Efe', email: buyer.email, course: designId, status: 'account_created' })
    await payload.create({ collection: 'orders', data: { user: buyer.id, type: 'course', course: designId, amount: 50000, currency: 'NGN', reference: `ref-${++serial}`, status: 'success', paidAt: new Date().toISOString() } as never, overrideAccess: true })

    const { rows } = await collectApplicants(payload, filters())
    expect(names(rows)).toEqual(['Ada', 'Bola'])
    const ada = rows.find((item) => item.name === 'Ada')!
    expect(ada).toMatchObject({ programme: 'Data Analysis', status: 'New', paid: false })
    expect(ada.phone).toMatch(/^\+234803123\d{4}$/)

    expect(names((await collectApplicants(payload, filters({ payment: 'paid' }))).rows)).toEqual(['Chidi', 'Efe User'])
    expect(names((await collectApplicants(payload, filters({ courseIds: [designId] }))).rows)).toEqual(['Bola'])
    expect(names((await collectApplicants(payload, filters({ statuses: ['new'] }))).rows)).toEqual(['Ada'])
    expect(names((await collectApplicants(payload, filters({ includeOptedOut: true }))).rows)).toEqual(['Ada', 'Bola', 'Dami'])
  })

  it('can add sign-ups who never applied or paid, and caps a file', async () => {
    await lead({ firstName: 'Ada', course: dataId })
    const signup = await payload.create({ collection: 'users', data: { email: 'fola@example.com', password: 'Test-password-1!', firstName: 'Fola', lastName: 'Ade', role: 'student', phone: '+2348099999999' } as never, overrideAccess: true, context: { skipWelcomeEmail: true } })
    const learner = await payload.create({ collection: 'users', data: { email: 'gbenga@example.com', password: 'Test-password-1!', firstName: 'Gbenga', lastName: 'Ola', role: 'student', phone: '+2348088888888' } as never, overrideAccess: true, context: { skipWelcomeEmail: true } })
    await payload.create({ collection: 'enrollments', data: { student: learner.id, course: dataId, status: 'active', orderId: 'admin-grant' }, overrideAccess: true })

    const { rows } = await collectApplicants(payload, filters({ includeSignups: true }))
    expect(rows.map((item) => [item.kind, item.name])).toEqual([['Applicant', 'Ada'], ['Sign-up', 'Fola Ade']])
    expect(rows[1]).toMatchObject({ id: Number(signup.id), phone: '+2348099999999', status: 'Signed up, not applied' })

    const capped = await collectApplicants(payload, filters({ includeSignups: true }), 1)
    expect(capped).toMatchObject({ truncated: true })
    expect(capped.rows).toHaveLength(1)
  })
})
