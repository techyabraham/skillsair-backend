'use client'

/**
 * The email editor. Left: one field per slot (subject, A/B subjects, preview text, body in reading
 * order, button, P.S.), each with its label, help, the original as greyed placeholder text, an Edit
 * button that copies the original in, Reset to original, a character count and inline issues.
 * Right: the live preview (desktop, mobile 375px, plain text) in a sandboxed iframe, with sample
 * scenarios and the A/B switcher. Sticky actions: save draft, send me a test, publish, discard,
 * reset. History drawer with a field-by-field comparison and Restore as draft.
 *
 * Validation and preview come from POST /api/email/editor/preview/:id (debounced 400 ms); nothing
 * is saved until "Save draft", and nothing reaches learners until "Publish".
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { History, Monitor, Smartphone, FileText, X } from 'lucide-react'
import { fromFields, overrideFields, type EmailOverride } from '../../../emails/copy'
import type { EditorDetail } from '../../../emails/editor-data'
import { formatWhen } from './EmailsListClient'

interface Issue {
  field: string
  message: string
}
interface Validation {
  errors: Issue[]
  warnings: Issue[]
}
interface PreviewResult {
  subject: string
  preheader: string
  html?: string
  text?: string
  validation: Validation
}

type Slot = EditorDetail['slots'][number]
type Fields = Record<string, string>

const ACTION_LABEL: Record<string, string> = { publish: 'Published', reset: 'Reset to original', restore_to_draft: 'Restored to draft' }
const KIND_SINGLE_LINE = new Set(['subject', 'preheader', 'button'])

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: { message: string; fields?: Record<string, string> } }> {
  try {
    const response = await fetch(`/api/email/editor/${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
    const body = (await response.json().catch(() => null)) as { success?: boolean; data?: T; error?: { message: string; fields?: Record<string, string> } } | null
    return { ok: response.ok && Boolean(body?.success), data: body?.data, error: body?.error ?? (response.ok ? undefined : { message: 'Something went wrong. Try again.' }) }
  } catch {
    return { ok: false, error: { message: 'Couldn’t reach Studio. Check your connection and try again.' } }
  }
}

const sameFields = (a: Fields, b: Fields) => {
  const clean = (fields: Fields) => JSON.stringify(Object.entries(fields).filter(([, value]) => value.trim()).sort(([x], [y]) => (x < y ? -1 : 1)))
  return clean(a) === clean(b)
}

function Field({
  slot,
  value,
  issues,
  onChange,
  onFocus,
  inputRef,
}: {
  slot: Slot
  value: string
  issues: { errors: string[]; warnings: string[] }
  onChange: (value: string) => void
  onFocus: () => void
  inputRef: (node: HTMLInputElement | HTMLTextAreaElement | null) => void
}) {
  const id = `slot-${slot.key}`
  const describedBy = [slot.help ? `${id}-help` : '', issues.errors.length || issues.warnings.length ? `${id}-issues` : '', `${id}-count`].filter(Boolean).join(' ')
  const single = KIND_SINGLE_LINE.has(slot.kind)
  const common = {
    id,
    value,
    placeholder: slot.default,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    onFocus,
    'aria-describedby': describedBy,
    'aria-invalid': issues.errors.length ? true : undefined,
    className: `sa-emailfield__input${value ? '' : ' sa-emailfield__input--empty'}`,
  }
  const length = (value || '').length
  return (
    <div className={`sa-emailfield${issues.errors.length ? ' sa-emailfield--error' : ''}`}>
      <div className="sa-emailfield__head">
        <label htmlFor={id}>{slot.label}</label>
        <span className="sa-emailfield__tools">
          {!value ? (
            <button type="button" className="sa-linkbutton" onClick={() => onChange(slot.default)}>
              Edit<span className="sa-visually-hidden"> {slot.label}, starting from the original</span>
            </button>
          ) : (
            <button type="button" className="sa-linkbutton" onClick={() => onChange('')}>
              Reset to original<span className="sa-visually-hidden"> ({slot.label})</span>
            </button>
          )}
        </span>
      </div>
      {single ? (
        <input type="text" ref={inputRef as (node: HTMLInputElement | null) => void} {...common} />
      ) : (
        <textarea ref={inputRef as (node: HTMLTextAreaElement | null) => void} rows={slot.kind === 'list' ? Math.max(3, slot.default.split('\n').length + 1) : Math.min(8, Math.max(2, Math.ceil(slot.default.length / 70)))} {...common} />
      )}
      <div className="sa-emailfield__foot">
        {slot.help || slot.kind === 'list' ? (
          <p id={`${id}-help`} className="sa-emailfield__help">
            {slot.kind === 'list' ? 'One item per line. ' : ''}
            {slot.help ?? ''}
          </p>
        ) : (
          <span />
        )}
        <span id={`${id}-count`} className={`sa-emailfield__count${slot.maxLength && length > slot.maxLength ? ' sa-emailfield__count--over' : ''}`}>
          {value ? length : 0}
          {slot.maxLength ? ` / ${slot.maxLength}` : ''}
          <span className="sa-visually-hidden"> characters</span>
        </span>
      </div>
      {issues.errors.length || issues.warnings.length ? (
        <ul id={`${id}-issues`} className="sa-emailfield__issues">
          {issues.errors.map((message) => (
            <li key={`e${message}`} className="sa-emailfield__issue sa-emailfield__issue--error">
              {message}
            </li>
          ))}
          {issues.warnings.map((message) => (
            <li key={`w${message}`} className="sa-emailfield__issue sa-emailfield__issue--warning">
              {message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function HistoryDiff({ slots, snapshot, published }: { slots: Slot[]; snapshot: EmailOverride | null; published: EmailOverride | null }) {
  const then = overrideFields(snapshot)
  const now = overrideFields(published)
  const changed = slots.filter((slot) => (then[slot.key] ?? '') !== (now[slot.key] ?? ''))
  if (!changed.length) return <p className="sa-muted">Same as the published version.</p>
  return (
    <table className="sa-table sa-emaildiff">
      <caption className="sa-visually-hidden">Fields that differ from the published version</caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">This version</th>
          <th scope="col">Published now</th>
        </tr>
      </thead>
      <tbody>
        {changed.map((slot) => (
          <tr key={slot.key}>
            <th scope="row">{slot.label}</th>
            <td>{then[slot.key] ?? <span className="sa-muted">Original wording</span>}</td>
            <td>{now[slot.key] ?? <span className="sa-muted">Original wording</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function EmailEditorClient({ initial }: { initial: EditorDetail }) {
  const [detail, setDetail] = useState(initial)
  const startFields = useMemo(() => overrideFields((initial.draft ?? initial.published) as EmailOverride | null), [initial])
  const [fields, setFields] = useState<Fields>(startFields)
  const [saved, setSaved] = useState<Fields>(startFields)
  const [validation, setValidation] = useState<Validation>({ errors: [], warnings: [] })
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [tab, setTab] = useState<'desktop' | 'mobile' | 'text'>('desktop')
  const [scenario, setScenario] = useState(initial.scenarios[0]?.id ?? '')
  const [ab, setAb] = useState(0)
  const [previewTemplate, setPreviewTemplate] = useState(initial.previewTemplate)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [selectedHistory, setSelectedHistory] = useState<number | null>(null)
  const refs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({})
  const lastFocused = useRef<string | null>(null)
  const drawer = useRef<HTMLDialogElement>(null)

  const dirty = !sameFields(fields, saved)
  const hasDraft = Boolean(detail.draft)
  const override = useMemo(() => fromFields(fields), [fields])

  // Live preview and validation, 400 ms after the last change.
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const result = await api<PreviewResult>(`preview/${encodeURIComponent(detail.id)}`, {
        method: 'POST',
        body: JSON.stringify({ override, dataVariant: scenario || undefined, abVariant: ab, previewTemplate, format: 'json' }),
      })
      if (result.ok && result.data) {
        setPreview(result.data)
        setValidation(result.data.validation)
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [override, scenario, ab, previewTemplate, detail.id])

  // Unsaved-changes protection.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const issuesFor = useCallback(
    (key: string) => ({
      errors: validation.errors.filter((issue) => issue.field === key).map((issue) => issue.message),
      warnings: validation.warnings.filter((issue) => issue.field === key).map((issue) => issue.message),
    }),
    [validation],
  )
  const slotKeys = new Set(detail.slots.map((slot) => slot.key))
  const general = {
    errors: validation.errors.filter((issue) => !slotKeys.has(issue.field)),
    warnings: validation.warnings.filter((issue) => !slotKeys.has(issue.field)),
  }

  const reload = async (note: string) => {
    const result = await api<EditorDetail>(`templates/${encodeURIComponent(detail.id)}`)
    if (result.ok && result.data) {
      setDetail(result.data)
      const next = overrideFields((result.data.draft ?? result.data.published) as EmailOverride | null)
      setFields(next)
      setSaved(next)
    }
    setMessage(note)
  }

  const run = async (name: string, action: () => Promise<{ ok: boolean; error?: { message: string; fields?: Record<string, string> } }>, success: string) => {
    setBusy(name)
    const result = await action()
    setBusy(null)
    if (!result.ok) {
      const fieldNotes = result.error?.fields ? Object.values(result.error.fields).slice(0, 3).join(' ') : ''
      setMessage(`${result.error?.message ?? 'That didn’t work.'} ${fieldNotes}`.trim())
      return false
    }
    await reload(success)
    return true
  }

  const saveDraft = () =>
    run('save', () => api(`templates/${encodeURIComponent(detail.id)}/draft`, { method: 'PUT', body: JSON.stringify({ override }) }), 'Draft saved. Learners still get the published wording.')

  const publish = async () => {
    if (!window.confirm('This changes the email learners receive from now on. Emails already sent are not affected.')) return
    if (dirty || !hasDraft) {
      const savedOk = await run('save', () => api(`templates/${encodeURIComponent(detail.id)}/draft`, { method: 'PUT', body: JSON.stringify({ override }) }), 'Draft saved.')
      if (!savedOk) return
    }
    await run('publish', () => api(`templates/${encodeURIComponent(detail.id)}/publish`, { method: 'POST' }), 'Published. New emails use this wording from now on.')
  }

  const discard = async () => {
    if (!window.confirm('Discard the draft? The published wording stays as it is.')) return
    await run('discard', () => api(`templates/${encodeURIComponent(detail.id)}/draft`, { method: 'DELETE' }), 'Draft discarded.')
  }

  const resetAll = async () => {
    if (!window.confirm('Reset the whole email to the original wording? This publishes the original straight away. You can restore this version later from History.')) return
    await run('reset', () => api(`templates/${encodeURIComponent(detail.id)}/reset`, { method: 'POST' }), 'Reset to the original wording.')
  }

  const sendTest = async () => {
    setBusy('test')
    const result = await api<{ to: string }>(`test/${encodeURIComponent(detail.id)}`, {
      method: 'POST',
      body: JSON.stringify({ override, dataVariant: scenario || undefined, abVariant: ab, previewTemplate }),
    })
    setBusy(null)
    setMessage(result.ok ? `Test sent to ${result.data?.to}. Its subject starts with [TEST].` : (result.error?.message ?? 'The test didn’t send.'))
  }

  const restore = async (historyId: number) => {
    if (dirty && !window.confirm('Restoring replaces your unsaved changes. Continue?')) return
    const ok = await run('restore', () => api(`restore/${encodeURIComponent(detail.id)}/${historyId}`, { method: 'POST' }), 'Restored as a draft. Check it, then publish when you’re ready.')
    if (ok) drawer.current?.close()
  }

  const insertPlaceholder = (name: string) => {
    const key = lastFocused.current ?? detail.slots[0]?.key
    if (!key || !name) return
    const node = refs.current[key]
    const current = fields[key] || detail.slots.find((slot) => slot.key === key)?.default || ''
    const token = `{{${name}}}`
    const start = node && fields[key] ? node.selectionStart ?? current.length : current.length
    const end = node && fields[key] ? node.selectionEnd ?? current.length : current.length
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`
    setFields((prev) => ({ ...prev, [key]: next }))
    window.requestAnimationFrame(() => {
      node?.focus()
      node?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const focusedSlot = detail.slots.find((slot) => slot.key === lastFocused.current)
  const placeholders = [...detail.placeholders, ...Object.entries(focusedSlot?.vars ?? {}).map(([name, description]) => ({ name, description }))]
  const selected = detail.history.find((row) => row.id === selectedHistory) ?? null

  return (
    <div className="sa-emaileditor">
      <p className="sa-visually-hidden" role="status" aria-live="polite">
        {message}
      </p>
      <div className="sa-emaileditor__status">
        {hasDraft ? <span className="sa-pill sa-pill--caution">Draft waiting{detail.draftUpdatedAt ? ` · saved ${formatWhen(detail.draftUpdatedAt)}${detail.draftUpdatedBy ? ` by ${detail.draftUpdatedBy}` : ''}` : ''}</span> : null}
        {detail.published ? <span className="sa-pill sa-pill--positive">Edited{detail.publishedAt ? ` · published ${formatWhen(detail.publishedAt)}${detail.publishedBy ? ` by ${detail.publishedBy}` : ''}` : ''}</span> : <span className="sa-pill sa-pill--neutral">Original wording</span>}
        {dirty ? <span className="sa-pill sa-pill--info">Unsaved changes</span> : null}
        {message ? (
          <span className="sa-emaileditor__message" aria-hidden="true">
            {message}
          </span>
        ) : null}
      </div>

      <div className="sa-emaileditor__columns">
        <section className="sa-emaileditor__fields" aria-label="Wording">
          {detail.placeholders.length ? (
            <div className="sa-emaileditor__picker">
              <label htmlFor="placeholder-picker">Insert a placeholder</label>
              <select
                id="placeholder-picker"
                value=""
                onChange={(event) => insertPlaceholder(event.target.value)}
                aria-describedby="placeholder-picker-help"
              >
                <option value="">Choose…</option>
                {placeholders.map((item) => (
                  <option key={item.name} value={item.name} title={item.description}>
                    {`{{${item.name}}}`} · {item.description}
                  </option>
                ))}
              </select>
              <p id="placeholder-picker-help" className="sa-emailfield__help">
                Goes in at the cursor of the field you were last in{focusedSlot ? ` (${focusedSlot.label})` : ''}. Links and who gets which paragraph stay as they are.
              </p>
            </div>
          ) : null}

          {general.errors.length || general.warnings.length ? (
            <ul className="sa-emailfield__issues sa-emaileditor__general" aria-label="Problems in the rendered emails">
              {general.errors.map((issue) => (
                <li key={`e${issue.field}${issue.message}`} className="sa-emailfield__issue sa-emailfield__issue--error">
                  {issue.message}
                </li>
              ))}
              {general.warnings.map((issue) => (
                <li key={`w${issue.field}${issue.message}`} className="sa-emailfield__issue sa-emailfield__issue--warning">
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}

          {detail.slots.map((slot) => (
            <Field
              key={slot.key}
              slot={slot}
              value={fields[slot.key] ?? ''}
              issues={issuesFor(slot.key)}
              onChange={(value) => setFields((prev) => ({ ...prev, [slot.key]: value }))}
              onFocus={() => {
                lastFocused.current = slot.key
              }}
              inputRef={(node) => {
                refs.current[slot.key] = node
              }}
            />
          ))}
        </section>

        <section className="sa-emaileditor__preview" aria-label="Preview">
          <div className="sa-emaileditor__preview-controls">
            <div role="tablist" aria-label="Preview size" className="sa-emaileditor__tabs">
              {(
                [
                  ['desktop', 'Desktop', Monitor],
                  ['mobile', 'Mobile', Smartphone],
                  ['text', 'Plain text', FileText],
                ] as const
              ).map(([value, label, Icon]) => (
                <button key={value} type="button" role="tab" aria-selected={tab === value} className={`sa-emaileditor__tab${tab === value ? ' sa-emaileditor__tab--active' : ''}`} onClick={() => setTab(value)}>
                  <Icon size={15} aria-hidden /> {label}
                </button>
              ))}
            </div>
            {detail.previewTemplates.length ? (
              <label>
                <span>Show in</span>
                <select value={previewTemplate} onChange={(event) => setPreviewTemplate(event.target.value)}>
                  {detail.previewTemplates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id} · {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {detail.scenarios.length ? (
              <label>
                <span>Sample</span>
                <select value={scenario} onChange={(event) => setScenario(event.target.value)}>
                  {detail.scenarios.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {detail.variantCount > 1 ? (
              <label>
                <span>Subject</span>
                <select value={ab} onChange={(event) => setAb(Number(event.target.value))}>
                  {Array.from({ length: detail.variantCount }, (_, index) => (
                    <option key={index} value={index}>
                      A/B version {String.fromCharCode(97 + index)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div className="sa-emaileditor__inbox" aria-label="How it looks in the inbox">
            <strong>{preview?.subject ?? '…'}</strong>
            <span className="sa-muted">{preview?.preheader}</span>
          </div>
          {tab === 'text' ? (
            <pre className="sa-emaileditor__text">{preview?.text ?? ''}</pre>
          ) : (
            <div className={`sa-emaileditor__frame-wrap${tab === 'mobile' ? ' sa-emaileditor__frame-wrap--mobile' : ''}`}>
              <iframe title={`Preview of ${detail.name}${tab === 'mobile' ? ' on a phone' : ''}`} sandbox="" srcDoc={preview?.html ?? ''} className="sa-emaileditor__frame" />
            </div>
          )}
        </section>
      </div>

      <div className="sa-emaileditor__actions" role="toolbar" aria-label="Email actions">
        <button type="button" className="sa-button sa-button--secondary" onClick={() => void saveDraft()} disabled={busy !== null || !dirty}>
          {busy === 'save' ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" className="sa-button sa-button--ghost" onClick={() => void sendTest()} disabled={busy !== null}>
          {busy === 'test' ? 'Sending…' : 'Send me a test'}
        </button>
        <button
          type="button"
          className="sa-button sa-button--primary"
          onClick={() => void publish()}
          disabled={busy !== null || validation.errors.length > 0 || (!dirty && !hasDraft)}
          aria-describedby={validation.errors.length ? 'publish-blocked' : undefined}
        >
          {busy === 'publish' ? 'Publishing…' : 'Publish'}
        </button>
        {validation.errors.length ? (
          <span id="publish-blocked" className="sa-emaileditor__blocked">
            Fix {validation.errors.length} error{validation.errors.length === 1 ? '' : 's'} to publish
          </span>
        ) : null}
        <span className="sa-emaileditor__spacer" />
        {hasDraft ? (
          <button type="button" className="sa-button sa-button--ghost" onClick={() => void discard()} disabled={busy !== null}>
            Discard draft
          </button>
        ) : null}
        <button type="button" className="sa-button sa-button--ghost" onClick={() => void resetAll()} disabled={busy !== null || (!detail.published && !hasDraft)}>
          Reset whole email to original
        </button>
        <button type="button" className="sa-button sa-button--ghost" onClick={() => drawer.current?.showModal()}>
          <History size={15} aria-hidden /> History ({detail.history.length})
        </button>
      </div>

      <dialog ref={drawer} className="sa-drawer" aria-label="History" onClick={(event) => event.target === drawer.current && drawer.current?.close()}>
        <div className="sa-drawer__head">
          <strong>History</strong>
          <button type="button" className="sa-button sa-button--ghost sa-button--sm" onClick={() => drawer.current?.close()} aria-label="Close history">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="sa-emailhistory">
          {detail.history.length ? (
            <ol className="sa-emailhistory__list">
              {detail.history.map((row) => (
                <li key={row.id}>
                  <button type="button" className={`sa-emailhistory__row${selectedHistory === row.id ? ' sa-emailhistory__row--active' : ''}`} aria-pressed={selectedHistory === row.id} onClick={() => setSelectedHistory(row.id)}>
                    <strong>{ACTION_LABEL[row.action] ?? row.action}</strong>
                    <span className="sa-muted">
                      {formatWhen(row.createdAt)}
                      {row.author ? ` · ${row.author}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="sa-muted">No changes yet. Publishing, resetting and restoring show up here.</p>
          )}
          {selected ? (
            <div className="sa-emailhistory__detail">
              <h3>
                {ACTION_LABEL[selected.action] ?? selected.action}, {formatWhen(selected.createdAt)}
              </h3>
              <HistoryDiff slots={detail.slots} snapshot={selected.snapshot as EmailOverride | null} published={detail.published as EmailOverride | null} />
              <button type="button" className="sa-button sa-button--secondary" onClick={() => void restore(selected.id)} disabled={busy !== null}>
                Restore as draft
              </button>
              <p className="sa-muted">Restoring fills the draft. Nothing changes for learners until you publish.</p>
            </div>
          ) : detail.history.length ? (
            <p className="sa-muted">Choose a version to compare it with what’s published now.</p>
          ) : null}
        </div>
      </dialog>
    </div>
  )
}
