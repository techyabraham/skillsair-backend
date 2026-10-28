'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Money, StatusPill } from '../../ui/primitives'

interface Row { id: number; firstName: string; lastName: string; email: string; username: string; code: string; status: 'pending' | 'active' | 'blocked'; createdAt: string; customers: number; wallet: { availableKobo: number; totalEarnedKobo: number } }
export function AmbassadorDirectory() {
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ status, limit: '50' })
      if (search.trim()) params.set('search', search.trim())
      const response = await fetch(`/api/ambassadors/admin/ambassadors?${params}`, { credentials: 'include', cache: 'no-store' })
      const json = await response.json() as { success?: boolean; data?: Row[]; error?: { message?: string } }
      if (!response.ok || !json.success) throw new Error(json.error?.message ?? 'The ambassador list could not be loaded.')
      setRows(json.data ?? [])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The ambassador list could not be loaded.') }
    finally { setLoading(false) }
  }, [search, status])
  useEffect(() => { void load() }, [load])
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm">Search name, email, code or username<span className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3"><Search size={16} aria-hidden /><input className="min-w-52 bg-transparent outline-none" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load() }} /></span></label><label className="grid gap-1 text-sm">Status<select className="min-h-11 rounded-lg border border-line bg-white px-3" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="active">Active</option><option value="pending">Pending</option><option value="blocked">Blocked</option></select></label><button className="sa-button sa-button--secondary" type="button" onClick={() => void load()}>Search</button></div>
    {error ? <p role="alert" className="sa-callout sa-callout--critical">{error}</p> : null}
    {loading ? <p className="sa-muted">Loading ambassadors…</p> : null}
    {!loading && !rows.length ? <div className="sa-card p-8 text-center"><p className="font-semibold">No ambassadors found</p><p className="mt-1 sa-muted">Try another search or status.</p></div> : null}
    {rows.length ? <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Name</th><th>Email</th><th>Code</th><th>Status</th><th>Available</th><th>Total earned</th><th>Customers</th><th>Joined</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.firstName} {row.lastName}<small className="block sa-muted">@{row.username}</small></td><td>{row.email}</td><td><code>{row.code}</code></td><td><StatusPill tone={row.status === 'active' ? 'positive' : row.status === 'blocked' ? 'critical' : 'caution'}>{row.status}</StatusPill></td><td><Money amount={row.wallet.availableKobo} /></td><td><Money amount={row.wallet.totalEarnedKobo} /></td><td>{row.customers}</td><td>{new Date(row.createdAt).toLocaleDateString('en-NG')}</td><td><a className="sa-link" href={`/admin/ambassadors/wallet?ambassadorId=${row.id}`}>Wallet & actions</a></td></tr>)}</tbody></table></div> : null}
  </div>
}
