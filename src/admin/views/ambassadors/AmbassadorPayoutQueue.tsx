'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation.js'
import { Check, RefreshCw, X } from 'lucide-react'
import { Money } from '../../ui/primitives'

type QueueStatus = 'requested' | 'processing' | 'failed' | 'success'
interface Row { id: number; ambassadorId?: number; name: string; email: string; amountKobo: number; status: string; bankName: string; accountLast4: string; availableBalanceKobo: number; openRiskFlags: Array<{ kind: string; note: string }>; requestedAt: string; failureReason: string | null }
const TABS: Array<{ status: QueueStatus; label: string }> = [{ status: 'requested', label: 'Requested' }, { status: 'processing', label: 'Processing' }, { status: 'failed', label: 'Failed' }, { status: 'success', label: 'Paid' }]
async function adminPost(path: string, body: Record<string, unknown> = {}) {
  const response = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await response.json().catch(() => null) as { error?: { message?: string } } | null
  if (!response.ok) throw new Error(json?.error?.message ?? 'The action could not be completed.')
}

export function AmbassadorPayoutQueue() {
  const router = useRouter()
  const [status, setStatus] = useState<QueueStatus>('requested')
  const [rows, setRows] = useState<Row[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/ambassadors/admin/payouts?status=${status}&limit=50`, { credentials: 'include', cache: 'no-store' })
      const json = await response.json() as { success?: boolean; data?: Row[]; error?: { message?: string } }
      if (!response.ok || !json.success) throw new Error(json.error?.message ?? 'Could not load this payout queue.')
      setRows(json.data ?? [])
      setSelected([])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this payout queue.') }
    finally { setLoading(false) }
  }, [status])
  useEffect(() => { void load() }, [load])
  const selectedTotal = useMemo(() => rows.filter((row) => selected.includes(row.id)).reduce((sum, row) => sum + row.amountKobo, 0), [rows, selected])
  const changeStatus = async (id: number, action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? window.prompt('Why is this withdrawal being rejected?') : undefined
    if (action === 'reject' && !reason?.trim()) return
    if (!window.confirm(action === 'approve' ? 'Approve this withdrawal and initiate its Paystack transfer?' : `Reject this withdrawal and return ${formatAmount(rows.find((row) => row.id === id)?.amountKobo ?? 0)} to available balance?`)) return
    setBusy(true); setError('')
    try { await adminPost(`/api/ambassadors/admin/payouts/${id}/${action}`, action === 'reject' ? { reason } : {}); await load(); router.refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The payout could not be updated.') }
    finally { setBusy(false) }
  }
  const approveSelected = async () => {
    if (!selected.length || !window.confirm(`Approve ${selected.length} withdrawals totalling ${formatAmount(selectedTotal)} and initiate each transfer?`)) return
    setBusy(true); setError('')
    try { await adminPost('/api/ambassadors/admin/payouts/bulk-approve', { ids: selected }); await load(); router.refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Bulk approval failed.') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4">
    <nav className="sa-segmented" aria-label="Payout status">{TABS.map((tab) => <button key={tab.status} type="button" aria-pressed={status === tab.status} onClick={() => setStatus(tab.status)}>{tab.label}</button>)}</nav>
    {status === 'requested' && selected.length ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4"><p>{selected.length} selected · <strong>{formatAmount(selectedTotal)}</strong></p><button className="sa-button sa-button--primary" type="button" disabled={busy} onClick={() => void approveSelected()}><Check size={15} aria-hidden /> Bulk approve</button></div> : null}
    {error ? <p role="alert" className="sa-callout sa-callout--critical">{error}</p> : null}
    <div className="flex justify-end"><button className="sa-button sa-button--ghost sa-button--sm" type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={14} aria-hidden /> Refresh</button></div>
    {loading ? <p className="sa-muted">Loading payout requests…</p> : null}
    {!loading && !rows.length ? <div className="sa-card p-8 text-center"><p className="font-semibold">No {status === 'success' ? 'paid' : status} payouts</p><p className="mt-1 sa-muted">Requests in this status will appear here.</p></div> : null}
    {rows.length ? <div className="sa-table-wrap"><table className="sa-table"><thead><tr>{status === 'requested' ? <th scope="col"><span className="sa-visually-hidden">Select</span></th> : null}<th scope="col">Ambassador</th><th scope="col">Amount</th><th scope="col">Bank</th><th scope="col">Available now</th><th scope="col">Risk flags</th><th scope="col">Requested</th><th scope="col">Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{status === 'requested' ? <td><input aria-label={`Select withdrawal ${row.id}`} type="checkbox" checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /></td> : null}<td><a className="sa-link" href={`/admin/ambassadors/wallet?ambassadorId=${row.ambassadorId}`}>{row.name}</a><small className="block sa-muted">{row.email}</small></td><td><Money amount={row.amountKobo} /></td><td>{row.bankName}<small className="block sa-muted">•••• {row.accountLast4}</small></td><td><Money amount={row.availableBalanceKobo} /></td><td>{row.openRiskFlags.length ? <span className="sa-pill sa-pill--caution">{row.openRiskFlags.length} open</span> : <span className="sa-muted">None</span>}{row.openRiskFlags.map((flag, i) => <small key={i} className="block sa-muted">{flag.kind}: {flag.note}</small>)}</td><td>{new Date(row.requestedAt).toLocaleString('en-NG')}</td><td>{row.status === 'requested' ? <span className="flex gap-2"><button className="sa-button sa-button--primary sa-button--sm" type="button" disabled={busy} onClick={() => void changeStatus(row.id, 'approve')}>Approve</button><button className="sa-button sa-button--secondary sa-button--sm" type="button" disabled={busy} onClick={() => void changeStatus(row.id, 'reject')}><X size={13} aria-hidden /> Reject</button></span> : row.failureReason ?? row.status}</td></tr>)}</tbody></table></div> : null}
  </section>
}

function formatAmount(kobo: number): string { return `₦${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(Math.round(kobo / 100))}` }
