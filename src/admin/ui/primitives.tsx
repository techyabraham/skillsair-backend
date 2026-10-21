/**
 * SkillsAir Studio primitives (brief section 8). Server components; styles in
 * src/app/(payload)/styles/studio.css under the `.sa-` prefix, colours only via --sa-* tokens.
 *
 * Card / CardHeader     base surface; header = eyebrow, title (h2), optional action
 * StatusPill            text always visible + icon shape; variants positive|caution|critical|info|neutral|accent
 * Avatar                image or initials on a colour from the name hash (chart palette)
 * Money                 ₦ formatting (compact option), tabular numbers
 * EmptyState            icon in a soft circle, title, one sentence, one action
 * Skeleton              shimmer block (static under reduced motion)
 * Callout               info | caution | critical note with icon
 * ProgressBar / Ring    0–100 progress with visible value
 * InfoTip               "i" with the metric definition (hover/focus, no JS)
 * Timeline              icon, title, meta, time
 * ChatBubbles           WhatsApp log: inbound left (white), outbound right (soft green)
 * MaskedPhone           +234 818 ••• 6524; full number only with `reveal` (admins on the edit view)
 */
import React from 'react'
import { AlertTriangle, Check, CircleDot, Clock, Info, Minus, OctagonAlert, X } from 'lucide-react'
import { formatAbsolute, formatNaira, formatRelative, hashIndex, initials, maskPhone } from '../format'

type Children = { children?: React.ReactNode }
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

export function Card({ children, className, as: Tag = 'section', ...rest }: Children & { className?: string; as?: 'section' | 'article' | 'div' } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cx('sa-card', className)} {...rest}>
      {children}
    </Tag>
  )
}

export function CardHeader({ eyebrow, title, action, id, level = 2 }: { eyebrow?: string; title: React.ReactNode; action?: React.ReactNode; id?: string; level?: 2 | 3 }) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <header className="sa-card__header">
      <div>
        {eyebrow ? <p className="sa-eyebrow">{eyebrow}</p> : null}
        <Heading className="sa-card__title" id={id}>
          {title}
        </Heading>
      </div>
      {action ? <div className="sa-card__action">{action}</div> : null}
    </header>
  )
}

export type Tone = 'positive' | 'caution' | 'critical' | 'info' | 'neutral' | 'accent'

const TONE_ICON: Record<Tone, React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>> = {
  positive: Check,
  caution: AlertTriangle,
  critical: X,
  info: CircleDot,
  neutral: Minus,
  accent: Clock,
}

export function StatusPill({ tone, children, icon = true, title }: Children & { tone: Tone; icon?: boolean; title?: string }) {
  const Icon = TONE_ICON[tone]
  return (
    <span className={`sa-pill sa-pill--${tone}`} title={title}>
      {icon ? <Icon size={12} strokeWidth={2.5} aria-hidden /> : null}
      <span>{children}</span>
    </span>
  )
}

const AVATAR_TONES = 6

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) }
  if (src) return <img className="sa-avatar" src={src} alt="" width={size} height={size} style={style} />
  return (
    <span className={`sa-avatar sa-avatar--${hashIndex(name, AVATAR_TONES) + 1}`} style={style} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

export function Money({ amount, compact, className }: { amount: number | null | undefined; compact?: boolean; className?: string }) {
  return (
    <span className={cx('sa-money', className)} title={compact ? formatNaira(amount) : undefined}>
      {formatNaira(amount, { compact })}
    </span>
  )
}

export function EmptyState({ icon, title, children, action }: Children & { icon: React.ReactNode; title: string; action?: { href: string; label: string } }) {
  return (
    <div className="sa-empty">
      <span className="sa-empty__icon" aria-hidden="true">
        {icon}
      </span>
      <p className="sa-empty__title">{title}</p>
      {children ? <p className="sa-empty__text">{children}</p> : null}
      {action ? (
        <a className="sa-link sa-empty__action" href={action.href}>
          {action.label} <span aria-hidden="true">→</span>
        </a>
      ) : null}
    </div>
  )
}

export function Skeleton({ width = '100%', height = 16, radius = 6, label }: { width?: number | string; height?: number | string; radius?: number; label?: string }) {
  return <span className="sa-skeleton" style={{ width, height, borderRadius: radius }} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}

const CALLOUT_ICON = { info: Info, caution: AlertTriangle, critical: OctagonAlert }

export function Callout({ tone = 'info', title, children }: Children & { tone?: 'info' | 'caution' | 'critical'; title?: string }) {
  const Icon = CALLOUT_ICON[tone]
  return (
    <div className={`sa-callout sa-callout--${tone}`} role={tone === 'critical' ? 'alert' : undefined}>
      <Icon size={18} strokeWidth={1.75} aria-hidden />
      <div>
        {title ? <p className="sa-callout__title">{title}</p> : null}
        <div className="sa-callout__body">{children}</div>
      </div>
    </div>
  )
}

export function ProgressBar({ value, label, tone = 'accent', showValue = true }: { value: number; label: string; tone?: 'accent' | 'positive' | 'info' | 'caution' | 'critical'; showValue?: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <span className="sa-progress">
      <span className="sa-progress__track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span className={`sa-progress__fill sa-progress__fill--${tone}`} style={{ width: `${pct}%` }} />
      </span>
      {showValue ? <span className="sa-progress__value">{pct}%</span> : null}
    </span>
  )
}

export function ProgressRing({ value, size = 40, label, stroke = 4 }: { value: number; size?: number; label: string; stroke?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const tone = pct >= 100 ? 'positive' : pct >= 60 ? 'caution' : 'critical'
  return (
    <span className="sa-ring" role="img" aria-label={`${label}: ${pct}%`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="sa-ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className={`sa-ring__fill sa-ring__fill--${tone}`}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="sa-ring__value" aria-hidden="true">
        {pct}
      </span>
    </span>
  )
}

/** Hover/focus tooltip with a definition. The text is also exposed as the button's description. */
export function InfoTip({ text, label = 'What this means' }: { text: string; label?: string }) {
  return (
    <span className="sa-infotip">
      <button type="button" className="sa-infotip__button" aria-label={`${label}: ${text}`}>
        <Info size={14} strokeWidth={2} aria-hidden />
      </button>
      <span className="sa-infotip__bubble" role="tooltip" aria-hidden="true">
        {text}
      </span>
    </span>
  )
}

export interface TimelineItem {
  id: string
  icon: React.ReactNode
  title: React.ReactNode
  meta?: React.ReactNode
  at: string | number | Date | null
  href?: string
  tone?: Tone
}

export function Timeline({ items, now }: { items: TimelineItem[]; now?: number }) {
  return (
    <ol className="sa-timeline">
      {items.map((item) => {
        const body = (
          <>
            <span className={`sa-timeline__icon sa-timeline__icon--${item.tone ?? 'neutral'}`} aria-hidden="true">
              {item.icon}
            </span>
            <span className="sa-timeline__body">
              <span className="sa-timeline__title">{item.title}</span>
              {item.meta ? <span className="sa-timeline__meta">{item.meta}</span> : null}
            </span>
            <time className="sa-timeline__time" dateTime={item.at ? new Date(item.at).toISOString() : undefined} title={formatAbsolute(item.at)}>
              {formatRelative(item.at, now)}
            </time>
          </>
        )
        return (
          <li key={item.id} className="sa-timeline__item">
            {item.href ? (
              <a className="sa-timeline__link" href={item.href}>
                {body}
              </a>
            ) : (
              <div className="sa-timeline__link">{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export interface ChatMessage {
  direction: 'in' | 'out'
  body?: string | null
  template?: string | null
  type?: string | null
  at: string
}

export function ChatBubbles({ messages, now }: { messages: ChatMessage[]; now?: number }) {
  return (
    <ol className="sa-chat" aria-label="WhatsApp conversation">
      {messages.map((message, index) => (
        <li key={`${message.at}-${index}`} className={`sa-chat__row sa-chat__row--${message.direction}`}>
          <div className={`sa-chat__bubble sa-chat__bubble--${message.direction}`}>
            <span className="sa-visually-hidden">{message.direction === 'in' ? 'They wrote:' : 'SkillsAir sent:'}</span>
            {message.body ? <p>{message.body}</p> : <p className="sa-chat__template">Template: {message.template ?? message.type ?? 'message'}</p>}
            <time dateTime={message.at} title={formatAbsolute(message.at)}>
              {formatRelative(message.at, now)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Phones are masked in lists; `reveal` (admin, edit view only) shows the full number. */
export function MaskedPhone({ phone, reveal = false }: { phone: string | null | undefined; reveal?: boolean }) {
  if (!phone) return <span className="sa-muted">–</span>
  if (reveal) return <span className="sa-mono">{phone}</span>
  return (
    <span className="sa-mono" title="Open the record to see the full number">
      {maskPhone(phone)}
    </span>
  )
}
