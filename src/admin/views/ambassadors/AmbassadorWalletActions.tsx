'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation.js'
import { AlertTriangle, Eye, RefreshCw, Wallet } from 'lucide-react'
import { Card, Money, StatusPill } from '../../ui/primitives'

interface WalletData {
  ambassador: { id: number; status: 'pending' | 'active' | 'blocked'; firstName: string; lastName: string; email: string; riskFlags: Array<{ index: number; kind: string; note?: string; openedAt?: string; resolvedAt?: string | null }> }
  wallet: { pendingKobo: number; availableKobo: number; inFlightKobo: number; paidOutKobo: number; totalEarnedKobo: number }
  ledger: Array<{ id: number; type: string; status: string; amountKobo: number; productTitle: string; createdAt: string; availableAt: string | null; note: string; customer: string }>
  payouts: Array<{ id: number; amountKobo: number; status: string; bankName: string; accountLast4: string; createdAt: string; failureReason: string | null }>
  referrals: Array<{ id: number; attributedAt: string; name: string; email: string }>
}
async function api(path: string, body?: Record<string, unknown>, headers?: Record<string, string>) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'include', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const json = await response.json().catch(() => null) as { success?: boolean; data?: unknown; error?: { message?: string } } | null
  if (!response.ok || !json?.success) throw new Error(json?.error?.message ?? 'The action could not be completed.')
  return json.data
}

export function AmbassadorWalletActions({ ambassadorId, initialStatus, initialReason, initialFlags }: { ambassadorId: number; initialStatus: 'pending' | 'active' | 'blocked'; initialReason: string; initialFlags: Array<{ index: number; kind: string; note?: string; openedAt?: string; resolvedAt?: string | null }> }) {
  const router = useRouter()
  const [data, setData] = useState<WalletData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState<{ bankName: string; accountName: string; accountNumber: string } | null>(null)
  const load = useCallback(async () => {
    setError('')
    try { setData(await api(`/api/ambassadors/admin/ambassadors/${ambassadorId}/wallet`) as WalletData) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Wallet details could not be loaded.') }
  }, [ambassadorId])
  useEffect(() => { void load() }, [load])
  const doStatus = async (status: 'active' | 'blocked') => {
    const reason = status === 'blocked' ? window.prompt('Enter a reason for blocking this ambassador:') : undefined
    if (status === 'blocked' && !reason?.trim()) return
    if (!window.confirm(status === 'active' ? 'Activate this ambassador? This enables new referrals, commissions and withdrawals.' : 'Block this ambassador? History and approved money will remain, but withdrawals will stop.')) return
    setBusy(true); setError('')
    try { await api(`/api/ambassadors/admin/ambassadors/${ambassadorId}/status`, { status, ...(reason ? { reason } : {}) }); await load(); router.refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Status could not be changed.') }
    finally { setBusy(false) }
  }
  const adjust = async () => {
    const rawAmount = window.prompt('Adjustment amount in naira. Use a negative amount to remove money.')
    if (rawAmount === null) return
    const amountKobo = Math.round(Number(rawAmount.replace(/,/g, '')) * 100)
    const note = window.prompt('Reason for this adjustment (at least 10 characters):')
    if (!Number.isSafeInteger(amountKobo) || amountKobo === 0 || !note?.trim() || note.trim().length < 10) { setError('Enter a non-zero naira amount and a reason of at least 10 characters.'); return }
    if (!window.confirm(`Record an approved wallet adjustment of ${new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(amountKobo / 100)}? This immediately changes available balance.`)) return
    setBusy(true); setError('')
    try { await api(`/api/ambassadors/admin/ambassadors/${ambassadorId}/adjust`, { amountKobo, note: note.trim() }, { 'Idempotency-Key': crypto.randomUUID() }); await load(); router.refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Adjustment could not be recorded.') }
    finally { setBusy(false) }
  }
  const resolveFlag = async (index: number) => {
    const note = window.prompt('Add a resolution note:')
    if (!note?.trim()) return
    if (!window.confirm('Resolve this risk flag? The resolution note and admin identity will be recorded.')) return
    setBusy(true); setError('')
    try { await api(`/api/ambassadors/admin/ambassadors/${ambassadorId}/flags/${index}/resolve`, { note }); await load(); router.refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Risk flag could not be resolved.') }
    finally { setBusy(false) }
  }
  const revealBank = async () => {
    if (!window.confirm('Reveal the full current bank account number? This access is recorded in the audit log.')) return
    setBusy(true); setError('')
    try { setRevealed(await api(`/api/ambassadors/admin/ambassadors/${ambassadorId}/bank/reveal`) as typeof revealed) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Bank account could not be revealed.') }
    finally { setBusy(false) }
  }
  const wallet = data?.wallet
  const flags = data?.ambassador.riskFlags ?? initialFlags
  return <div className="space-y-5">
    {error ? <p role="alert" className="sa-callout sa-callout--critical">{error}</p> : null}
    <div className="flex flex-wrap gap-2"><StatusPill tone={data?.ambassador.status === 'active' ? 'positive' : data?.ambassador.status === 'blocked' ? 'critical' : 'caution'}>{data?.ambassador.status ?? initialStatus}</StatusPill>{data?.ambassador.status === 'blocked' ? <span className="sa-muted">{initialReason}</span> : null}<button className="sa-button sa-button--ghost sa-button--sm" type="button" disabled={busy} onClick={() => void load()}><RefreshCw size={14} aria-hidden /> Refresh</button><button className="sa-button sa-button--primary sa-button--sm" type="button" disabled={busy || data?.ambassador.status === 'active'} onClick={() => void doStatus('active')}>Approve / Reactivate</button><button className="sa-button sa-button--secondary sa-button--sm" type="button" disabled={busy || data?.ambassador.status === 'blocked'} onClick={() => void doStatus('blocked')}>Block</button><button className="sa-button sa-button--secondary sa-button--sm" type="button" disabled={busy} onClick={() => void adjust()}><Wallet size={14} aria-hidden /> Adjust wallet</button><button className="sa-button sa-button--ghost sa-button--sm" type="button" disabled={busy} onClick={() => void revealBank()}><Eye size={14} aria-hidden /> Reveal account</button></div>
    {revealed ? <div className="sa-callout sa-callout--caution" role="status"><strong>{revealed.bankName}</strong> · {revealed.accountName} · <code>{revealed.accountNumber}</code><button type="button" className="ml-3 underline" onClick={() => setRevealed(null)}>Hide</button></div> : null}
    {wallet ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[['Available',wallet.availableKobo],['Pending',wallet.pendingKobo],['In flight',wallet.inFlightKobo],['Paid out',wallet.paidOutKobo],['Total earned',wallet.totalEarnedKobo]].map(([label, value]) => <Card key={String(label)} className="p-4"><p className="sa-muted">{label}</p><p className="mt-2 text-lg font-semibold"><Money amount={Number(value)} /></p></Card>)}</div> : <p className="sa-muted">Loading wallet details…</p>}
    <Card><h2 className="sa-card__title">Risk flags</h2>{flags.length ? <div className="mt-3 space-y-3">{flags.map((flag) => <div key={flag.index} className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-3"><p><AlertTriangle size={15} className="mr-2 inline text-amber-700" aria-hidden /><strong>{flag.kind}</strong> · {flag.note ?? 'No note'} {flag.resolvedAt ? <span className="sa-muted">· Resolved</span> : null}</p>{!flag.resolvedAt ? <button className="sa-button sa-button--secondary sa-button--sm" disabled={busy} type="button" onClick={() => void resolveFlag(flag.index)}>Resolve flag</button> : null}</div>)}</div> : <p className="mt-3 sa-muted">No risk flags.</p>}</Card>
    <Card><h2 className="sa-card__title">Ledger</h2>{data?.ledger.length ? <div className="sa-table-wrap mt-3"><table className="sa-table"><thead><tr><th>Created</th><th>Type</th><th>Product / customer</th><th>Amount</th><th>Status</th><th>Available</th><th>Note</th></tr></thead><tbody>{data.ledger.map((row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleDateString('en-NG')}</td><td>{row.type}</td><td>{row.productTitle || row.customer}</td><td><Money amount={row.amountKobo} /></td><td>{row.status}</td><td>{row.availableAt ? new Date(row.availableAt).toLocaleDateString('en-NG') : '—'}</td><td>{row.note}</td></tr>)}</tbody></table></div> : <p className="mt-3 sa-muted">No ledger entries.</p>}</Card>
    <Card><h2 className="sa-card__title">Payouts</h2>{data?.payouts.length ? <div className="sa-table-wrap mt-3"><table className="sa-table"><thead><tr><th>Date</th><th>Amount</th><th>Bank</th><th>Status</th><th>Failure reason</th></tr></thead><tbody>{data.payouts.map((row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleDateString('en-NG')}</td><td><Money amount={row.amountKobo} /></td><td>{row.bankName} · •••• {row.accountLast4}</td><td>{row.status}</td><td>{row.failureReason ?? '—'}</td></tr>)}</tbody></table></div> : <p className="mt-3 sa-muted">No payouts.</p>}</Card>
    <Card><h2 className="sa-card__title">Referred users</h2>{data?.referrals.length ? <div className="sa-table-wrap mt-3"><table className="sa-table"><thead><tr><th>Name</th><th>Email</th><th>Joined</th></tr></thead><tbody>{data.referrals.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.email}</td><td>{new Date(row.attributedAt).toLocaleDateString('en-NG')}</td></tr>)}</tbody></table></div> : <p className="mt-3 sa-muted">No referred users.</p>}</Card>
  </div>
}
