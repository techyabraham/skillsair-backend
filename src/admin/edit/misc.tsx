/**
 * Edit-view panels for the scholarship window global (brief 7.9) and laptop applications (7.10).
 * Server components rendered as `ui` fields.
 */
import React from 'react'
import type { UIFieldServerProps } from 'payload'
import { Callout } from '../ui/primitives'
import { Countdown } from '../ui/client'
import { isAdmin } from '../data/auth'
import { windowIsOpen } from '../../lib/pricing'
import { formatAbsolute, formatNaira } from '../format'

type Props = UIFieldServerProps

/** Top of the Scholarship window global: the state, the countdown and what closing changes. */
export function WindowStatusPanel(props: Props) {
  const data = (props.data ?? {}) as { isOpen?: boolean; opensAt?: string; closesAt?: string; cohortLabel?: string; laptopsPerCohort?: number }
  const open = windowIsOpen({ isOpen: Boolean(data.isOpen), opensAt: data.opensAt ?? null, closesAt: data.closesAt ?? null })
  const now = Date.now()
  return (
    <section className="sa-window-panel" aria-label="Scholarship window status">
      <div className={`sa-window-panel__state${open ? ' sa-window-panel__state--open' : ''}`}>
        <p className="sa-eyebrow">Right now</p>
        <p className="sa-window-panel__headline">{open ? 'Open' : 'Closed'}</p>
        {open && data.closesAt ? <Countdown to={data.closesAt} initialNow={now} /> : null}
        <dl className="sa-facts">
          <div>
            <dt>Opens</dt>
            <dd>{data.opensAt ? formatAbsolute(data.opensAt) : '–'}</dd>
          </div>
          <div>
            <dt>Closes</dt>
            <dd>{data.closesAt ? formatAbsolute(data.closesAt) : '–'}</dd>
          </div>
          <div>
            <dt>Cohort</dt>
            <dd>{data.cohortLabel || '–'}</dd>
          </div>
          <div>
            <dt>Laptops this cohort</dt>
            <dd>{data.laptopsPerCohort ?? '–'}</dd>
          </div>
        </dl>
      </div>
      <div className="sa-window-panel__changes">
        <h3 className="sa-ready__title">What changes when it closes</h3>
        <ul>
          <li>New learners pay the standard fee for each programme (for example {formatNaira(40_000)} a month or {formatNaira(100_000)} once).</li>
          <li>Learners who joined during the window keep {formatNaira(2000)} a month for their programme.</li>
          <li>The website’s announcement bar hides within about 5 minutes.</li>
        </ul>
      </div>
      <Callout tone="caution" title="Don’t extend an announced window">
        When this window closes, every programme is charged its standard fee until a new window opens. Close windows when announced. Between windows, the
        standard fee is charged. Don’t extend a window after its closing date has been announced to learners.
      </Callout>
    </section>
  )
}

/** Laptop application: the story as a readable card at the top. */
export function LaptopStoryCard(props: Props) {
  if (!isAdmin(props.req)) return null
  const data = (props.data ?? {}) as { story?: string; plannedUse?: string; currentDevice?: string; consentToFeature?: boolean }
  if (!data.story) return null
  return (
    <article className="sa-story">
      <p className="sa-eyebrow">Their story</p>
      <p className="sa-story__text">{data.story}</p>
      {data.plannedUse ? (
        <>
          <p className="sa-eyebrow">What they’ll do with it</p>
          <p className="sa-story__text">{data.plannedUse}</p>
        </>
      ) : null}
      <p className="sa-muted sa-story__meta">
        Current device: {String(data.currentDevice ?? '–').replace(/_/g, ' ')} · {data.consentToFeature ? 'Happy to be featured' : 'Not to be featured'}
      </p>
    </article>
  )
}

/** Sidebar counter: "Awarded 1 of 2 this cohort". */
export async function LaptopAwardCounter(props: Props) {
  if (!isAdmin(props.req)) return null
  const cohort = (props.data as { cohortLabel?: string })?.cohortLabel
  if (!cohort) return null
  const [awarded, window] = await Promise.all([
    props.payload.count({ collection: 'laptop-applications', where: { and: [{ cohortLabel: { equals: cohort } }, { status: { equals: 'awarded' } }] }, overrideAccess: true }),
    props.payload.findGlobal({ slug: 'scholarship-window', depth: 0 }).catch(() => null),
  ])
  const limit = (window as { laptopsPerCohort?: number } | null)?.laptopsPerCohort ?? 2
  return (
    <p className={`sa-award-counter${awarded.totalDocs >= limit ? ' sa-award-counter--full' : ''}`}>
      Awarded <strong>{awarded.totalDocs}</strong> of {limit} this cohort ({cohort})
    </p>
  )
}
