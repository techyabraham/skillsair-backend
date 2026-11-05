'use client'

/**
 * Export applicants: filters, a live count with the first 25 people, and download links. The
 * preview and the files come from GET /api/studio/applicants/export with the Studio session; the
 * downloads are plain links, so the browser saves the file itself.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'

type Payment = 'unpaid' | 'paid' | 'all'

interface PreviewRow {
  kind: 'Applicant' | 'Sign-up'
  id: number
  name: string
  phone: string
  localPhone: string
  programme: string
  status: string
  paid: boolean
  appliedAt: string
}

interface Preview {
  total: number
  truncated: boolean
  withPhone: number
  rows: PreviewRow[]
}

const STATUSES: Array<{ value: string; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'offer_viewed', label: 'Offer viewed' },
  { value: 'account_created', label: 'Account created' },
  { value: 'paid', label: 'Paid' },
  { value: 'lost', label: 'Lost' },
]

const FORMATS: Array<{ format: 'xlsx' | 'csv' | 'txt'; label: string; hint: string }> = [
  { format: 'xlsx', label: 'Excel (.xlsx)', hint: 'Phone numbers stay exactly as written.' },
  { format: 'csv', label: 'CSV', hint: 'For Google Sheets or a dialler.' },
  { format: 'txt', label: 'Text list', hint: 'One person per line: name · phone · programme.' },
]

const lagosDay = (at: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }).format(new Date(at))

export function ExportClient({ programmes }: { programmes: Array<{ id: number; title: string }> }) {
  const [payment, setPayment] = useState<Payment>('unpaid')
  const [courseIds, setCourseIds] = useState<number[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const query = useMemo(() => {
    const params = new URLSearchParams({ payment })
    if (courseIds.length) params.set('course', courseIds.join(','))
    if (statuses.length) params.set('status', statuses.join(','))
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return params.toString()
  }, [payment, courseIds, statuses, from, to])

  // The count follows the filters, half a second after the last change.
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`/api/studio/applicants/export?format=preview&${query}`, { credentials: 'include' })
        const body = (await response.json().catch(() => null)) as { data?: Preview; error?: { message?: string } } | null
        if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? 'The server didn’t answer.')
        if (!cancelled) setPreview(body.data)
      } catch (err) {
        if (!cancelled) {
          setPreview(null)
          setError(err instanceof Error ? err.message : 'Couldn’t count applicants.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 500)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  const signupsApply = payment !== 'paid' && !courseIds.length && !statuses.length
  const people = (n: number) => `${n.toLocaleString('en-GB')} ${n === 1 ? 'person' : 'people'}`

  return (
    <div className="sa-enrol">
      <section className="sa-card sa-enrol__section">
        <h2>Who</h2>
        <fieldset className="sa-enrol__programmes">
          <legend>Payment</legend>
          {([['unpaid', 'Not paid yet'], ['paid', 'Paid'], ['all', 'Everyone']] as const).map(([value, label]) => (
            <label key={value} className="sa-enrol__check">
              <input type="radio" name="payment" checked={payment === value} onChange={() => setPayment(value)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="sa-enrol__programmes">
          <legend>Programme (none ticked: every programme)</legend>
          {programmes.map((programme) => (
            <label key={programme.id} className="sa-enrol__check">
              <input type="checkbox" checked={courseIds.includes(programme.id)} onChange={() => setCourseIds((prev) => toggle(prev, programme.id))} />
              <span>{programme.title}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="sa-enrol__programmes">
          <legend>Applicant status (none ticked: any status)</legend>
          {STATUSES.filter((status) => payment !== 'unpaid' || status.value !== 'paid').map((status) => (
            <label key={status.value} className="sa-enrol__check">
              <input type="checkbox" checked={statuses.includes(status.value)} onChange={() => setStatuses((prev) => toggle(prev, status.value))} />
              <span>{status.label}</span>
            </label>
          ))}
        </fieldset>

        <div className="sa-enrol__row">
          <label className="sa-enrol__field sa-enrol__field--short">
            <span>Applied from</span>
            <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="sa-enrol__field sa-enrol__field--short">
            <span>Applied to</span>
            <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>

        <p className="sa-muted">
          {signupsApply
            ? 'Includes everyone: applicants, people who unsubscribed from emails, and people who created an account with a phone number but never applied or paid.'
            : 'Includes applicants who unsubscribed from emails too. People who only created an account aren’t in this list: they have no programme or applicant status to match.'}
        </p>
      </section>

      <section className="sa-card sa-enrol__section">
        <h2>Download</h2>
        <p role="status" aria-live="polite">
          {loading && !preview ? 'Counting…' : preview ? (
            <>
              <strong>{people(preview.total)}</strong>
              {preview.truncated ? ' (the most a file holds; narrow the dates or programmes for the rest)' : ''}
              {loading ? ' · updating…' : ''}
            </>
          ) : null}
        </p>
        {error ? <p className="sa-enrol__error" role="alert">{error}</p> : null}
        <div className="sa-enrol__submit">
          {FORMATS.map(({ format, label }) => (
            <a
              key={format}
              className={`sa-button ${format === 'xlsx' ? 'sa-button--primary' : 'sa-button--secondary'}`}
              href={`/api/studio/applicants/export?format=${format}&${query}`}
              aria-disabled={!preview?.total}
              onClick={(event) => { if (!preview?.total) event.preventDefault() }}
              download
            >
              <Download size={15} strokeWidth={2} aria-hidden="true" /> {label}
            </a>
          ))}
        </div>
        <ul className="sa-muted sa-export__hints">
          {FORMATS.map(({ format, label, hint }) => <li key={format}><strong>{label}:</strong> {hint}</li>)}
        </ul>
        <p className="sa-muted">
          Each file has the name, phone number (international and 0803 format), a WhatsApp link, email, programme, status, when they applied, their notes and a link to their record. It holds personal details: keep it to the team, and delete it when the follow-up is done.
        </p>
      </section>

      {preview?.rows.length ? (
        <section className="sa-card sa-enrol__section">
          <h2>First {preview.rows.length} of {people(preview.total)}</h2>
          <div className="sa-table-wrap">
            <table className="sa-table">
              <caption className="sa-visually-hidden">Applicants in this export</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Programme</th>
                  <th scope="col">Status</th>
                  <th scope="col">Applied</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <th scope="row">
                      <a href={`/admin/collections/${row.kind === 'Applicant' ? 'leads' : 'users'}/${row.id}`}>{row.name}</a>
                    </th>
                    <td className="sa-mono">{row.localPhone ? <a href={`tel:${row.phone}`}>{row.localPhone}</a> : '–'}</td>
                    <td>{row.programme || '–'}</td>
                    <td>{row.status}{row.paid ? ' · paid' : ''}</td>
                    <td>{lagosDay(row.appliedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : preview && !loading ? (
        <p className="sa-muted">Nobody matches these filters.</p>
      ) : null}
    </div>
  )
}
