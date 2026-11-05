/**
 * Applicant contact lists for follow-up calls (Studio → Admissions → Export applicants).
 *
 * Who: everyone. Applicants (the Applicants collection: Apply, quiz, curriculum requests, contact
 * forms), people who unsubscribed from emails included, since they are still leads to follow up;
 * and people who created an account with a phone number but never applied or paid (left out only
 * when a programme or applicant status is chosen, as they have neither). By default only the ones
 * who haven't paid.
 *
 * "Paid" means the applicant is marked paid, or their account has a successful programme or plan
 * order. Sign-ups also count as paying (and are left out) when they already have an enrolment, as
 * imported and Studio-enrolled learners do.
 *
 * Phone numbers are stored encrypted; Payload decrypts them on read for admins. Exports are for
 * admins only, and each one is logged (who, how many, which filters; never the numbers).
 */
import type { Payload, Where } from 'payload'
import { buildXlsx } from './xlsx.js'

const PAGE = 500
/** One file holds at most this many people; narrow the filters for more. */
export const APPLICANT_EXPORT_MAX = 20_000

const ADMIN_URL = (process.env.ADMIN_URL ?? process.env.BACKEND_URL ?? 'https://kiwi.skillsair.com').replace(/\/$/, '')

export const APPLICANT_STATUSES = ['new', 'contacted', 'offer_viewed', 'account_created', 'paid', 'lost'] as const
export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number]
const STATUS_LABEL: Record<ApplicantStatus, string> = {
  new: 'New', contacted: 'Contacted', offer_viewed: 'Offer viewed', account_created: 'Account created', paid: 'Paid', lost: 'Lost',
}

export interface ApplicantExportFilters {
  payment: 'unpaid' | 'paid' | 'all'
  courseIds: number[]
  statuses: ApplicantStatus[]
  /** Applied on or after this Lagos day (YYYY-MM-DD). */
  from?: string
  /** Applied on or before this Lagos day (YYYY-MM-DD). */
  to?: string
}

export interface ApplicantRow {
  kind: 'Applicant' | 'Sign-up'
  id: number
  name: string
  phone: string
  email: string
  programme: string
  status: string
  paid: boolean
  appliedAt: string
  lastActivityAt: string
  source: string
  score: number | null
  optedOut: boolean
  notes: string
}

interface LeadRow {
  id: number
  firstName?: string | null
  email: string
  phone?: string | null
  course?: number | null
  status?: ApplicantStatus | null
  source?: string | null
  score?: number | null
  notes?: string | null
  optedOutAt?: string | null
  lastEventAt?: string | null
  createdAt: string
  user?: number | null
}

interface UserRow {
  id: number
  email: string
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  isActive?: boolean | null
  createdAt: string
}

const SOURCE_LABEL: Record<string, string> = { apply: 'Apply', quiz: 'Quiz', curriculum_request: 'Curriculum request', contact: 'Contact', employer: 'Employer', other: 'Other' }
const LAGOS_OFFSET_MS = 60 * 60 * 1000
const DAY = 86_400_000

/** Start of a Lagos day (YYYY-MM-DD), as an ISO instant; `endOfDay` gives the next day's start. */
export function lagosDayStart(day: string, endOfDay = false): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const at = Date.parse(`${day}T00:00:00Z`)
  if (!Number.isFinite(at)) return null
  return new Date(at - LAGOS_OFFSET_MS + (endOfDay ? DAY : 0)).toISOString()
}

const lagosDateTime = (at: string | null | undefined) =>
  at ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date(at)) : ''

/** +2348031234567 → 08031234567. Other countries stay international. */
export function localPhone(e164: string): string {
  return /^\+234\d{10}$/.test(e164) ? `0${e164.slice(4)}` : e164
}

/** A wa.me link opens a WhatsApp chat with the number. */
export const whatsappLink = (e164: string) => (/^\+\d{8,15}$/.test(e164) ? `https://wa.me/${e164.slice(1)}` : '')

const chunks = <T>(items: T[], size = PAGE): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size))

/** User ids (from `userIds`) with a successful programme or plan order. */
async function payingUsers(payload: Payload, userIds: number[]): Promise<Set<number>> {
  const paying = new Set<number>()
  for (const ids of chunks([...new Set(userIds)])) {
    const orders = await payload.find({
      collection: 'orders',
      where: { and: [{ user: { in: ids } }, { status: { equals: 'success' } }, { type: { in: ['course', 'subscription'] } }] },
      limit: 0, pagination: false, depth: 0, overrideAccess: true, select: { user: true } as never,
    })
    for (const order of orders.docs as unknown as Array<{ user?: number | { id: number } | null }>) {
      const id = typeof order.user === 'object' && order.user ? order.user.id : order.user
      if (id) paying.add(Number(id))
    }
  }
  return paying
}

async function usersBy(payload: Payload, field: 'id' | 'email', values: Array<number | string>): Promise<UserRow[]> {
  const found: UserRow[] = []
  for (const part of chunks([...new Set(values)])) {
    if (!part.length) continue
    const users = await payload.find({
      collection: 'users',
      where: { [field]: { in: part } },
      limit: 0, pagination: false, depth: 0, overrideAccess: true,
      select: { email: true, firstName: true, lastName: true, phone: true, isActive: true, createdAt: true } as never,
    })
    found.push(...(users.docs as unknown as UserRow[]))
  }
  return found
}

function dateRange(filters: ApplicantExportFilters): Where[] {
  const range: Where[] = []
  const from = filters.from ? lagosDayStart(filters.from) : null
  const to = filters.to ? lagosDayStart(filters.to, true) : null
  if (from) range.push({ createdAt: { greater_than_equal: from } })
  if (to) range.push({ createdAt: { less_than: to } })
  return range
}

export async function collectApplicants(payload: Payload, filters: ApplicantExportFilters, max = APPLICANT_EXPORT_MAX): Promise<{ rows: ApplicantRow[]; truncated: boolean }> {
  const courses = await payload.find({ collection: 'courses', limit: 500, depth: 0, overrideAccess: true, select: { title: true } as never })
  const titles = new Map((courses.docs as unknown as Array<{ id: number; title: string }>).map((course) => [Number(course.id), course.title]))

  const where: Where[] = [...dateRange(filters)]
  if (filters.courseIds.length) where.push({ course: { in: filters.courseIds } })
  if (filters.statuses.length) where.push({ status: { in: filters.statuses } })
  if (filters.payment === 'unpaid') where.push({ status: { not_equals: 'paid' } })

  const rows: ApplicantRow[] = []
  let truncated = false
  for (let page = 1; ; page++) {
    const result = await payload.find({
      collection: 'leads',
      where: where.length ? { and: where } : {},
      sort: '-createdAt', page, limit: PAGE, depth: 0, overrideAccess: true,
      select: { firstName: true, email: true, phone: true, course: true, status: true, source: true, score: true, notes: true, optedOutAt: true, lastEventAt: true, createdAt: true, user: true } as never,
    })
    const leads = result.docs as unknown as LeadRow[]
    if (!leads.length) break

    // Linked accounts (by the lead's user, or the same email) give the surname and payment state.
    const linked = [
      ...(await usersBy(payload, 'id', leads.map((lead) => Number(lead.user)).filter(Boolean))),
      ...(await usersBy(payload, 'email', leads.filter((lead) => !lead.user).map((lead) => lead.email))),
    ]
    const byId = new Map(linked.map((user) => [Number(user.id), user]))
    const byEmail = new Map(linked.map((user) => [user.email.toLowerCase(), user]))
    const paying = await payingUsers(payload, linked.map((user) => Number(user.id)))

    for (const lead of leads) {
      const user = (lead.user ? byId.get(Number(lead.user)) : undefined) ?? byEmail.get(lead.email.toLowerCase())
      const paid = lead.status === 'paid' || Boolean(user && paying.has(Number(user.id)))
      if (filters.payment === 'unpaid' && paid) continue
      if (filters.payment === 'paid' && !paid) continue
      const first = (lead.firstName ?? user?.firstName ?? '').trim()
      const last = (user?.lastName ?? '').trim()
      rows.push({
        kind: 'Applicant',
        id: Number(lead.id),
        name: [first, last && last !== 'Learner' && !first.endsWith(last) ? last : ''].filter(Boolean).join(' ') || 'Applicant',
        phone: String(lead.phone ?? user?.phone ?? ''),
        email: lead.email,
        programme: lead.course ? titles.get(Number(lead.course)) ?? '' : '',
        status: lead.status ? STATUS_LABEL[lead.status] ?? lead.status : '',
        paid,
        appliedAt: lead.createdAt,
        lastActivityAt: lead.lastEventAt ?? '',
        source: SOURCE_LABEL[lead.source ?? ''] ?? lead.source ?? '',
        score: typeof lead.score === 'number' ? lead.score : null,
        optedOut: Boolean(lead.optedOutAt),
        notes: (lead.notes ?? '').trim(),
      })
      if (rows.length >= max) {
        truncated = true
        break
      }
    }
    if (truncated || !result.hasNextPage) break
  }

  // Sign-ups are in every unpaid or everyone list, unless a programme or applicant status is chosen (they have neither).
  if (filters.payment !== 'paid' && !filters.courseIds.length && !filters.statuses.length && !truncated) {
    for (let page = 1; ; page++) {
      const result = await payload.find({
        collection: 'users',
        where: { and: [{ role: { equals: 'student' } }, { phone: { exists: true } }, { isActive: { not_equals: false } }, ...dateRange(filters)] },
        sort: '-createdAt', page, limit: PAGE, depth: 0, overrideAccess: true,
        select: { email: true, firstName: true, lastName: true, phone: true, isActive: true, createdAt: true } as never,
      })
      const users = (result.docs as unknown as UserRow[]).filter((user) => user.phone)
      if (users.length) {
        const ids = users.map((user) => Number(user.id))
        const [paying, withLead, enrolled] = await Promise.all([
          payingUsers(payload, ids),
          payload.find({ collection: 'leads', where: { or: [{ user: { in: ids } }, { email: { in: users.map((user) => user.email.toLowerCase()) } }] }, limit: 0, pagination: false, depth: 0, overrideAccess: true, select: { user: true, email: true } as never }),
          payload.find({ collection: 'enrollments', where: { and: [{ student: { in: ids } }, { status: { not_equals: 'refunded' } }] }, limit: 0, pagination: false, depth: 0, overrideAccess: true, select: { student: true } as never }),
        ])
        const applied = new Set<string>()
        for (const lead of withLead.docs as unknown as Array<{ user?: number | null; email: string }>) {
          if (lead.user) applied.add(`id:${lead.user}`)
          applied.add(`email:${lead.email.toLowerCase()}`)
        }
        const learners = new Set((enrolled.docs as unknown as Array<{ student: number | { id: number } }>).map((doc) => Number(typeof doc.student === 'object' ? doc.student.id : doc.student)))
        for (const user of users) {
          const id = Number(user.id)
          if (paying.has(id) || learners.has(id) || applied.has(`id:${id}`) || applied.has(`email:${user.email.toLowerCase()}`)) continue
          rows.push({
            kind: 'Sign-up', id,
            name: [user.firstName, user.lastName === 'Learner' ? '' : user.lastName].filter(Boolean).join(' ').trim() || 'Learner',
            phone: String(user.phone), email: user.email, programme: '', status: 'Signed up, not applied', paid: false,
            appliedAt: user.createdAt, lastActivityAt: '', source: 'Sign-up', score: null, optedOut: false, notes: '',
          })
          if (rows.length >= max) {
            truncated = true
            break
          }
        }
      }
      if (truncated || !result.hasNextPage) break
    }
  }
  return { rows, truncated }
}

// ---------- files ----------

const HEADER = ['Name', 'Phone', 'Phone (local)', 'WhatsApp', 'Email', 'Programme', 'Status', 'Paid', 'Applied', 'Last activity', 'Source', 'Score', 'Notes', 'Studio record']
const WIDTHS = [24, 16, 14, 26, 30, 30, 18, 6, 18, 18, 18, 6, 40, 50]

function cells(row: ApplicantRow): string[] {
  return [
    row.name, row.phone, localPhone(row.phone), whatsappLink(row.phone), row.email, row.programme, row.status, row.paid ? 'Yes' : 'No',
    lagosDateTime(row.appliedAt), lagosDateTime(row.lastActivityAt), row.source, row.score === null ? '' : String(row.score),
    row.notes.replace(/\s+/g, ' '),
    `${ADMIN_URL}/admin/collections/${row.kind === 'Applicant' ? 'leads' : 'users'}/${row.id}`,
  ]
}

/**
 * Names and notes come from public forms: a cell starting with = + - @ (or a tab or return) would
 * run as a formula when the file is opened in a spreadsheet, so it gets a leading apostrophe. A
 * bare international phone number (+ and digits) can't run anything and is left as it is.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^\+\d{8,15}$/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** UTF-8 with a byte-order mark, so Excel reads names with accents correctly. */
export function applicantsCsv(rows: ApplicantRow[]): Buffer {
  const lines = [HEADER, ...rows.map(cells)].map((line) => line.map(csvField).join(','))
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8')
}

export function applicantsXlsx(rows: ApplicantRow[]): Buffer {
  return buildXlsx('Applicants', HEADER, rows.map(cells), WIDTHS)
}

/** One person per line, ready to read out or paste into a chat: "Ada Obi · 08031234567 · Data Analysis · New". */
export function applicantsText(rows: ApplicantRow[], title: string): Buffer {
  const lines = rows.map((row) => [row.name, localPhone(row.phone), row.programme || '(no programme)', row.status, row.paid ? 'paid' : 'not paid'].join(' · '))
  return Buffer.from(`${title}\r\n${rows.length} ${rows.length === 1 ? 'person' : 'people'}\r\n\r\n${lines.join('\r\n')}\r\n`, 'utf8')
}
