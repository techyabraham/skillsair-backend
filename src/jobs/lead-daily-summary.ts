import cron from 'node-cron'
import { getPayload } from 'payload'
import type { Payload, SanitizedConfig } from 'payload'
import { logger } from '../lib/logger.js'
import { leadDailySummaryEmail, sendEmail } from '../lib/resend.js'
import type { LeadDoc } from '../lib/leads.js'

const ADMIN_URL = (process.env.ADMIN_URL ?? process.env.BACKEND_URL ?? 'https://kiwi.skillsair.com').replace(/\/$/, '')

function tally(values: string[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

function relationLabel(value: unknown, key: 'name' | 'title'): string {
  if (value && typeof value === 'object' && key in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)[key] ?? '')
  }
  return ''
}

export async function sendLeadDailySummary(payload: Payload): Promise<void> {
  const to = process.env.LEAD_SUMMARY_EMAIL
  if (!to) {
    logger.warn({}, 'lead_daily_summary_skipped_no_recipient')
    return
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const created = await payload.find({
    collection: 'leads',
    where: { createdAt: { greater_than_equal: since } },
    limit: 5000,
    depth: 1,
    overrideAccess: true,
  })
  const newLeads = created.docs as unknown as Array<LeadDoc & { school?: unknown; course?: unknown }>

  const count = async (where: Record<string, unknown>) =>
    (await payload.count({ collection: 'leads', where: where as never, overrideAccess: true })).totalDocs

  const [offersViewed, accountsCreated, queueSize, payments] = await Promise.all([
    count({ and: [{ lastEventAt: { greater_than_equal: since } }, { offerViewCount: { greater_than: 0 } }] }),
    count({ and: [{ updatedAt: { greater_than_equal: since } }, { status: { equals: 'account_created' } }] }),
    count({ needsHuman: { equals: true } }),
    payload
      .count({
        collection: 'orders',
        where: { and: [{ status: { equals: 'success' } }, { paidAt: { greater_than_equal: since } }, { type: { in: ['course', 'subscription'] } }] },
        overrideAccess: true,
      })
      .then((result) => result.totalDocs),
  ])

  const top = await payload.find({
    collection: 'leads',
    where: { status: { not_in: ['paid', 'lost'] } },
    sort: '-score',
    limit: 10,
    depth: 1,
    overrideAccess: true,
  })

  const email = leadDailySummaryEmail({
    dateLabel: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }).format(new Date()),
    newLeads: newLeads.length,
    bySchool: tally(newLeads.map((lead) => relationLabel(lead.school, 'name') || 'No school')),
    bySource: tally(newLeads.map((lead) => lead.source)),
    offersViewed,
    accountsCreated,
    payments,
    queueSize,
    topLeads: (top.docs as unknown as Array<LeadDoc & { course?: unknown }>).map((lead) => ({
      firstName: lead.firstName,
      programme: relationLabel(lead.course, 'title') || 'No programme',
      score: Number(lead.score ?? 0),
      needsHuman: Boolean(lead.needsHuman),
      adminUrl: `${ADMIN_URL}/admin/collections/leads/${lead.id}`,
    })),
  })
  await sendEmail(to, email)
  logger.info({ newLeads: newLeads.length, queueSize }, 'lead_daily_summary_sent')
}

/** 08:30 WAT every day. */
export function registerLeadDailySummaryJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule(
    '30 8 * * *',
    async () => {
      try {
        await sendLeadDailySummary(await getPayload({ config }))
      } catch (err) {
        logger.error({ err }, 'lead_daily_summary_failed')
      }
    },
    { timezone: 'Africa/Lagos' },
  )
}
