'use client'

/**
 * The Enrol learners screen: two tabs. "Enrol" gives each learner one or more programmes (the
 * same for everyone, or their own, set per row or written after the email when pasting).
 * "Change programme" moves learners from one programme to another (ChangeProgrammeForm).
 *
 * Learner search reads /api/users with the Studio session. Enrolling posts to
 * /api/studio/manual-enrolment in chunks, so a long list shows progress and a chunk that fails
 * doesn't lose the others; running the list again the same day changes nothing twice.
 */
import React, { useMemo, useState } from 'react'
import { Tabs } from '../../ui/client'
import { ChangeProgrammeForm } from './ChangeProgrammeForm'
import { LearnerSearch, ProgrammeChecks, ResultsTable, matchProgramme, parsePastedLines, postChunk, type Programme, type Result } from './shared'

/** Per request: the endpoint takes at most 50 learner-programme pairs. */
const CHUNK_PAIRS = 50
const MAX_LEARNERS = 1000

interface Row {
  key: string
  email: string
  courseIds: number[]
  /** Where courseIds came from: chosen on this row, written in the pasted line, or the default. */
  source: 'row' | 'pasted' | 'default'
  unknown: string[]
}

/** Splits entries into requests of at most CHUNK_PAIRS learner-programme pairs. */
function chunkEntries(entries: Array<{ email: string; courseIds: number[] }>) {
  const chunks: Array<typeof entries> = []
  let current: typeof entries = []
  let pairs = 0
  for (const entry of entries) {
    const size = Math.max(1, entry.courseIds.length)
    if (current.length && pairs + size > CHUNK_PAIRS) {
      chunks.push(current)
      current = []
      pairs = 0
    }
    current.push(entry)
    pairs += size
  }
  if (current.length) chunks.push(current)
  return chunks
}

function EnrolForm({ programmes }: { programmes: Programme[] }) {
  const [pasted, setPasted] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [defaults, setDefaults] = useState<number[]>([])
  const [overrides, setOverrides] = useState<Record<string, number[]>>({})
  const [excluded, setExcluded] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [amount, setAmount] = useState('3')
  const [unit, setUnit] = useState<'months' | 'days'>('months')
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [results, setResults] = useState<Result[]>([])

  const titleOf = useMemo(() => new Map(programmes.map((programme) => [programme.id, programme.title])), [programmes])

  const rows = useMemo<Row[]>(() => {
    const byKey = new Map<string, { email: string; names: string[] }>()
    const add = (email: string, names: string[]) => {
      const key = email.toLowerCase()
      const row = byKey.get(key) ?? { email, names: [] }
      row.names.push(...names)
      byKey.set(key, row)
    }
    for (const line of parsePastedLines(pasted)) for (const email of line.emails) add(email, line.names)
    for (const email of selected) add(email, [])
    return [...byKey.entries()]
      .filter(([key]) => !excluded.includes(key))
      .map(([key, { email, names }]) => {
        if (overrides[key]) return { key, email, courseIds: overrides[key]!, source: 'row' as const, unknown: [] }
        if (names.length) {
          const unknown: string[] = []
          const ids: number[] = []
          for (const name of names) {
            const match = matchProgramme(name, programmes)
            if (!match) unknown.push(name)
            else if (!ids.includes(match.id)) ids.push(match.id)
          }
          return { key, email, courseIds: ids, source: 'pasted' as const, unknown }
        }
        return { key, email, courseIds: defaults, source: 'default' as const, unknown: [] }
      })
  }, [pasted, selected, excluded, overrides, defaults, programmes])

  const ignoredLines = pasted.split(/\r?\n/).filter((line) => line.trim() && !line.includes('@')).length
  const problems = rows.filter((row) => row.unknown.length || !row.courseIds.length)
  const pairs = rows.reduce((sum, row) => sum + row.courseIds.length, 0)
  const count = Number(amount)
  const durationValid = Number.isInteger(count) && count >= 1 && count <= (unit === 'months' ? 60 : 1825)
  const canSubmit = !running && rows.length > 0 && rows.length <= MAX_LEARNERS && !problems.length && durationValid
  const durationText = `${amount} ${count === 1 ? unit.slice(0, -1) : unit}`
  const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

  const setRow = (key: string, ids: number[] | null) =>
    setOverrides((prev) => {
      const next = { ...prev }
      if (ids) next[key] = ids
      else delete next[key]
      return next
    })

  const remove = (row: Row) => {
    setSelected((prev) => prev.filter((email) => email.toLowerCase() !== row.key))
    setExcluded((prev) => [...prev, row.key])
    setRow(row.key, null)
    if (editing === row.key) setEditing(null)
  }

  async function submit() {
    if (!canSubmit) return
    const summary = pairs === rows.length && new Set(rows.map((row) => row.courseIds.join())).size === 1
      ? `${people(rows.length)} on ${titleOf.get(rows[0]!.courseIds[0]!)}`
      : `${people(rows.length)} (${pairs} enrolments in all)`
    if (!window.confirm(`Enrol ${summary} for ${durationText}, with no payment?`)) return
    setRunning(true)
    setError('')
    setResults([])
    const collected: Result[] = []
    const chunks = chunkEntries(rows.map((row) => ({ email: row.email, courseIds: row.courseIds })))
    let sent = 0
    try {
      for (const chunk of chunks) {
        sent += chunk.length
        setProgress(`Working on ${sent} of ${rows.length}…`)
        collected.push(...(await postChunk('/api/studio/manual-enrolment', { entries: chunk, duration: { unit, amount: count }, note: note.trim() || undefined, notify })))
        setResults([...collected])
      }
      setPasted('')
      setSelected([])
      setOverrides({})
      setExcluded([])
      setEditing(null)
    } catch (err) {
      setError(`Stopped after ${collected.length} enrolments: ${err instanceof Error ? err.message : 'something went wrong'} Your list is still here; running it again won’t repeat the ones already done today.`)
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
          <textarea
            rows={6}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder={'ada@example.com\ntobi@example.com, UI/UX; Data Analysis'}
            disabled={running}
          />
        </label>
        <p className="sa-muted">
          One person per line, or several separated by commas. To give someone their own programmes, write them after the email on the same line, separated by commas or semicolons.
          {ignoredLines ? ` ${ignoredLines} ${ignoredLines === 1 ? 'line has' : 'lines have'} no email and will be ignored.` : ''}
        </p>
        <LearnerSearch selected={selected} onChange={setSelected} />
        {excluded.length ? (
          <p className="sa-muted">
            {people(excluded.length)} removed from the list.{' '}
            <button type="button" className="sa-button sa-button--ghost sa-button--sm" onClick={() => setExcluded([])} disabled={running}>Put them back</button>
          </p>
        ) : null}
      </section>

      <section className="sa-card sa-enrol__section">
        <h2>Programmes</h2>
        <ProgrammeChecks
          programmes={programmes}
          value={defaults}
          onChange={setDefaults}
          disabled={running}
          legend="For everyone without their own programmes (choose one or more)"
        />
      </section>

      {rows.length ? (
        <section className="sa-card sa-enrol__section">
          <h2>{people(rows.length)} · {pairs} {pairs === 1 ? 'enrolment' : 'enrolments'}</h2>
          {problems.length ? (
            <p className="sa-enrol__error" role="alert">
              {problems.length === 1 ? '1 person needs' : `${problems.length} people need`} attention: choose their programmes or fix the names highlighted below.
            </p>
          ) : null}
          <div className="sa-table-wrap">
            <table className="sa-table sa-enrol__rows">
              <caption className="sa-visually-hidden">Learners and the programmes each will get</caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Programmes</th>
                  <th scope="col"><span className="sa-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <React.Fragment key={row.key}>
                    <tr aria-invalid={row.unknown.length || !row.courseIds.length ? true : undefined}>
                      <th scope="row">{row.email}</th>
                      <td>
                        {row.courseIds.length ? row.courseIds.map((id) => titleOf.get(id)).join(', ') : <span className="sa-enrol__error">No programme chosen</span>}
                        {row.unknown.length ? <span className="sa-enrol__error"> · Unknown: {row.unknown.join(', ')}</span> : null}
                        {row.source !== 'default' && row.courseIds.length ? <span className="sa-muted"> · {row.source === 'row' ? 'set here' : 'from the pasted line'}</span> : null}
                      </td>
                      <td className="sa-enrol__row-actions">
                        <button
                          type="button"
                          className="sa-button sa-button--ghost sa-button--sm"
                          aria-expanded={editing === row.key}
                          onClick={() => setEditing(editing === row.key ? null : row.key)}
                          disabled={running}
                        >
                          {editing === row.key ? 'Done' : 'Change'}
                        </button>
                        <button type="button" className="sa-button sa-button--ghost sa-button--sm" onClick={() => remove(row)} disabled={running} aria-label={`Remove ${row.email}`}>
                          Remove
                        </button>
                      </td>
                    </tr>
                    {editing === row.key ? (
                      <tr>
                        <td colSpan={3}>
                          <ProgrammeChecks programmes={programmes} value={row.courseIds} onChange={(ids) => setRow(row.key, ids)} legend={`Programmes for ${row.email}`} />
                          {overrides[row.key] ? (
                            <button type="button" className="sa-button sa-button--ghost sa-button--sm" onClick={() => setRow(row.key, null)}>
                              Undo changes for this person
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="sa-card sa-enrol__section">
        <h2>For how long</h2>
        <div className="sa-enrol__row">
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
          <span>Email them (one email per programme). New accounts need this to get their set-password link.</span>
        </label>
        <div className="sa-enrol__submit">
          <button type="button" className="sa-button sa-button--primary" disabled={!canSubmit} onClick={() => void submit()}>
            {running ? 'Enrolling…' : rows.length ? `Enrol ${people(rows.length)}` : 'Enrol'}
          </button>
          <span className="sa-muted" role="status" aria-live="polite">
            {progress || (rows.length > MAX_LEARNERS ? `That’s more than ${MAX_LEARNERS} people. Split the list.` : !durationValid ? `Choose 1 to ${unit === 'months' ? 60 : 1825} ${unit}.` : '')}
          </span>
        </div>
        <p className="sa-muted">People on a paid plan for a programme, or with permanent access to it, are left as they are on that programme. Someone already enrolled gets the time added to what they have.</p>
        {error ? <p className="sa-enrol__error" role="alert">{error}</p> : null}
      </section>

      <ResultsTable results={results} showProgramme />
    </div>
  )
}

/** `courses`: published programmes (to enrol on or move to). `movable` adds the unpublished ones learners can be moved off. */
export function EnrolClient({ courses, movable }: { courses: Programme[]; movable: Programme[] }) {
  return (
    <Tabs
      label="Enrol learners"
      tabs={[
        { id: 'enrol', label: 'Enrol', content: <EnrolForm programmes={courses} /> },
        { id: 'change', label: 'Change programme', content: <ChangeProgrammeForm programmes={courses} movable={movable} /> },
      ]}
    />
  )
}
