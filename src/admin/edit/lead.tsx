/**
 * Applicant edit view panels (brief 7.5), rendered as `ui` fields (they store nothing):
 * LeadProfile (header above the tabs), LeadSummary (Overview tab), LeadConversation (WhatsApp
 * log as chat bubbles) and LeadMessages (lifecycle emails and WhatsApp from `messages`).
 * Server components; applicants are admin-only, and each panel re-checks the role.
 */
import React from 'react'
import type { UIFieldServerProps } from 'payload'
import { Mail, MessageCircle, Send } from 'lucide-react'
import { Avatar, ChatBubbles, EmptyState, InfoTip, StatusPill, Timeline, type ChatMessage } from '../ui/primitives'
import { isAdmin } from '../data/auth'
import { relId } from '../data/batch'
import { formatAbsolute, formatDay, formatRelative, formatWhen } from '../format'

type Props = UIFieldServerProps
type Lead = Record<string, unknown> & { id?: number }

const STATUS: Record<string, { label: string; tone: 'info' | 'neutral' | 'accent' | 'caution' | 'positive' }> = {
  new: { label: 'New', tone: 'info' },
  contacted: { label: 'Contacted', tone: 'neutral' },
  offer_viewed: { label: 'Offer viewed', tone: 'accent' },
  account_created: { label: 'Account', tone: 'caution' },
  paid: { label: 'Paid', tone: 'positive' },
  lost: { label: 'Lost', tone: 'neutral' },
}

/** What the score is made of (src/lib/leads.ts scoreLeadEvent): shown as a tooltip. */
const SCORE_HELP =
  'Score rises with intent: +40 for asking to talk or writing a message, +40 for a failed payment, +30 for an account without payment, +20 for viewing the offer twice, +10 for looking while the window closes. 100 is the maximum.'

async function names(props: Props, lead: Lead) {
  const [course, school] = await Promise.all([
    relId(lead.course) ? props.payload.findByID({ collection: 'courses', id: relId(lead.course)!, depth: 0, select: { title: true } as never, disableErrors: true, overrideAccess: true }) : null,
    relId(lead.school) ? props.payload.findByID({ collection: 'categories', id: relId(lead.school)!, depth: 0, select: { name: true } as never, disableErrors: true, overrideAccess: true }) : null,
  ])
  return { programme: (course as { title?: string } | null)?.title ?? null, school: (school as { name?: string } | null)?.name ?? null }
}

export async function LeadProfile(props: Props) {
  if (!isAdmin(props.req) || !props.id) return null
  const lead = (props.data ?? {}) as Lead
  const { programme, school } = await names(props, lead)
  const name = String(lead.firstName ?? 'Applicant')
  const status = STATUS[String(lead.status)] ?? { label: String(lead.status ?? 'New'), tone: 'neutral' as const }
  const phone = typeof lead.phone === 'string' ? lead.phone.replace(/\D/g, '') : ''
  const lastMessage = await props.payload.find({
    collection: 'messages',
    where: { personKey: { equals: `lead:${lead.id}` } },
    sort: '-sentAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
    select: { track: true, stepId: true, sentAt: true, status: true } as never,
  })
  const last = lastMessage.docs[0] as unknown as { track: string; stepId: string; sentAt: string; status: string } | undefined
  const consentAt = lead.marketingConsentAt as string | undefined
  return (
    <section className="sa-profile" aria-label="Applicant summary">
      <Avatar name={name} size={56} />
      <div className="sa-profile__main">
        <h2 className="sa-profile__name">
          {name} <StatusPill tone={status.tone}>{status.label}</StatusPill>
          {lead.needsHuman ? <StatusPill tone="accent">Needs reply</StatusPill> : null}
        </h2>
        <p className="sa-profile__meta">
          {programme ?? 'No programme chosen'}
          {school ? <span className="sa-chip-sm">{school.replace(/^School of /, '')}</span> : null}
          <span className="sa-muted">Applied {formatWhen(lead.createdAt as string)}</span>
        </p>
        <div className="sa-profile__chips">
          {phone && !lead.optedOutAt ? (
            <a className="sa-button sa-button--whatsapp sa-button--sm" href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer noopener">
              <MessageCircle size={14} strokeWidth={2} aria-hidden /> WhatsApp
            </a>
          ) : null}
          {lead.email ? (
            <a className="sa-button sa-button--secondary sa-button--sm" href={`mailto:${String(lead.email)}`}>
              <Mail size={14} strokeWidth={2} aria-hidden /> Email
            </a>
          ) : null}
          <span className="sa-profile__consent">
            {lead.optedOutAt
              ? `Opted out ${formatDay(lead.optedOutAt as string)}`
              : lead.marketingConsent
                ? `Marketing: yes${consentAt ? `, ${formatDay(consentAt)}` : ''}, ${String(lead.source ?? 'apply').replace(/_/g, ' ')} form`
                : 'Marketing: no'}
          </span>
        </div>
      </div>
      <dl className="sa-profile__facts">
        <div>
          <dt>
            Score <InfoTip text={SCORE_HELP} label="How the score works" />
          </dt>
          <dd>
            <span className="sa-score">
              <span className="sa-score__track" aria-hidden="true">
                <span style={{ width: `${Number(lead.score ?? 0)}%` }} />
              </span>
              <span className="sa-score__value">{Number(lead.score ?? 0)}</span>
            </span>
          </dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>{last ? `Track ${last.track}, last step ${last.stepId} ${formatRelative(last.sentAt)}` : 'No lifecycle messages yet'}</dd>
        </div>
      </dl>
    </section>
  )
}

export async function LeadSummary(props: Props) {
  if (!isAdmin(props.req) || !props.id) return null
  const lead = (props.data ?? {}) as Lead
  const utm = (lead.utm ?? {}) as Record<string, string | undefined>
  const facts: Array<[string, React.ReactNode]> = [
    ['Current situation', String(lead.currentStatus ?? '–').replace(/_/g, ' ')],
    ['Device', String(lead.device ?? '–').replace(/_/g, ' ')],
    ['Weekly hours', String(lead.weeklyHours ?? '–').replace(/_/g, '–').replace('under–5', 'Under 5').replace('8–plus', '8+')],
    ['Source', [lead.source, utm.source, utm.campaign].filter(Boolean).join(' · ') || '–'],
    ['Offer views', String(lead.offerViewCount ?? 0)],
    ['Waitlist', lead.waitlist ? 'Yes' : 'No'],
    ['Last activity', lead.lastEventAt ? <time title={formatAbsolute(lead.lastEventAt as string)}>{formatRelative(lead.lastEventAt as string)}</time> : '–'],
    ['Resume link', lead.resumeCode ? <span className="sa-mono">skillsair.com/r/{String(lead.resumeCode)}</span> : '–'],
  ]
  return (
    <div className="sa-lead-summary">
      {lead.message ? (
        <blockquote className="sa-queue__message">
          <p>{String(lead.message)}</p>
          <footer>Their message when applying</footer>
        </blockquote>
      ) : null}
      <dl className="sa-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function LeadConversation(props: Props) {
  if (!isAdmin(props.req)) return null
  const log = (((props.data ?? {}) as Lead).whatsappLog as ChatMessage[] | undefined) ?? []
  if (!log.length)
    return (
      <EmptyState icon={<MessageCircle size={22} strokeWidth={1.75} />} title="No WhatsApp messages yet">
        Messages to and from this applicant appear here (the last 50).
      </EmptyState>
    )
  return <ChatBubbles messages={log} />
}

export async function LeadMessages(props: Props) {
  if (!isAdmin(props.req) || !props.id) return null
  const result = await props.payload.find({
    collection: 'messages',
    where: { personKey: { equals: `lead:${props.id}` } },
    sort: '-sentAt',
    limit: 50,
    depth: 0,
    overrideAccess: true,
    select: { stepId: true, track: true, channel: true, status: true, skipReason: true, sentAt: true, clickedAt: true, convertedAt: true, template: true } as never,
  })
  const docs = result.docs as unknown as Array<{ id: number; stepId: string; track: string; channel: string; status: string; skipReason?: string; sentAt: string; clickedAt?: string; convertedAt?: string; template: string }>
  if (!docs.length)
    return (
      <EmptyState icon={<Send size={22} strokeWidth={1.75} />} title="No lifecycle messages yet">
        Emails and WhatsApp messages from the lifecycle engine appear here.
      </EmptyState>
    )
  return (
    <Timeline
      items={docs.map((doc) => ({
        id: String(doc.id),
        icon: doc.channel === 'whatsapp' ? <MessageCircle size={16} strokeWidth={1.75} /> : <Mail size={16} strokeWidth={1.75} />,
        tone: doc.status === 'sent' ? (doc.convertedAt ? 'positive' : 'info') : doc.status === 'failed' ? 'critical' : 'neutral',
        title: `${doc.stepId} · ${doc.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} · ${doc.status === 'sent' ? 'sent' : doc.skipReason === 'dry_run' ? 'dry run (not sent)' : doc.status}`,
        meta: [doc.clickedAt ? 'clicked' : null, doc.convertedAt ? 'converted' : null].filter(Boolean).join(' · ') || doc.template,
        at: doc.sentAt,
        href: `/admin/collections/messages/${doc.id}`,
      }))}
    />
  )
}
