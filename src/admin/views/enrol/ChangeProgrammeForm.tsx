'use client'

/**
 * Enrol learners → Change programme: move learners from one programme to another. The rules live
 * in src/lib/programme-change.ts; this posts the list to /api/studio/programme-change in chunks
 * and shows a result for every email.
 */
import React, { useMemo, useState } from 'react'
import { LearnerSearch, ResultsTable, parseEmails, postChunk, type Programme, type Result } from './shared'

const CHUNK = 50
const MAX_EMAILS = 1000

export function ChangeProgrammeForm({ programmes, movable }: { programmes: Programme[]; movable: Programme[] }) {
  const [pasted, setPasted] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [note, setNote] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [results, setResults] = useState<Result[]>([])

  const emails = useMemo(() => {
    const seen = new Set<string>()
    return [...parseEmails(pasted), ...selected].filter((email) => {
      const key = email.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [pasted, selected])

  const from = movable.find((programme) => String(programme.id) === fromId)
  const to = programmes.find((programme) => String(programme.id) === toId)
  const same = Boolean(from && to && from.id === to.id)
  const canSubmit = !running && emails.length > 0 && emails.length <= MAX_EMAILS && Boolean(from && to) && !same
  const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

  async function submit() {
    if (!canSubmit || !from || !to) return
    if (!window.confirm(`Move ${people(emails.length)} from ${from.title} to ${to.title}? Their plan and remaining access move with them, and they start ${to.title} from the beginning. They lose access to ${from.title}.`)) return
    setRunning(true)
    setError('')
    setResults([])
    const collected: Result[] = []
    try {
      for (let start = 0; start < emails.length; start += CHUNK) {
        const chunk = emails.slice(start, start + CHUNK)
        setProgress(`Working on ${Math.min(start + chunk.length, emails.length)} of ${emails.length}…`)
        collected.push(...(await postChunk('/api/studio/programme-change', { fromCourseId: from.id, toCourseId: to.id, emails: chunk, note: note.trim() || undefined })))
        setResults([...collected])
      }
      setPasted('')
      setSelected([])
    } catch (err) {
      setError(`Stopped after ${collected.length} of ${emails.length}: ${err instanceof Error ? err.message : 'something went wrong'} Your list is still here; running it again skips the ones already moved.`)
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  return (
    <div className="sa-enrol">
      <section className="sa-card sa-enrol__section">
        <h2>Who</h2>
        <label className="sa-enrol__field">
          <span>Paste emails</span>
          <textarea rows={5} value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={'ada@example.com\ntobi@example.com'} disabled={running} />
        </label>
        <LearnerSearch selected={selected} onChange={setSelected} />
        {selected.length ? (
          <ul className="sa-enrol__chips" aria-label="Selected learners">
            {selected.map((email) => (
              <li key={email}>
                <button type="button" onClick={() => setSelected((prev) => prev.filter((item) => item !== email))} aria-label={`Remove ${email}`}>{email} ×</button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="sa-card sa-enrol__section">
        <h2>Move</h2>
        <div className="sa-enrol__row">
          <label className="sa-enrol__field">
            <span>From</span>
            <select value={fromId} onChange={(event) => setFromId(event.target.value)} disabled={running}>
              <option value="">Choose the current programme</option>
              {movable.map((programme) => (
                <option key={programme.id} value={programme.id}>{programme.title}</option>
              ))}
            </select>
          </label>
          <label className="sa-enrol__field">
            <span>To</span>
            <select value={toId} onChange={(event) => setToId(event.target.value)} disabled={running}>
              <option value="">Choose the new programme</option>
              {programmes.map((programme) => (
                <option key={programme.id} value={programme.id}>{programme.title}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="sa-enrol__field">
          <span>Note for the records (optional)</span>
          <input type="text" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why they’re moving" disabled={running} />
        </label>
        <div className="sa-enrol__submit">
          <button type="button" className="sa-button sa-button--primary" disabled={!canSubmit} onClick={() => void submit()}>
            {running ? 'Moving…' : emails.length ? `Move ${people(emails.length)}` : 'Move'}
          </button>
          <span className="sa-muted" role="status" aria-live="polite">
            {progress || (same ? 'Choose two different programmes.' : emails.length > MAX_EMAILS ? `That’s more than ${MAX_EMAILS}. Split the list.` : '')}
          </span>
        </div>
        <p className="sa-muted">
          Their enrolment, any monthly plan (with its price) and the access time they have left move to the new programme. They start it from the beginning, with a new learning plan from today. No one is charged or emailed. People who finished the old programme or reached its certificate, and people already on the new programme, are left as they are.
        </p>
        {error ? <p className="sa-enrol__error" role="alert">{error}</p> : null}
      </section>

      <ResultsTable results={results} showProgramme={false} />
    </div>
  )
}
