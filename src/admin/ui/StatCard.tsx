/**
 * StatCard: label, value (pre-formatted or a number with a format), change vs the previous equal
 * period (▲ green / ▼ red with "vs last 7 days"), a sparkline, a definition tooltip and a
 * click-through to the records behind the number. `loading` renders a skeleton.
 *
 * `goodWhen` says which direction is good (e.g. "Needs attention" going down is good).
 */
import React from 'react'
import { InfoTip, Skeleton } from './primitives'
import { Sparkline } from './charts'

export interface StatCardProps {
  label: string
  value?: React.ReactNode
  delta?: { current: number; previous: number; periodLabel: string } | null
  goodWhen?: 'up' | 'down'
  spark?: number[]
  href?: string
  tooltip?: string
  icon?: React.ReactNode
  loading?: boolean
  tone?: 'default' | 'attention'
}

export function deltaOf(current: number, previous: number): { direction: 'up' | 'down' | 'flat'; pct: number | null } {
  if (current === previous) return { direction: 'flat', pct: 0 }
  if (!previous) return { direction: current > previous ? 'up' : 'down', pct: null }
  return { direction: current > previous ? 'up' : 'down', pct: Math.abs((current - previous) / previous) }
}

export function StatCard({ label, value, delta, goodWhen = 'up', spark, href, tooltip, icon, loading, tone = 'default' }: StatCardProps) {
  const change = delta ? deltaOf(delta.current, delta.previous) : null
  const good = change && change.direction !== 'flat' ? (change.direction === goodWhen ? 'good' : 'bad') : 'flat'
  const body = (
    <>
      <span className="sa-stat__head">
        <span className="sa-stat__label">
          {icon ? <span className="sa-stat__icon">{icon}</span> : null}
          {label}
        </span>
      </span>
      {loading ? (
        <Skeleton width="60%" height={36} label={`Loading ${label}`} />
      ) : (
        <span className="sa-stat__value">{value}</span>
      )}
      <span className="sa-stat__foot">
        {change && !loading ? (
          <span className={`sa-delta sa-delta--${good}`}>
            <span aria-hidden="true">{change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '■'}</span>
            <span>
              {change.direction === 'flat'
                ? 'No change'
                : change.pct === null
                  ? `${change.direction === 'up' ? 'Up' : 'Down'} from 0`
                  : `${change.direction === 'up' ? 'Up' : 'Down'} ${Math.round(change.pct * 100)}%`}
            </span>
            <span className="sa-delta__period"> vs {delta!.periodLabel}</span>
          </span>
        ) : (
          <span />
        )}
        {spark && spark.length > 1 && !loading ? <Sparkline values={spark} tone={tone === 'attention' ? 'critical' : 'accent'} /> : null}
      </span>
    </>
  )
  return (
    <article className={`sa-stat sa-stat--${tone}`}>
      {href ? (
        <a className="sa-stat__link" href={href} aria-label={undefined}>
          {body}
        </a>
      ) : (
        <div className="sa-stat__link">{body}</div>
      )}
      {tooltip ? (
        <span className="sa-stat__tip">
          <InfoTip text={tooltip} label={`${label}, definition`} />
        </span>
      ) : null}
    </article>
  )
}
