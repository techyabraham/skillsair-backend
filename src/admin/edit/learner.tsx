/**
 * Learner 360 (brief 7.7), a `ui` field at the top of a learner's record: enrolments with
 * progress, subscription status and renewal or grace date (with the locked-rate badge), orders
 * total, certificates, lifecycle track and an "inactive N days" warning. Admin only (learners can
 * open their own record in the admin panel; they see nothing here).
 */
import React from 'react'
import type { UIFieldServerProps } from 'payload'
import { Award, Lock } from 'lucide-react'
import { Callout, Money, ProgressBar, StatusPill } from '../ui/primitives'
import { isAdmin } from '../data/auth'
import { accessGraceDays } from '../../lib/billing'
import { formatDay, formatRelative } from '../format'

type Props = UIFieldServerProps

export async function Learner360(props: Props) {
  if (!isAdmin(props.req) || !props.id) return null
  const userId = props.id
  const find = (collection: string, where: object, select: Record<string, true>, sort?: string) =>
    props.payload.find({ collection: collection as never, where: where as never, limit: 100, depth: 0, pagination: false, overrideAccess: true, select: select as never, sort })
  const [enrolments, subscriptions, orders, certificates, lastMessage] = await Promise.all([
    find('enrollments', { student: { equals: userId } }, { course: true, status: true, progressPercent: true, enrolledAt: true }, '-enrolledAt'),
    find('subscriptions', { user: { equals: userId } }, { course: true, status: true, currentPeriodEnd: true, lastFailedAt: true, priceLocked: true, displayTitle: true }, '-createdAt'),
    find('orders', { and: [{ user: { equals: userId } }, { status: { equals: 'success' } }] }, { amount: true }),
    find('certificates', { student: { equals: userId } }, { course: true, certificateCode: true, issuedAt: true }, '-issuedAt'),
    find('messages', { personKey: { equals: `user:${userId}` } }, { track: true, stepId: true, sentAt: true }, '-sentAt'),
  ])
  const courseIds = [...new Set([...enrolments.docs, ...subscriptions.docs, ...certificates.docs].map((d) => (d as { course?: number }).course).filter(Boolean))] as number[]
  const courses = courseIds.length
    ? new Map(((await props.payload.find({ collection: 'courses', where: { id: { in: courseIds } }, limit: courseIds.length, depth: 0, pagination: false, overrideAccess: true, select: { title: true } as never })).docs as unknown as Array<{ id: number; title: string }>).map((c) => [c.id, c.title]))
    : new Map<number, string>()
  const title = (id?: number) => (id ? courses.get(id) ?? 'Programme' : 'Programme')
  const user = (props.data ?? {}) as { lifecycle?: { lastLearningAt?: string } }
  const lastLearning = user.lifecycle?.lastLearningAt
  const inactiveDays = lastLearning ? Math.floor((Date.now() - new Date(lastLearning).getTime()) / 86_400_000) : null
  const total = (orders.docs as unknown as Array<{ amount: number }>).reduce((sum, o) => sum + Number(o.amount), 0)
  const last = (lastMessage.docs as unknown as Array<{ track: string; stepId: string; sentAt: string }>)[0]
  const enrolled = enrolments.docs as unknown as Array<{ id: number; course: number; status: string; progressPercent?: number }>

  return (
    <section className="sa-learner360" aria-label="Learner overview">
      {inactiveDays !== null && inactiveDays >= 10 && enrolled.some((e) => e.status === 'active') ? (
        <Callout tone="caution" title={`Inactive for ${inactiveDays} days`}>
          Last lesson {formatRelative(lastLearning)}. The lifecycle engine sends gentle nudges; a personal message helps too.
        </Callout>
      ) : null}
      <div className="sa-learner360__grid">
        <div className="sa-learner360__block">
          <h3 className="sa-learner360__title">Enrolments</h3>
          {enrolled.length ? (
            <ul className="sa-learner360__list">
              {enrolled.map((e) => (
                <li key={e.id}>
                  <a href={`/admin/collections/enrollments/${e.id}`}>{title(e.course)}</a>
                  {e.status === 'completed' ? <StatusPill tone="positive">Completed</StatusPill> : <ProgressBar value={Number(e.progressPercent ?? 0)} label={`${title(e.course)} progress`} />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="sa-muted">Not enrolled yet.</p>
          )}
        </div>
        <div className="sa-learner360__block">
          <h3 className="sa-learner360__title">Subscriptions</h3>
          {subscriptions.docs.length ? (
            <ul className="sa-learner360__list">
              {(subscriptions.docs as unknown as Array<{ id: number; course: number; status: string; currentPeriodEnd?: string; lastFailedAt?: string; priceLocked?: boolean }>).map((s) => (
                <li key={s.id}>
                  <a href={`/admin/collections/subscriptions/${s.id}`}>{title(s.course)}</a>
                  <span className="sa-cell__chips">
                    <StatusPill tone={s.status === 'active' ? 'positive' : s.status === 'past_due' ? 'critical' : 'neutral'}>{s.status === 'past_due' ? 'Past due' : s.status[0]!.toUpperCase() + s.status.slice(1)}</StatusPill>
                    {s.status === 'past_due' && s.lastFailedAt ? <span className="sa-muted">Grace ends {formatDay(new Date(s.lastFailedAt).getTime() + accessGraceDays() * 86_400_000)}</span> : null}
                    {s.status === 'active' && s.currentPeriodEnd ? <span className="sa-muted">Renews {formatDay(s.currentPeriodEnd)}</span> : null}
                    {s.priceLocked ? (
                      <span className="sa-chip-sm sa-chip-sm--accent">
                        <Lock size={11} strokeWidth={2.25} aria-hidden /> Locked rate
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sa-muted">No subscriptions.</p>
          )}
        </div>
        <div className="sa-learner360__block">
          <h3 className="sa-learner360__title">Money and certificates</h3>
          <p className="sa-learner360__figure">
            <Money amount={total} /> <span className="sa-muted">paid in total</span>
          </p>
          {certificates.docs.length ? (
            <ul className="sa-learner360__list">
              {(certificates.docs as unknown as Array<{ id: number; course: number; certificateCode: string }>).map((c) => (
                <li key={c.id}>
                  <a href={`/admin/collections/certificates/${c.id}`}>
                    <Award size={14} strokeWidth={2} aria-hidden /> {title(c.course)}
                  </a>
                  <span className="sa-mono sa-muted">{c.certificateCode}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sa-muted">No certificates yet.</p>
          )}
          <p className="sa-muted sa-learner360__lifecycle">{last ? `Lifecycle: track ${last.track}, last ${last.stepId} ${formatRelative(last.sentAt)}` : 'Lifecycle: no messages yet'}</p>
        </div>
      </div>
    </section>
  )
}
