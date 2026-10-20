'use client'

/**
 * Imisi's queue cards (client). Filters (All · Payment issues · Questions · New today), reply on
 * WhatsApp through the existing POST /api/leads/:id/whatsapp-reply (only inside the 24-hour
 * window), open the WhatsApp app (wa.me), and Mark done (POST /api/leads/:id/done). Marking done
 * animates the card out (instantly under reduced motion) and updates the nav badge through the
 * `studio:queue-count` event the nav listens for. No personal data is logged.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Check, ExternalLink, MessageCircle, Send } from 'lucide-react'
import { EMAIL_QUICK_REPLIES } from '../../../content/email-replies'
import { formatDuration, formatRelative } from '../../format'
import type { QueueItem, QueueReason } from '../../data/queue'

const REASON_LABEL: Record<QueueReason, string> = {
  payment: 'Payment failed',
  account: 'Account, no payment yet',
  whatsapp: 'Wrote on WhatsApp',
  question: 'Asked a question when applying',
  talk: 'Asked to talk to Imisi',
}

type Filter = 'all' | 'payment' | 'questions' | 'today'

const FILTERS: Array<{ key: Filter; label: string; test: (item: QueueItem) => boolean }> = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'payment', label: 'Payment issues', test: (item) => item.reason === 'payment' || item.reason === 'account' },
  { key: 'questions', label: 'Questions', test: (item) => item.reason === 'whatsapp' || item.reason === 'question' || item.reason === 'talk' },
  { key: 'today', label: 'New today', test: (item) => item.newToday },
]

async function post(path: string, body: Record<string, unknown> = {}) {
  const response = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!response.ok) throw new Error(json?.error?.message ?? 'That didn’t work. Try again.')
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function QueueCard({ item, now, onDone }: { item: QueueItem; now: number; onDone: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<'reply' | 'done' | null>(null)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [leaving, setLeaving] = useState(false)
  const replyId = `reply-${item.id}`

  const markDone = async () => {
    setBusy('done')
    setStatus(null)
    try {
      await post(`/api/leads/${item.id}/done`)
      if (prefersReducedMotion()) onDone(item.id)
      else {
        setLeaving(true)
        window.setTimeout(() => onDone(item.id), 220)
      }
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Couldn’t mark done.' })
      setBusy(null)
    }
  }

  const send = async () => {
    setBusy('reply')
    setStatus(null)
    try {
      await post(`/api/leads/${item.id}/whatsapp-reply`, { body })
      setBody('')
      setOpen(false)
      setStatus({ tone: 'ok', text: 'Sent on WhatsApp. Mark done when the conversation is handled.' })
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'The message wasn’t sent.' })
    } finally {
      setBusy(null)
    }
  }

  const waitLabel = formatDuration(item.waitingMs)
  return (
    <li className={`sa-queue__card${leaving ? ' sa-queue__card--leaving' : ''}`} aria-labelledby={`lead-${item.id}`}>
      <div className="sa-queue__top">
        <div className="sa-queue__who">
          <h2 className="sa-queue__name" id={`lead-${item.id}`}>
            <a href={`/admin/collections/leads/${item.id}`}>{item.firstName}</a>
          </h2>
          <p className="sa-queue__programme">
            {item.programme ?? 'No programme chosen'}
            {item.school ? <span className="sa-queue__school">{item.school.replace(/^School of /, '')}</span> : null}
          </p>
        </div>
        <div className="sa-queue__score" role="img" aria-label={`Score ${item.score} out of 100`}>
          <span className="sa-queue__score-value" aria-hidden="true">
            {item.score}
          </span>
          <span className="sa-queue__score-track" aria-hidden="true">
            <span style={{ width: `${item.score}%` }} />
          </span>
        </div>
      </div>

      <div className="sa-queue__meta">
        <span className={`sa-pill sa-pill--${item.reason === 'payment' ? 'critical' : item.reason === 'account' ? 'caution' : 'info'}`}>{REASON_LABEL[item.reason]}</span>
        <span className={`sa-queue__wait sa-queue__wait--${item.waitTone}`} title={`Waiting ${waitLabel} in total; ${formatDuration(item.workingMs)} in working hours`}>
          Waiting {waitLabel}
          {item.waitTone !== 'neutral' ? <span className="sa-visually-hidden"> ({item.waitTone === 'critical' ? 'over 4 working hours' : 'over 1 working hour'})</span> : null}
        </span>
      </div>

      {item.lastMessage ? (
        <blockquote className={`sa-queue__message sa-queue__message--${item.lastMessage.direction}`}>
          <span className="sa-visually-hidden">{item.lastMessage.direction === 'in' ? 'Their last message:' : 'Last message sent:'}</span>
          <p>{item.lastMessage.text}</p>
          <footer>
            {item.lastMessage.direction === 'in' ? 'From them' : 'From SkillsAir'} · {formatRelative(item.lastMessage.at, now)}
          </footer>
        </blockquote>
      ) : null}

      {open ? (
        <div className="sa-queue__reply">
          <div className="sa-queue__quick" role="group" aria-label="Suggested replies">
            {EMAIL_QUICK_REPLIES.map((reply) => (
              <button key={reply.label} type="button" className="sa-chip" onClick={() => setBody(reply.body)}>
                {reply.label}
              </button>
            ))}
          </div>
          <label htmlFor={replyId} className="sa-queue__label">
            Reply to {item.firstName} on WhatsApp <span className="sa-muted">(edit the [bracketed] parts first)</span>
          </label>
          <textarea id={replyId} value={body} onChange={(event) => setBody(event.target.value)} rows={4} className="sa-textarea" />
          <div className="sa-queue__actions">
            <button type="button" className="sa-button sa-button--whatsapp" disabled={busy !== null || !body.trim()} onClick={send}>
              <Send size={16} strokeWidth={2} aria-hidden /> {busy === 'reply' ? 'Sending…' : 'Send reply'}
            </button>
            <button type="button" className="sa-button sa-button--ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="sa-queue__actions">
        {!open ? (
          <button
            type="button"
            className="sa-button sa-button--whatsapp sa-queue__primary"
            disabled={!item.canReply || busy !== null}
            aria-describedby={!item.canReply ? `why-${item.id}` : undefined}
            onClick={() => setOpen(true)}
          >
            <MessageCircle size={18} strokeWidth={2} aria-hidden /> Reply on WhatsApp
          </button>
        ) : null}
        {item.whatsappNumber && !item.optedOut ? (
          <a className="sa-button sa-button--secondary" href={`https://wa.me/${item.whatsappNumber}`} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={16} strokeWidth={2} aria-hidden /> Open WhatsApp app
          </a>
        ) : null}
        <button type="button" className="sa-button sa-button--secondary" disabled={busy !== null} onClick={markDone}>
          <Check size={16} strokeWidth={2.25} aria-hidden /> {busy === 'done' ? 'Marking…' : 'Mark done'}
        </button>
      </div>
      {!item.canReply ? (
        <p className="sa-queue__why" id={`why-${item.id}`}>
          {item.optedOut
            ? 'They replied STOP on WhatsApp, so don’t message them unless they write START.'
            : 'They haven’t messaged in the last 24 hours, so WhatsApp only allows an approved template. Use the WhatsApp app or email instead.'}
        </p>
      ) : item.replyClosesAt ? (
        <p className="sa-queue__why">Reply window closes {formatRelative(item.replyClosesAt, now).replace(' ago', '')}.</p>
      ) : null}
      {status ? (
        <p role="status" className={`sa-queue__status sa-queue__status--${status.tone}`}>
          {status.text}
        </p>
      ) : null}
    </li>
  )
}

export function QueueBoard({ items: initial, initialNow }: { items: QueueItem[]; initialNow: number }) {
  const [items, setItems] = useState(initial)
  const [filter, setFilter] = useState<Filter>('all')
  const [now, setNow] = useState(initialNow)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('studio:queue-count', { detail: { count: items.length } }))
  }, [items.length])

  const visible = useMemo(() => items.filter(FILTERS.find((f) => f.key === filter)!.test), [items, filter])

  return (
    <div className="sa-queue">
      <div className="sa-queue__filters" role="group" aria-label="Filter the queue">
        <div className="sa-segmented">
          {FILTERS.map((f) => {
            const count = items.filter(f.test).length
            return (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label} <span className="sa-segmented__count">{count}</span>
              </button>
            )
          })}
        </div>
      </div>
      <p className="sa-visually-hidden" role="status">
        {visible.length} {visible.length === 1 ? 'person' : 'people'} shown
      </p>
      {visible.length ? (
        <ol className="sa-queue__list">
          {visible.map((item) => (
            <QueueCard key={item.id} item={item} now={now} onDone={(id) => setItems((current) => current.filter((i) => i.id !== id))} />
          ))}
        </ol>
      ) : (
        <div className="sa-card sa-empty">
          <span className="sa-empty__icon" aria-hidden="true">
            <Check size={22} strokeWidth={2} />
          </span>
          <p className="sa-empty__title">{items.length ? 'Nobody in this filter' : 'All caught up ✓'}</p>
          <p className="sa-empty__text">{items.length ? 'Try “All” to see everyone waiting.' : 'New people appear here when they ask for help or a payment fails.'}</p>
        </div>
      )}
    </div>
  )
}
