'use client'

/**
 * Global command bar (`admin.components.actions`), ⌘K / Ctrl K. Searches applicants (name,
 * email), learners (name, email), programmes (title) and orders (reference) through the REST API
 * with the signed-in person's own cookie, so normal access control applies: an instructor simply
 * gets no applicant or order results. Lists quick actions too. Keyboard: arrows, Enter, Esc.
 * Results are never logged.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAuth } from '@payloadcms/ui'
import { Search } from 'lucide-react'

interface Result {
  id: string
  group: string
  label: string
  detail?: string
  href: string
}

const ACTIONS: Array<Result & { adminOnly?: boolean }> = [
  { id: 'a-programme', group: 'Quick actions', label: 'New programme', href: '/admin/collections/courses/create' },
  { id: 'a-lesson', group: 'Quick actions', label: 'New lesson', href: '/admin/collections/lessons/create' },
  { id: 'a-queue', group: 'Quick actions', label: 'Open Imisi’s queue', href: '/admin/queue', adminOnly: true },
  { id: 'a-window', group: 'Quick actions', label: 'Open scholarship window', href: '/admin/globals/scholarship-window', adminOnly: true },
  { id: 'a-lifecycle', group: 'Quick actions', label: 'Lifecycle emails', href: '/admin/lifecycle', adminOnly: true },
  { id: 'a-overview', group: 'Quick actions', label: 'Overview', href: '/admin' },
]

type Doc = Record<string, unknown> & { id: number | string }

async function search(collection: string, fields: string[], term: string, signal: AbortSignal): Promise<Doc[]> {
  const params = new URLSearchParams({ limit: '5', depth: '0' })
  fields.forEach((field, i) => params.set(`where[or][${i}][${field}][like]`, term))
  const response = await fetch(`/api/${collection}?${params.toString()}`, { credentials: 'include', signal })
  if (!response.ok) return []
  const json = (await response.json().catch(() => null)) as { docs?: Doc[] } | null
  return json?.docs ?? []
}

const name = (doc: Doc) => [doc.firstName, doc.lastName].filter(Boolean).join(' ') || String(doc.email ?? doc.id)

export function CommandBar() {
  const { user } = useAuth()
  const isAdmin = (user as { role?: string } | null)?.role === 'admin'
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const listId = useId()
  const [isMac, setIsMac] = useState(false)

  useEffect(() => setIsMac(/Mac|iPhone|iPad/.test(navigator.platform)), [])

  const open = useCallback(() => {
    dialog.current?.showModal()
    window.setTimeout(() => input.current?.focus(), 0)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (dialog.current?.open) dialog.current.close()
        else open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const actions = useMemo(() => ACTIONS.filter((a) => isAdmin || !a.adminOnly), [isAdmin])

  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const [leads, users, courses, orders] = await Promise.all([
          isAdmin ? search('leads', ['firstName', 'email'], q, controller.signal) : Promise.resolve([]),
          search('users', ['firstName', 'lastName', 'email'], q, controller.signal),
          search('courses', ['title'], q, controller.signal),
          isAdmin ? search('orders', ['reference'], q, controller.signal) : Promise.resolve([]),
        ])
        setResults([
          ...leads.map((d) => ({ id: `lead-${d.id}`, group: 'Applicants', label: String(d.firstName ?? 'Applicant'), detail: String(d.email ?? ''), href: `/admin/collections/leads/${d.id}` })),
          ...users.map((d) => ({ id: `user-${d.id}`, group: 'Learners', label: name(d), detail: String(d.email ?? ''), href: `/admin/collections/users/${d.id}` })),
          ...courses.map((d) => ({ id: `course-${d.id}`, group: 'Programmes', label: String(d.title ?? 'Programme'), detail: String(d.status ?? ''), href: `/admin/collections/courses/${d.id}` })),
          ...orders.map((d) => ({ id: `order-${d.id}`, group: 'Orders', label: String(d.reference ?? d.id), detail: String(d.status ?? ''), href: `/admin/collections/orders/${d.id}` })),
        ])
        setActive(0)
      } catch {
        // Aborted or offline: keep the previous results.
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [term, isAdmin])

  const q = term.trim().toLowerCase()
  const visibleActions = actions.filter((a) => !q || a.label.toLowerCase().includes(q))
  const items = [...results, ...visibleActions]
  const go = (item: Result | undefined) => {
    if (!item) return
    dialog.current?.close()
    window.location.assign(item.href)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') setActive((i) => Math.min(items.length - 1, i + 1))
    else if (event.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
    else if (event.key === 'Enter') go(items[active])
    else return
    event.preventDefault()
  }

  let lastGroup = ''
  return (
    <>
      <button type="button" className="sa-cmd__trigger" onClick={open} aria-keyshortcuts="Control+K Meta+K">
        <Search size={16} strokeWidth={2} aria-hidden />
        <span className="sa-cmd__trigger-text">Search Studio</span>
        <kbd className="sa-cmd__kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <dialog
        ref={dialog}
        className="sa-cmd"
        aria-label="Search Studio"
        onClose={() => {
          setTerm('')
          setResults([])
        }}
        onClick={(event) => event.target === dialog.current && dialog.current?.close()}
      >
        <div className="sa-cmd__box">
          <div className="sa-cmd__field">
            <Search size={18} strokeWidth={2} aria-hidden />
            <input
              ref={input}
              className="sa-cmd__input"
              type="search"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls={listId}
              aria-activedescendant={items[active] ? `${listId}-${items[active]!.id}` : undefined}
              aria-autocomplete="list"
              placeholder={isAdmin ? 'Search applicants, learners, programmes, orders…' : 'Search learners and programmes…'}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <kbd className="sa-cmd__kbd">Esc</kbd>
          </div>
          <ul className="sa-cmd__list" id={listId} role="listbox" aria-label="Results">
            {items.map((item, index) => {
              const header = item.group !== lastGroup ? item.group : null
              lastGroup = item.group
              return (
                <React.Fragment key={item.id}>
                  {header ? (
                    <li role="presentation" className="sa-cmd__group">
                      {header}
                    </li>
                  ) : null}
                  <li
                    id={`${listId}-${item.id}`}
                    role="option"
                    aria-selected={index === active}
                    className={`sa-cmd__item${index === active ? ' sa-cmd__item--active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(item)}
                  >
                    <span className="sa-cmd__label">{item.label}</span>
                    {item.detail ? <span className="sa-cmd__detail">{item.detail}</span> : null}
                  </li>
                </React.Fragment>
              )
            })}
            {!items.length ? (
              <li role="presentation" className="sa-cmd__empty">
                {loading ? 'Searching…' : q.length >= 2 ? 'No matches.' : 'Type at least 2 letters.'}
              </li>
            ) : null}
          </ul>
          <p className="sa-visually-hidden" role="status">
            {loading ? 'Searching' : `${items.length} results`}
          </p>
        </div>
      </dialog>
    </>
  )
}
