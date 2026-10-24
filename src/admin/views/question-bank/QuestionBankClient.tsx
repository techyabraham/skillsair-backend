'use client'

/**
 * Question cards with Approve / Retire (PATCH /api/quiz-questions/:id with the Studio session)
 * and keyboard shortcuts: J / K move between cards, E edits, A approves, R retires.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, Pencil, Archive } from 'lucide-react'
import type { BankQuestion } from '../../data/learning'

const FLAG_LABEL: Record<string, string> = {
  too_easy: 'Too easy (over 95% correct)',
  too_hard: 'Too hard (under 25% correct)',
  confusing: 'Doesn’t separate strong and weak learners',
}

async function setStatus(id: number, status: 'approved' | 'retired'): Promise<boolean> {
  const response = await fetch(`/api/quiz-questions/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  return response.ok
}

export function QuestionBankClient({ questions, chapters }: { questions: BankQuestion[]; chapters: Array<{ id: number; title: string }> }) {
  const [statuses, setStatuses] = useState<Record<number, string>>(() => Object.fromEntries(questions.map((q) => [q.id, q.status])))
  const [active, setActive] = useState(0)
  const [message, setMessage] = useState('')
  const cards = useRef<Array<HTMLElement | null>>([])
  const chapterTitle = new Map(chapters.map((c) => [c.id, c.title]))

  const change = useCallback(async (question: BankQuestion, status: 'approved' | 'retired') => {
    if (status === 'retired' && !window.confirm('Retire this question? It stops being drawn into quizzes; past attempts keep it.')) return
    const ok = await setStatus(question.id, status)
    if (ok) setStatuses((prev) => ({ ...prev, [question.id]: status }))
    setMessage(ok ? `Question ${status === 'approved' ? 'approved' : 'retired'}.` : 'That didn’t save. Refresh and try again.')
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) || target?.isContentEditable) return
      const key = event.key.toLowerCase()
      const question = questions[active]
      if (key === 'j' || key === 'k') {
        event.preventDefault()
        const next = Math.max(0, Math.min(questions.length - 1, active + (key === 'j' ? 1 : -1)))
        setActive(next)
        cards.current[next]?.focus()
      } else if (key === 'e' && question) {
        window.location.href = `/admin/collections/quiz-questions/${question.id}`
      } else if (key === 'a' && question && statuses[question.id] === 'draft') {
        void change(question, 'approved')
      } else if (key === 'r' && question && statuses[question.id] !== 'retired') {
        void change(question, 'retired')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, change, questions, statuses])

  return (
    <>
      <p className="sa-muted sa-qbank__keys">
        Keys: <kbd>J</kbd>/<kbd>K</kbd> next/previous · <kbd>E</kbd> edit · <kbd>A</kbd> approve · <kbd>R</kbd> retire
      </p>
      <p className="sa-visually-hidden" role="status" aria-live="polite">
        {message}
      </p>
      <ol className="sa-qbank__list">
        {questions.map((question, index) => {
          const status = statuses[question.id] ?? question.status
          return (
            <li key={question.id}>
              <article
                ref={(node) => {
                  cards.current[index] = node
                }}
                tabIndex={-1}
                onFocus={() => setActive(index)}
                className={`sa-qcard${index === active ? ' sa-qcard--active' : ''}${status === 'retired' ? ' sa-qcard--retired' : ''}`}
                aria-label={`Question ${index + 1}`}
              >
                <header className="sa-qcard__head">
                  <span className={`sa-qcard__status sa-qcard__status--${status}`}>{status}</span>
                  {question.sectionId ? <span className="sa-muted">{chapterTitle.get(question.sectionId)}</span> : null}
                  <span className="sa-muted">{question.pools.join(' · ') || 'no pool'}</span>
                  {question.type === 'multi' ? <span className="sa-muted">Choose all that apply</span> : null}
                </header>
                <p className="sa-qcard__prompt">{question.prompt}</p>
                <ol className="sa-qcard__options" type="A">
                  {question.options.map((option, i) => {
                    const correct = question.correct.includes(i)
                    return (
                      <li key={i} className={correct ? 'sa-qcard__option--correct' : undefined}>
                        {option}
                        {correct ? (
                          <span className="sa-qcard__tick">
                            <Check size={14} strokeWidth={2.5} aria-hidden /> <span className="sa-visually-hidden">Correct answer</span>
                          </span>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
                {question.explanation ? <p className="sa-qcard__explanation">{question.explanation}</p> : <p className="sa-qcard__explanation sa-muted">No explanation yet.</p>}
                {question.flags.length ? (
                  <ul className="sa-qcard__flags">
                    {question.flags.map((flag) => (
                      <li key={flag}>{FLAG_LABEL[flag] ?? flag}</li>
                    ))}
                  </ul>
                ) : null}
                <footer className="sa-qcard__foot">
                  <span className="sa-muted">
                    {question.stats.timesServed ? `${question.stats.timesServed} answers${question.stats.pValue !== null ? ` · ${Math.round(question.stats.pValue * 100)}% correct` : ''}${question.stats.discrimination !== null ? ` · discrimination ${question.stats.discrimination.toFixed(2)}` : ''}` : 'Not answered yet'}
                  </span>
                  {question.lessonId ? (
                    <a href={`/admin/collections/lessons/${question.lessonId}`} className="sa-qcard__source">
                      <ExternalLink size={13} aria-hidden /> {question.lessonTitle ?? 'Source lesson'}
                      {question.sourceTimestamp ? ` at ${question.sourceTimestamp}` : ''}
                    </a>
                  ) : null}
                  <span className="sa-qcard__actions">
                    <a className="sa-button sa-button--ghost sa-button--sm" href={`/admin/collections/quiz-questions/${question.id}`}>
                      <Pencil size={14} aria-hidden /> Edit
                    </a>
                    {status === 'draft' ? (
                      <button type="button" className="sa-button sa-button--secondary sa-button--sm" onClick={() => void change(question, 'approved')}>
                        <Check size={14} aria-hidden /> Approve
                      </button>
                    ) : null}
                    {status !== 'retired' ? (
                      <button type="button" className="sa-button sa-button--ghost sa-button--sm" onClick={() => void change(question, 'retired')}>
                        <Archive size={14} aria-hidden /> Retire
                      </button>
                    ) : null}
                  </span>
                </footer>
              </article>
            </li>
          )
        })}
      </ol>
    </>
  )
}

export function RetryTaskButton({ taskId }: { taskId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  return (
    <button
      type="button"
      className="sa-button sa-button--secondary sa-button--sm"
      disabled={state === 'busy' || state === 'done'}
      onClick={async () => {
        setState('busy')
        const response = await fetch(`/api/studio/work-queue/${taskId}/retry`, { method: 'POST', credentials: 'include' })
        setState(response.ok ? 'done' : 'failed')
      }}
    >
      {state === 'done' ? 'Queued again' : state === 'failed' ? 'Try again' : 'Retry'}
    </button>
  )
}
