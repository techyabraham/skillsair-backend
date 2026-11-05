import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, sendSuccess } from '../../middleware/validate.js'
import { requireAdmin } from '../../lib/ambassadors/access.js'
import { applicantExportRateLimiter } from '../../lib/rate-limiter.js'
import { logger } from '../../lib/logger.js'
import {
  APPLICANT_STATUSES,
  applicantsCsv,
  applicantsText,
  applicantsXlsx,
  collectApplicants,
  localPhone,
  type ApplicantExportFilters,
} from '../../lib/applicant-export.js'

const PREVIEW_ROWS = 25
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const list = (value: string | null) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [])

/** Query string: ?format=csv|xlsx|txt|preview&payment=unpaid|paid|all&course=1,2&status=new,contacted&from=&to=&optedOut=1&signups=1 */
const querySchema = z.object({
  format: z.enum(['csv', 'xlsx', 'txt', 'preview']),
  payment: z.enum(['unpaid', 'paid', 'all']),
  courseIds: z.array(z.number().int().positive()).max(100),
  statuses: z.array(z.enum(APPLICANT_STATUSES)).max(APPLICANT_STATUSES.length),
  from: day.optional(),
  to: day.optional(),
  includeOptedOut: z.boolean(),
  includeSignups: z.boolean(),
})

export function parseExportQuery(params: URLSearchParams) {
  return parseBody(querySchema, {
    format: params.get('format') ?? 'preview',
    payment: params.get('payment') ?? 'unpaid',
    courseIds: list(params.get('course')).map(Number),
    statuses: list(params.get('status')),
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
    includeOptedOut: params.get('optedOut') === '1',
    includeSignups: params.get('signups') === '1',
  })
}

const FILE_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain; charset=utf-8',
} as const

async function handler(req: PayloadRequest): Promise<Response> {
  const admin = await requireAdmin(req)
  await applicantExportRateLimiter.check(req, admin.id)
  const { format, ...filters } = parseExportQuery(new URL(req.url ?? 'http://localhost').searchParams)
  const { rows, truncated } = await collectApplicants(req.payload, filters as ApplicantExportFilters)

  if (format === 'preview') {
    return sendSuccess({
      total: rows.length,
      truncated,
      withPhone: rows.filter((row) => row.phone).length,
      rows: rows.slice(0, PREVIEW_ROWS).map((row) => ({
        kind: row.kind, id: row.id, name: row.name, phone: row.phone, localPhone: localPhone(row.phone),
        programme: row.programme, status: row.status, paid: row.paid, appliedAt: row.appliedAt,
      })),
    })
  }

  // Who exported what, never the people in it.
  logger.info({ adminId: admin.id, format, count: rows.length, truncated, filters }, 'applicant_export')
  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date())
  const label = filters.payment === 'unpaid' ? 'not-paid' : filters.payment === 'paid' ? 'paid' : 'all'
  const filename = `skillsair-applicants-${label}-${stamp}.${format}`
  const body = format === 'csv' ? applicantsCsv(rows) : format === 'xlsx' ? applicantsXlsx(rows) : applicantsText(rows, `SkillsAir applicants (${label.replace('-', ' ')}), ${stamp}`)
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': FILE_TYPES[format],
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(truncated ? { 'X-Export-Truncated': '1' } : {}),
    },
  })
}

/** GET /api/studio/applicants/export: Admissions → Export applicants (see src/lib/applicant-export.ts). */
export const applicantExportEndpoint: Endpoint = {
  path: '/studio/applicants/export',
  method: 'get',
  handler: asyncHandler(handler),
}
