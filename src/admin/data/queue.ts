/**
 * Imisi's queue (brief 7.3): applicants with needsHuman = true, highest score first, then the
 * longest wait. Admin only. Waiting time counts working hours only (Mon–Sat 9–6 WAT), so a
 * message sent at 9pm hasn't "waited all night".
 *
 * Why someone is in the queue isn't stored, so it is worked out from what is recorded:
 * a failed payment (past-due subscription or failed order in the last 14 days) > an account
 * without payment > a WhatsApp message > a question on the Apply form > "asked to talk".
 */
import type { PayloadRequest } from 'payload'
import { assertAdmin } from './auth.js'
import { lagosMidnight } from '../../lib/lifecycle/timing.js'
import { waitTone, workingMsBetween } from './metrics-core.js'

export type QueueReason = 'payment' | 'account' | 'whatsapp' | 'question' | 'talk'

export const QUEUE_REASON_LABEL: Record<QueueReason, string> = {
  payment: 'Payment failed',
  account: 'Account, no payment yet',
  whatsapp: 'Wrote on WhatsApp',
  question: 'Asked a question when applying',
  talk: 'Asked to talk to Imisi',
}

export interface QueueItem {
  id: number
  firstName: string
  programme: string | null
  school: string | null
  score: number
  status: string
  reason: QueueReason
  since: string
  waitingMs: number
  workingMs: number
  waitTone: 'neutral' | 'caution' | 'critical'
  lastMessage: { direction: 'in' | 'out'; text: string; at: string } | null
  /** The 24-hour WhatsApp customer-service window is open (they messaged in the last 24h). */
  canReply: boolean
  replyClosesAt: string | null
  optedOut: boolean
  /** Digits only, for the wa.me link (admin-only view). */
  whatsappNumber: string | null
  newToday: boolean
}

type Lead = {
  id: number
  firstName?: string
  phone?: string
  score?: number
  status?: string
  message?: string | null
  optedOutAt?: string | null
  lastInboundAt?: string | null
  lastEventAt?: string | null
  updatedAt?: string
  createdAt?: string
  user?: number | { id: number } | null
  course?: { title?: string } | number | null
  school?: { name?: string } | number | null
  whatsappLog?: Array<{ direction: 'in' | 'out'; type?: string; template?: string | null; body?: string | null; at: string }> | null
}

const WINDOW_MS = 24 * 3_600_000

export async function getQueue(req: PayloadRequest, now = Date.now()): Promise<QueueItem[]> {
  assertAdmin(req)
  const result = await req.payload.find({
    collection: 'leads',
    where: { needsHuman: { equals: true } },
    sort: '-score',
    limit: 200,
    depth: 1,
    overrideAccess: true,
    select: {
      firstName: true,
      phone: true,
      score: true,
      status: true,
      message: true,
      optedOutAt: true,
      lastInboundAt: true,
      lastEventAt: true,
      updatedAt: true,
      createdAt: true,
      user: true,
      course: true,
      school: true,
      whatsappLog: true,
    } as never,
    populate: { courses: { title: true }, categories: { name: true }, users: {} } as never,
  })
  const leads = result.docs as unknown as Lead[]
  const userIds = leads.map((lead) => (typeof lead.user === 'object' ? lead.user?.id : lead.user)).filter((id): id is number => typeof id === 'number')

  // One query each for "payment trouble" across all queued people.
  const paymentTrouble = new Set<number>()
  if (userIds.length) {
    const [subs, orders] = await Promise.all([
      req.payload.find({ collection: 'subscriptions', where: { and: [{ user: { in: userIds } }, { status: { equals: 'past_due' } }] }, limit: 500, depth: 0, overrideAccess: true, select: { user: true } as never }),
      req.payload.find({
        collection: 'orders',
        where: { and: [{ user: { in: userIds } }, { status: { equals: 'failed' } }, { createdAt: { greater_than: new Date(now - 14 * 24 * 3_600_000).toISOString() } }] },
        limit: 500,
        depth: 0,
        overrideAccess: true,
        select: { user: true } as never,
      }),
    ])
    for (const doc of [...subs.docs, ...orders.docs] as unknown as Array<{ user: number | { id: number } }>) {
      paymentTrouble.add(typeof doc.user === 'object' ? doc.user.id : doc.user)
    }
  }

  const today = lagosMidnight(now)
  const items = leads.map((lead): QueueItem => {
    const userId = typeof lead.user === 'object' ? lead.user?.id : lead.user
    const log = lead.whatsappLog ?? []
    const last = log[log.length - 1]
    const lastInbound = lead.lastInboundAt ? new Date(lead.lastInboundAt).getTime() : 0
    const since = Math.max(lastInbound, new Date(lead.lastEventAt ?? lead.updatedAt ?? now).getTime())
    const reason: QueueReason =
      userId && paymentTrouble.has(userId) ? 'payment' : lead.status === 'account_created' ? 'account' : lastInbound ? 'whatsapp' : lead.message ? 'question' : 'talk'
    const workingMs = workingMsBetween(since, now)
    const digits = (lead.phone ?? '').replace(/\D/g, '')
    return {
      id: lead.id,
      firstName: lead.firstName ?? 'Applicant',
      programme: typeof lead.course === 'object' && lead.course ? lead.course.title ?? null : null,
      school: typeof lead.school === 'object' && lead.school ? lead.school.name ?? null : null,
      score: Number(lead.score ?? 0),
      status: lead.status ?? 'new',
      reason,
      since: new Date(since).toISOString(),
      waitingMs: now - since,
      workingMs,
      waitTone: waitTone(workingMs),
      lastMessage: last
        ? { direction: last.direction, text: last.body?.trim() || (last.template ? `Template: ${last.template}` : 'Message'), at: last.at }
        : lead.message
          ? { direction: 'in', text: lead.message, at: lead.createdAt ?? new Date(since).toISOString() }
          : null,
      canReply: !lead.optedOutAt && lastInbound > 0 && now - lastInbound < WINDOW_MS,
      replyClosesAt: lastInbound ? new Date(lastInbound + WINDOW_MS).toISOString() : null,
      optedOut: Boolean(lead.optedOutAt),
      whatsappNumber: digits.length >= 8 ? digits : null,
      newToday: new Date(lead.createdAt ?? 0).getTime() >= today,
    }
  })
  return items.sort((a, b) => b.score - a.score || b.workingMs - a.workingMs)
}
