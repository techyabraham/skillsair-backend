'use client'

/** Buttons for the programme's learning-quality panels (caption re-import, restore history) and Learner 360 (plan reset). */
import React, { useState } from 'react'

type State = 'idle' | 'busy' | 'done' | 'failed'

async function post(url: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch(url, { method: 'POST', credentials: 'include' })
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    return { ok: response.ok, message: body?.error?.message }
  } catch {
    return { ok: false }
  }
}

export function CaptionsImportButton({ courseId }: { courseId: number }) {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')
  return (
    <div className="sa-learning__action">
      <button
        type="button"
        className="sa-button sa-button--secondary sa-button--sm"
        disabled={state === 'busy' || state === 'done'}
        onClick={async () => {
          setState('busy')
          const result = await post(`/api/studio/programmes/${courseId}/captions-import`)
          setState(result.ok ? 'done' : 'failed')
          setMessage(result.ok ? 'Queued. Subtitles update within a few minutes.' : result.message ?? 'That didn’t work. Try again.')
        }}
      >
        {state === 'busy' ? 'Queuing…' : 'Re-import captions'}
      </button>
      <p className="sa-muted" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  )
}

export function RestoreHistoryButton({ courseId, index }: { courseId: number; index: number }) {
  const [state, setState] = useState<State>('idle')
  return (
    <button
      type="button"
      className="sa-button sa-button--ghost sa-button--sm"
      disabled={state === 'busy'}
      onClick={async () => {
        if (!window.confirm('Restore this version of the programme copy? The current copy is saved to History first.')) return
        setState('busy')
        const result = await post(`/api/studio/programmes/${courseId}/history/${index}/restore`)
        setState(result.ok ? 'done' : 'failed')
        if (result.ok) window.location.reload()
      }}
    >
      {state === 'failed' ? 'Try again' : state === 'busy' ? 'Restoring…' : 'Restore'}
    </button>
  )
}

const EXTRA_TIME = [
  { value: 1, label: 'Standard time' },
  { value: 1.25, label: '25% extra time' },
  { value: 1.5, label: '50% extra time' },
  { value: 2, label: 'Double time' },
]

/** Learner 360: extra time for timed quizzes and exams (an accessibility accommodation; admins only). */
export function ExtraTimeControl({ userId, initial }: { userId: number; initial: number }) {
  const [value, setValue] = useState(initial)
  const [message, setMessage] = useState('')
  return (
    <label className="sa-learning__action">
      <span className="sa-learner360__title">Exam time</span>
      <select
        value={String(value)}
        onChange={async (event) => {
          const next = Number(event.target.value)
          const previous = value
          setValue(next)
          const response = await fetch(`/api/users/${userId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ examTimeMultiplier: next }) }).catch(() => null)
          if (response?.ok) setMessage('Saved. Applies to the next quiz or exam they start.')
          else {
            setValue(previous)
            setMessage('That didn’t save. Try again.')
          }
        }}
      >
        {[...EXTRA_TIME, ...(EXTRA_TIME.some((option) => option.value === value) ? [] : [{ value, label: `${value}× time` }])].map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="sa-muted" role="status" aria-live="polite">
        {message}
      </span>
    </label>
  )
}

/** Learner 360: move a learner's guided plan so their first unfinished step is this week (no cooldown for admins). */
export function PlanResetButton({ enrollmentId }: { enrollmentId: number }) {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')
  return (
    <span className="sa-learning__action">
      <button
        type="button"
        className="sa-button sa-button--ghost sa-button--sm"
        disabled={state === 'busy'}
        onClick={async () => {
          if (!window.confirm('Reset this plan? Their first unfinished step becomes this week. The learner’s own 14-day limit does not apply.')) return
          setState('busy')
          const result = await post(`/api/studio/enrollments/${enrollmentId}/plan-reset`)
          setState(result.ok ? 'done' : 'failed')
          setMessage(result.ok ? 'Plan reset.' : result.message ?? 'That didn’t work. Try again.')
          if (result.ok) window.location.reload()
        }}
      >
        {state === 'busy' ? 'Resetting…' : 'Reset plan'}
      </button>
      <span className="sa-muted" role="status" aria-live="polite">
        {message}
      </span>
    </span>
  )
}
