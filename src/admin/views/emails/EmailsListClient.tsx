'use client'

/**
 * The email list: grouped by type, searchable by id, subject or wording, filterable by status.
 */
import React, { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { EditorListItem } from '../../../emails/editor-data'
import { StatusPill, type Tone } from '../../ui/primitives'

const GROUP_ORDER = ['account', 'learning', 'applications', 'shared', 'settings']
const STATUS_LABEL: Record<string, string> = { default: 'Default', edited: 'Edited', 'draft pending': 'Draft waiting' }
const STATUS_TONE: Record<string, Tone> = { default: 'neutral', edited: 'positive', 'draft pending': 'caution' }

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }).format(new Date(iso))
}

export function EmailsListClient({ items }: { items: EditorListItem[] }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => (status === 'all' || item.status === status) && (!q || item.searchText.includes(q)))
  }, [items, query, status])
  const groups = GROUP_ORDER.map((group) => ({ group, label: items.find((item) => item.group === group)?.groupLabel ?? group, rows: visible.filter((item) => item.group === group) })).filter((group) => group.rows.length)

  return (
    <div className="sa-emails">
      <div className="sa-emails__filters" role="search">
        <label className="sa-emails__search">
          <span>Search</span>
          <span className="sa-emails__search-box">
            <Search size={16} aria-hidden />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Id, subject or any wording" />
          </span>
        </label>
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All</option>
            <option value="default">Default</option>
            <option value="edited">Edited</option>
            <option value="draft pending">Draft waiting</option>
          </select>
        </label>
        <p className="sa-muted" role="status" aria-live="polite">
          {visible.length} of {items.length} emails
        </p>
      </div>

      {groups.length ? (
        groups.map((group) => (
          <section key={group.group} className="sa-card sa-emails__group" aria-labelledby={`group-${group.group}`}>
            <h2 id={`group-${group.group}`} className="sa-emails__group-title">
              {group.label}
            </h2>
            <div className="sa-table-wrap">
              <table className="sa-table sa-emails__table">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Subject</th>
                    <th scope="col">When it’s sent</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last edited</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((item) => (
                    <tr key={item.id}>
                      <th scope="row">
                        <a href={`/admin/emails?template=${encodeURIComponent(item.id)}`}>
                          {item.id.startsWith('_') ? null : <span className="sa-emails__id">{item.id}</span>}
                          {item.name}
                        </a>
                      </th>
                      <td className="sa-emails__subject">{item.subject ?? <span className="sa-muted">–</span>}</td>
                      <td className="sa-emails__when">{item.whenSent}</td>
                      <td>
                        <StatusPill tone={STATUS_TONE[item.status] ?? 'neutral'}>{STATUS_LABEL[item.status]}</StatusPill>
                      </td>
                      <td className="sa-muted sa-emails__edited">
                        {item.updatedAt ? `${formatWhen(item.updatedAt)}${item.updatedBy ? ` · ${item.updatedBy}` : ''}` : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      ) : (
        <p className="sa-muted">No emails match.</p>
      )}
    </div>
  )
}
