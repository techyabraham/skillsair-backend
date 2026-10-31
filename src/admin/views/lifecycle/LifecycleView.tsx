/**
 * /admin/lifecycle: how each lifecycle step is doing over the last 30 days (brief 7.4).
 * Judge steps by conversions (money or progress), not opens: Apple Mail opens emails by itself.
 * Track tiles with a health dot, then a table with inline rate bars; red rows have more than 1%
 * unsubscribes or 0.1% spam complaints. A/B variants expand per step; "Preview" opens the
 * admin-only email preview endpoint in a drawer.
 */
import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { Mail } from 'lucide-react'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { Callout, Card, CardHeader, EmptyState, StatusPill } from '../../ui/primitives'
import { isAdmin } from '../../data/auth'
import { TRACKS, getLifecycleStats, type StepStats } from '../../data/lifecycle'
import { formatNumber, formatPercent } from '../../format'
import { LIFECYCLE_TEMPLATES, SAMPLE } from '../../../emails/lifecycle/index'
import { EmailPreviewButton } from './EmailPreviewButton'
import { isDryRun, liveTracks } from '../../../lib/lifecycle/live'

const HEALTH_LABEL = { positive: 'Healthy', caution: 'Watch', critical: 'Over the limit', neutral: 'No sends yet' } as const

function subjectOf(step: string): string | null {
  const template = LIFECYCLE_TEMPLATES[step]
  if (!template) return step.endsWith('-WA') ? 'WhatsApp template' : null
  try {
    return template.subject(template.sample ?? SAMPLE)
  } catch {
    return null
  }
}

function Rate({ part, whole, flag }: { part: number; whole: number; flag?: number }) {
  if (!whole) return <span className="sa-muted">–</span>
  const ratio = part / whole
  const over = flag !== undefined && ratio > flag
  return (
    <span className={`sa-rate${over ? ' sa-rate--over' : ''}`}>
      <span className="sa-rate__track" aria-hidden="true">
        <span style={{ width: `${Math.min(100, ratio * 100 * (flag ? 20 : 1))}%` }} />
      </span>
      <span className="sa-rate__value">
        {formatPercent(ratio)}
        {over ? <span className="sa-visually-hidden"> (over the limit)</span> : null}
      </span>
    </span>
  )
}

function StepRow({ stats }: { stats: StepStats }) {
  const subject = subjectOf(stats.step)
  const red = stats.health === 'critical'
  return (
    <tr className={red ? 'sa-lifecycle__row--red' : undefined}>
      <th scope="row">
        <span className="sa-lifecycle__step">{stats.step}</span>
      </th>
      <td className="sa-lifecycle__name">
        {subject ?? <span className="sa-muted">No email template</span>}
        {stats.variants.length > 1 ? (
          <details className="sa-lifecycle__variants">
            <summary>A/B: {stats.variants.length} versions</summary>
            <ul>
              {stats.variants.map((v) => (
                <li key={v.variant}>
                  Version {v.variant}: {formatNumber(v.sent)} sent · {formatNumber(v.clicked)} clicked · <strong>{formatNumber(v.converted)} converted</strong> ({v.sent ? formatPercent(v.converted / v.sent) : '–'})
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </td>
      <td className="sa-right">{formatNumber(stats.sent)}</td>
      <td>
        <Rate part={stats.clicked} whole={stats.sent} />
      </td>
      <td className="sa-right">
        <strong>{formatNumber(stats.converted)}</strong>
      </td>
      <td>
        <Rate part={stats.unsubscribed} whole={stats.sent} flag={0.01} />
      </td>
      <td>
        <Rate part={stats.complained} whole={stats.sent} flag={0.001} />
      </td>
      <td className="sa-right sa-muted">{stats.dryRun ? formatNumber(stats.dryRun) : '–'}</td>
      <td>{LIFECYCLE_TEMPLATES[stats.step] ? <EmailPreviewButton step={stats.step} /> : null}</td>
    </tr>
  )
}

export async function LifecycleView(props: AdminViewServerProps) {
  if (!isAdmin(props.initPageResult.req)) return <NotAvailable props={props} title="Lifecycle emails" />
  const dryRun = isDryRun()
  const live = liveTracks().join(', ').toUpperCase()
  let data: Awaited<ReturnType<typeof getLifecycleStats>> | null = null
  try {
    data = await getLifecycleStats(props.initPageResult.req)
  } catch {
    data = null
  }

  return (
    <StudioPage
      props={props}
      title="Lifecycle emails"
      icon="lifecycle"
      eyebrow="Messaging · last 30 days"
      intro="Judge each step by conversions, not opens. Red: more than 1% unsubscribed or more than 0.1% marked as spam."
      actions={
        <a className="sa-button sa-button--secondary" href="/api/email/preview/index" target="_blank" rel="noreferrer">
          All email previews
        </a>
      }
    >
      <div className="sa-lifecycle">
        {dryRun ? (
          <Callout tone="caution" title="Dry-run is ON">
            Lifecycle emails are planned and logged but not sent (LIFECYCLE_DRY_RUN is not “false”).
          </Callout>
        ) : (
          <Callout tone="info" title="Sending is live">
            {live ? `Live for tracks: ${live}.` : 'Live for no tracks yet (LIFECYCLE_LIVE_TRACKS is empty).'}
          </Callout>
        )}

        {!data ? (
          <Callout tone="critical" title="The message log couldn’t be loaded">
            Refresh to try again.
          </Callout>
        ) : (
          <>
            <ul className="sa-lifecycle__tracks" aria-label="Tracks">
              {TRACKS.map(({ track, name }) => {
                const stats = data!.tracks.find((t) => t.track === track)!
                return (
                  <li key={track} className="sa-lifecycle__track">
                    <span className="sa-lifecycle__track-head">
                      <strong>{track === 'Apost' ? 'A-post' : track}</strong>
                      <span className={`sa-dot sa-dot--${stats.health}`} aria-hidden="true" />
                      <span className="sa-visually-hidden">{HEALTH_LABEL[stats.health]}</span>
                    </span>
                    <span className="sa-lifecycle__track-name">{name}</span>
                    <span className="sa-lifecycle__track-stats">
                      {formatNumber(stats.sent)} sent · {stats.sent ? formatPercent(stats.clicked / stats.sent) : '–'} clicked · <strong>{formatNumber(stats.converted)}</strong> converted
                    </span>
                  </li>
                )
              })}
            </ul>

            <Card>
              <CardHeader title="Steps" action={<StatusPill tone="critical">Red = over the limit</StatusPill>} />
              {data.steps.length ? (
                <div className="sa-table-wrap">
                  <table className="sa-table sa-lifecycle__table">
                    <caption className="sa-visually-hidden">Lifecycle steps, last 30 days</caption>
                    <thead>
                      <tr>
                        <th scope="col">Step</th>
                        <th scope="col">Email</th>
                        <th scope="col" className="sa-right">Sent</th>
                        <th scope="col">Clicked</th>
                        <th scope="col" className="sa-right">Converted</th>
                        <th scope="col">Unsubscribed</th>
                        <th scope="col">Spam</th>
                        <th scope="col" className="sa-right">Dry-run</th>
                        <th scope="col">
                          <span className="sa-visually-hidden">Preview</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.steps.map((stats) => (
                        <StepRow key={stats.step} stats={stats} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon={<Mail size={22} strokeWidth={1.75} />} title="No lifecycle messages in the last 30 days">
                  Steps appear here as the engine plans and sends them.
                </EmptyState>
              )}
            </Card>
            <p className="sa-muted sa-lifecycle__note">Pick A/B winners on conversions, once each version has a few hundred sends.</p>
          </>
        )}
      </div>
    </StudioPage>
  )
}
