'use client'

/**
 * Pieces shared by the two Enrol learners tabs: finding existing learners, programme tick-boxes and
 * the results table. Reading a pasted list lives in paste.ts.
 */
import React, { useState } from 'react'
import { Search } from 'lucide-react'
import type { Programme } from './paste'

export { matchProgramme, parseEmails, parsePastedLines, type PastedLine, type Programme } from './paste'

export type Status = 'created' | 'enrolled' | 'extended' | 'changed' | 'skipped' | 'failed'

export interface Result {
  email: string
  programme?: string
  status: Status
  message: string
  emailQueued?: boolean
}

interface Learner {
  id: number
  email: string
  firstName?: string | null
  lastName?: string | null
}

const STATUS_LABEL: Record<Status, string> = { created: 'New account', enrolled: 'Enrolled', extended: 'Extended', changed: 'Moved', skipped: 'No change', failed: 'Failed' }
const STATUS_TONE: Record<Status, string> = { created: 'positive', enrolled: 'positive', extended: 'positive', changed: 'positive', skipped: 'caution', failed: 'critical' }

async function searchLearners(term: string): Promise<Learner[]> {
  const query = new URLSearchParams({ limit: '30', depth: '0', sort: 'email', 'select[email]': 'true', 'select[firstName]': 'true', 'select[lastName]': 'true' })
  query.set('where[or][0][email][contains]', term)
  query.set('where[or][1][firstName][contains]', term)
  query.set('where[or][2][lastName][contains]', term)
  const response = await fetch(`/api/users?${query.toString()}`, { credentials: 'include' })
  if (!response.ok) throw new Error('search failed')
  return ((await response.json()) as { docs: Learner[] }).docs
}

/** Search existing learners and tick them; ticked emails go to `selected`. */
export function LearnerSearch({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const [term, setTerm] = useState('')
  const [found, setFound] = useState<Learner[] | null>(null)
  const [error, setError] = useState('')

  const toggle = (email: string) => onChange(selected.includes(email) ? selected.filter((item) => item !== email) : [...selected, email])

  async function search(event: React.FormEvent) {
    event.preventDefault()
    if (!term.trim()) return
    setError('')
    try {
      setFound(await searchLearners(term.trim()))
    } catch {
      setFound(null)
      setError('The search didn’t work. Refresh and try again.')
    }
  }

  return (
    <>
      <form className="sa-enrol__search" onSubmit={search}>
        <label className="sa-enrol__field">
          <span>Or find existing learners</span>
          <input type="search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Name or email" />
        </label>
        <button type="submit" className="sa-button sa-button--secondary sa-button--sm">
          <Search size={15} strokeWidth={2} aria-hidden="true" /> Search
        </button>
      </form>
      {error ? <p className="sa-muted" role="alert">{error}</p> : null}
      {found ? (
        found.length ? (
          <>
            <div className="sa-enrol__found-actions">
              <span className="sa-muted">{found.length === 30 ? 'First 30 matches' : `${found.length} found`}</span>
              <button type="button" className="sa-button sa-button--ghost sa-button--sm" onClick={() => onChange([...new Set([...selected, ...found.map((learner) => learner.email)])])}>Select all</button>
            </div>
            <ul className="sa-enrol__found">
              {found.map((learner) => (
                <li key={learner.id}>
                  <label>
                    <input type="checkbox" checked={selected.includes(learner.email)} onChange={() => toggle(learner.email)} />
                    <span>{[learner.firstName, learner.lastName].filter(Boolean).join(' ') || 'No name'}</span>
                    <span className="sa-muted">{learner.email}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="sa-muted">Nobody matches. Paste the email above to create an account.</p>
        )
      ) : null}
    </>
  )
}

/** Programmes as tick-boxes (several can be chosen). */
export function ProgrammeChecks({
  programmes,
  value,
  onChange,
  disabled,
  legend,
}: {
  programmes: Programme[]
  value: number[]
  onChange: (next: number[]) => void
  disabled?: boolean
  legend: string
}) {
  return (
    <fieldset className="sa-enrol__programmes" disabled={disabled}>
      <legend>{legend}</legend>
      {programmes.map((programme) => (
        <label key={programme.id} className="sa-enrol__check">
          <input
            type="checkbox"
            checked={value.includes(programme.id)}
            onChange={(event) => onChange(event.target.checked ? [...value, programme.id] : value.filter((id) => id !== programme.id))}
          />
          <span>{programme.title}</span>
        </label>
      ))}
    </fieldset>
  )
}

export function ResultsTable({ results, showProgramme }: { results: Result[]; showProgramme: boolean }) {
  if (!results.length) return null
  const tally = (statuses: Status[]) => results.filter((result) => statuses.includes(result.status)).length
  const done = tally(['created', 'enrolled', 'extended', 'changed'])
  return (
    <section className="sa-card sa-enrol__section">
      <h2>Results</h2>
      <p>
        {showProgramme
          ? `${tally(['created'])} new · ${tally(['enrolled'])} enrolled · ${tally(['extended'])} extended`
          : `${done} moved`}{' '}
        · {tally(['skipped'])} no change · {tally(['failed'])} failed
      </p>
      <div className="sa-table-wrap">
        <table className="sa-table">
          <caption className="sa-visually-hidden">Result for each {showProgramme ? 'learner and programme' : 'email'}</caption>
          <thead>
            <tr>
              <th scope="col">Email</th>
              {showProgramme ? <th scope="col">Programme</th> : null}
              <th scope="col">Result</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={`${result.email}-${result.programme ?? ''}-${index}`}>
                <th scope="row">{result.email}</th>
                {showProgramme ? <td>{result.programme ?? '–'}</td> : null}
                <td><span className={`sa-enrol__status sa-enrol__status--${STATUS_TONE[result.status]}`}>{STATUS_LABEL[result.status]}</span></td>
                <td>{result.message}{result.emailQueued ? ' Email on its way.' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** POSTs one chunk to a Studio endpoint and returns its results, or throws with the server's message. */
export async function postChunk(path: string, body: unknown): Promise<Result[]> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await response.json().catch(() => null)) as { data?: { results?: Result[] }; error?: { message?: string } } | null
  if (!response.ok || !json?.data?.results) throw new Error(json?.error?.message ?? 'The server didn’t answer.')
  return json.data.results
}
