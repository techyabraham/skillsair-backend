'use client'

/**
 * Studio's only interactive primitives (kept small; everything else renders on the server).
 *
 * Countdown     live "3d 4h 12m" to a WAT deadline; updates every 30s, every second under 1h.
 *               aria-live is off by default (a ticking region is noisy for screen readers).
 * RelativeTime  server renders the absolute WAT time in `title`; the client keeps "5 mins ago" fresh.
 * Tabs          accessible tabs (roving tabindex, arrows/Home/End) for custom views.
 */
import React, { useEffect, useId, useRef, useState } from 'react'
import { formatAbsolute, formatRelative } from '../format'

function parts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return { days: Math.floor(total / 86400), hours: Math.floor((total % 86400) / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 }
}

export function Countdown({ to, live = false, initialNow }: { to: string; live?: boolean; initialNow: number }) {
  const target = new Date(to).getTime()
  const [now, setNow] = useState(initialNow)
  useEffect(() => {
    setNow(Date.now())
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const current = Date.now()
      setNow(current)
      timer = setTimeout(tick, target - current < 3_600_000 ? 1000 : 30_000)
    }
    timer = setTimeout(tick, 1000)
    return () => clearTimeout(timer)
  }, [target])
  const left = target - now
  const { days, hours, minutes, seconds } = parts(left)
  if (left <= 0) return <span className="sa-countdown">Closed</span>
  const units: Array<[number, string]> = days > 0 ? [[days, 'd'], [hours, 'h'], [minutes, 'm']] : hours > 0 ? [[hours, 'h'], [minutes, 'm']] : [[minutes, 'm'], [seconds, 's']]
  return (
    <span className="sa-countdown" aria-live={live ? 'polite' : 'off'} title={formatAbsolute(to)}>
      {units.map(([value, unit]) => (
        <span key={unit} className="sa-countdown__unit">
          <strong>{value}</strong>
          <small>{unit}</small>
        </span>
      ))}
    </span>
  )
}

export function RelativeTime({ at, initialNow }: { at: string | null | undefined; initialNow: number }) {
  const [now, setNow] = useState(initialNow)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  if (!at) return <span className="sa-muted">–</span>
  return (
    <time dateTime={at} title={formatAbsolute(at)}>
      {formatRelative(at, now)}
    </time>
  )
}

export function Tabs({ tabs, initial = 0, label }: { tabs: Array<{ id: string; label: string; content: React.ReactNode }>; initial?: number; label: string }) {
  const [active, setActive] = useState(initial)
  const base = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const move = (index: number) => {
    const next = (index + tabs.length) % tabs.length
    setActive(next)
    refs.current[next]?.focus()
  }
  return (
    <div className="sa-tabs">
      <div role="tablist" aria-label={label} className="sa-tabs__list">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[index] = el
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${tab.id}`}
            aria-controls={`${base}-panel-${tab.id}`}
            aria-selected={active === index}
            tabIndex={active === index ? 0 : -1}
            className={`sa-tabs__tab${active === index ? ' sa-tabs__tab--active' : ''}`}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') move(index + 1)
              else if (event.key === 'ArrowLeft') move(index - 1)
              else if (event.key === 'Home') move(0)
              else if (event.key === 'End') move(tabs.length - 1)
              else return
              event.preventDefault()
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div key={tab.id} role="tabpanel" id={`${base}-panel-${tab.id}`} aria-labelledby={`${base}-tab-${tab.id}`} hidden={active !== index} tabIndex={0} className="sa-tabs__panel">
          {tab.content}
        </div>
      ))}
    </div>
  )
}
