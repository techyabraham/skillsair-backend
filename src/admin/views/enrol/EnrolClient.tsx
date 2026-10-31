'use client'

/**
 * The Enrol learners form. Learner search reads /api/users with the Studio session. Enrolling
 * posts to /api/studio/manual-enrolment in chunks, so a long list shows progress and a chunk that
 * fails doesn't lose the others; running the list again the same day changes nothing twice.
 */
import React, { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

const CHUNK = 50
const MAX_EMAILS = 1000

type Status = 'created' | 'enrolled' | 'extended' | 'skipped' | 'failed'

interface Result {
  email: string
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

const STATUS_LABEL: Record<Status, string> = { created: 'New account', enrolled: 'Enrolled', extended: 'Extended', skipped: 'No change', failed: 'Failed' }
const STATUS_TONE: Record<Status, string> = { created: 'positive', enrolled: 'positive', extended: 'positive', skipped: 'caution', failed: 'critical' }

/** Commas, semicolons, spaces or new lines; a pasted "Ada Obi <ada@x.com>" keeps the address. */
export function parseEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.replace(/^[<("']+|[>)"']+$/g, '').trim())
    .filter((part) => part.includes('@') || part.includes('.'))
}

async function searchLearners(term: string): Promise<Learner[]> {
  const query = new URLSearchParams({ limit: '30', depth: '0', sort: 'email', 'select[email]': 'true', 'select[firstName]': 'true', 'select[lastName]': 'true' })
  query.set('where[or][0][email][contains]', term)
  query.set('where[or][1][firstName][contains]', term)
  query.set('where[or][2][lastName][contains]', term)
  const response = await fetch(`/api/users?${query.toString()}`, { credentials: 'include' })
  if (!response.ok) throw new Error('search failed')
  return ((await response.json()) as { docs: Learner[] }).docs
}

export function EnrolClient({ courses }: { courses: Array<{ id: number; title: string }> }) {
  const [pasted, setPasted] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [term, setTerm] = useState('')
  const [found, setFound] = useState<Learner[] | null>(null)
  const [searchError, setSearchError] = useState('')
  const [courseId, setCourseId] = useState(courses[0] ? String(courses[0].id) : '')
  const [amount, setAmount] = useState('3')
  const [unit, setUnit] = useState<'months' | 'days'>('months')
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [results, setResults] = useState<Result[]>([])

  const emails = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const email of [...parseEmails(pasted), ...selected]) {
      const key = email.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        list.push(email)
      }
    }
    return list
  }, [pasted, selected])

  const count = Number(amount)
  const durationValid = Number.isInteger(count) && count >= 1 && count <= (unit === 'months' ? 60 : 1825)
  const canSubmit = !running && emails.length > 0 && emails.length <= MAX_EMAILS && Boolean(courseId) && durationValid
  const courseTitle = courses.find((course) => String(course.id) === courseId)?.title ?? ''
  const durationText = `${amount} ${count === 1 ? unit.slice(0, -1) : unit}`

  const toggle = (email: string) => setSelected((prev) => (prev.includes(email) ? prev.filter((item) => item !== email) : [...prev, email]))

  async function search(event: React.FormEvent) {
    event.preventDefault()
    if (!term.trim()) return
    setSearchError('')
    try {
      setFound(await searchLearners(term.trim()))
    } catch {
      setFound(null)
      setSearchError('The search didn’t work. Refresh and try again.')
    }
  }

  async function submit() {
    if (!canSubmit) return
    if (!window.confirm(`Enrol ${emails.length} ${emails.length === 1 ? 'person' : 'people'} on ${courseTitle} for ${durationText}, with no payment?`)) return
    setRunning(true)
    setError('')
    setResults([])
    const collected: Result[] = []
    try {
      for (let start = 0; start < emails.length; start += CHUNK) {
        const chunk = emails.slice(start, start + CHUNK)
        setProgress(`Working on ${Math.min(start + chunk.length, emails.length)} of ${emails.length}…`)
        const response = await fetch('/api/studio/manual-enrolment', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId: Number(courseId), emails: chunk, duration: { unit, amount: count }, note: note.trim() || undefined, notify }),
        })
        const body = (await response.json().catch(() => null)) as { data?: { results?: Result[] }; error?: { message?: string } } | null
        if (!response.ok || !body?.data?.results) throw new Error(body?.error?.message ?? 'The server didn’t answer.')
        collected.push(...body.data.results)
        setResults([...collected])
      }
      setPasted('')
      setSelected([])
    } catch (err) {
      setError(`Stopped after ${collected.length} of ${emails.length}: ${err instanceof Error ? err.message : 'something went wrong'} Your list is still here; running it again won’t repeat the ones already done today.`)
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  const tally = (statuses: Status[]) => results.filter((result) => statuses.includes(result.status)).length

  return (
    <div className="sa-enrol">
      <section className="sa-card sa-enrol__section">
        <h2>Who</h2>
        <label className="sa-enrol__field">
          <span>Paste emails</span>
          <textarea rows={6} value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={'ada@example.com\ntobi@example.com'} disabled={running} />
        </label>

        <form className="sa-enrol__search" onSubmit={search}>
          <label className="sa-enrol__field">
            <span>Or find existing learners</span>
            <input type="search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Name or email" />
          </label>
          <button type="submit" className="sa-button sa-button--secondary sa-button--sm">
            <Search size={15} strokeWidth={2} aria-hidden="true" /> Search
          </button>
        </form>
        {searchError ? <p className="sa-muted" role="alert">{searchError}</p> : null}
        {found ? (
          found.length ? (
            <>
              <div className="sa-enrol__found-actions">
                <span className="sa-muted">{found.length === 30 ? 'First 30 matches' : `${found.length} found`}</span>
                <button type="button" className="sa-button sa-button--ghost sa-button--sm" onClick={() => setSelected((prev) => [...new Set([...prev, ...found.map((learner) => learner.email)])])}>Select all</button>
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

        {selected.length ? (
          <ul className="sa-enrol__chips" aria-label="Selected learners">
            {selected.map((email) => (
              <li key={email}>
                <button type="button" onClick={() => toggle(email)} aria-label={`Remove ${email}`}>{email} ×</button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="sa-card sa-enrol__section">
        <h2>What</h2>
        <div className="sa-enrol__row">
          <label className="sa-enrol__field">
            <span>Programme</span>
            <select value={courseId} onChange={(event) => setCourseId(event.target.value)} disabled={running}>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>{course.title}</option>
              ))}
            </select>
          </label>
          <label className="sa-enrol__field sa-enrol__field--short">
            <span>For</span>
            <input type="number" min={1} max={unit === 'months' ? 60 : 1825} value={amount} onChange={(event) => setAmount(event.target.value)} disabled={running} />
          </label>
          <label className="sa-enrol__field sa-enrol__field--short">
            <span>Unit</span>
            <select value={unit} onChange={(event) => setUnit(event.target.value as 'months' | 'days')} disabled={running}>
              <option value="months">Months</option>
              <option value="days">Days</option>
            </select>
          </label>
        </div>
        <label className="sa-enrol__field">
          <span>Note for the records (optional)</span>
          <input type="text" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why they’re getting this" disabled={running} />
        </label>
        <label className="sa-enrol__check">
          <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} disabled={running} />
          <span>Email them. New accounts need this to get their set-password link.</span>
        </label>
        <div className="sa-enrol__submit">
          <button type="button" className="sa-button sa-button--primary" disabled={!canSubmit} onClick={() => void submit()}>
            {running ? 'Enrolling…' : `Enrol ${emails.length || ''} ${emails.length === 1 ? 'person' : 'people'}`}
          </button>
          <span className="sa-muted" role="status" aria-live="polite">
            {progress || (emails.length > MAX_EMAILS ? `That’s more than ${MAX_EMAILS}. Split the list.` : !durationValid ? `Choose 1 to ${unit === 'months' ? 60 : 1825} ${unit}.` : '')}
          </span>
        </div>
        <p className="sa-muted">People on a paid plan for this programme, or with permanent access, are left as they are. Someone already enrolled gets the time added to what they have.</p>
        {error ? <p className="sa-enrol__error" role="alert">{error}</p> : null}
      </section>

      {results.length ? (
        <section className="sa-card sa-enrol__section">
          <h2>Results</h2>
          <p>
            {tally(['created'])} new · {tally(['enrolled'])} enrolled · {tally(['extended'])} extended · {tally(['skipped'])} no change · {tally(['failed'])} failed
          </p>
          <div className="sa-table-wrap">
            <table className="sa-table">
              <caption className="sa-visually-hidden">Result for each email</caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Result</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, index) => (
                  <tr key={`${result.email}-${index}`}>
                    <th scope="row">{result.email}</th>
                    <td><span className={`sa-enrol__status sa-enrol__status--${STATUS_TONE[result.status]}`}>{STATUS_LABEL[result.status]}</span></td>
                    <td>{result.message}{result.emailQueued ? ' Email on its way.' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
