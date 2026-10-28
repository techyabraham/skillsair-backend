'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation.js'
import { Check, UserPlus, X } from 'lucide-react'
import { StatusPill } from '../../ui/primitives'

interface Application { id: number; code: string; username: string; emailVerified: boolean; promotionPlan: string; about: string; heardAbout: string; createdAt: string; firstName: string; lastName: string; email: string }
async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await response.json().catch(() => null) as { error?: { message?: string } } | null
  if (!response.ok) throw new Error(json?.error?.message ?? 'The request could not be completed.')
}

export function AmbassadorApplications({ initial }: { initial: Application[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ firstName: '', lastName: '', email: '', username: '' })
  const [convertForm, setConvertForm] = useState({ userId: '', email: '', username: '' })
  const [userMatches, setUserMatches] = useState<Array<{ id: number; email: string; firstName: string; lastName: string }>>([])
  async function decide(id: number, status: 'active' | 'blocked') {
    const reason = status === 'blocked' ? window.prompt('Enter the reason for declining this application:') : undefined
    if (status === 'blocked' && !reason?.trim()) return
    if (!window.confirm(status === 'active' ? 'Approve this application? The applicant will be activated and emailed their referral link.' : 'Decline this application? The applicant will be blocked and the reason recorded.')) return
    setBusy(id); setError('')
    try { await post(`/api/ambassadors/admin/ambassadors/${id}/status`, { status, ...(reason ? { reason } : {}) }); router.refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The application could not be updated.') }
    finally { setBusy(null) }
  }
  async function create() {
    setBusy(-1); setError('')
    try { await post('/api/ambassadors/admin/ambassadors', { ...createForm, status: 'active' }); setCreateForm({ firstName: '', lastName: '', email: '', username: '' }); setAddOpen(false); router.refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Ambassador could not be created.') }
    finally { setBusy(null) }
  }
  async function convert() {
    setBusy(-2); setError('')
    try { await post('/api/ambassadors/admin/ambassadors/convert', { userId: Number(convertForm.userId), username: convertForm.username }); setConvertForm({ userId: '', email: '', username: '' }); setUserMatches([]); setAddOpen(false); router.refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Account could not be converted.') }
    finally { setBusy(null) }
  }
  async function findUser() {
    setError('')
    try {
      const response = await fetch(`/api/ambassadors/admin/users?email=${encodeURIComponent(convertForm.email)}`, { credentials: 'include', cache: 'no-store' })
      const json = await response.json() as { success?: boolean; data?: Array<{ id: number; email: string; firstName: string; lastName: string }>; error?: { message?: string } }
      if (!response.ok || !json.success) throw new Error(json.error?.message ?? 'Could not search for that account.')
      setUserMatches(json.data ?? [])
      setConvertForm((current) => ({ ...current, userId: '' }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not search for that account.') }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="sa-muted">{initial.length} pending application{initial.length === 1 ? '' : 's'}</p><button type="button" className="sa-button sa-button--primary" onClick={() => setAddOpen((open) => !open)}><UserPlus size={16} aria-hidden /> Add ambassador</button></div>
    {error ? <p role="alert" className="sa-callout sa-callout--critical">{error}</p> : null}
    {addOpen ? <section className="sa-card space-y-4 p-5"><h2 className="sa-card__title">Create a verified ambassador</h2><div className="grid gap-3 md:grid-cols-2">{(['firstName','lastName','email','username'] as const).map((name) => <label key={name} className="grid gap-1 text-sm"><span>{({ firstName: 'First name', lastName: 'Last name', email: 'Email', username: 'Username' })[name]}</span><input className="sa-input" value={createForm[name]} onChange={(event) => setCreateForm((current) => ({ ...current, [name]: event.target.value }))} /></label>)}</div><button className="sa-button sa-button--primary" type="button" disabled={busy !== null || Object.values(createForm).some((value) => !value.trim())} onClick={() => void create()}>Create and invite</button><hr /><h3 className="font-semibold">Convert an existing user</h3><div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm">Search by email<input className="sa-input" type="email" value={convertForm.email} onChange={(event) => setConvertForm((current) => ({ ...current, email: event.target.value, userId: '' }))} /></label><button className="sa-button sa-button--secondary" type="button" disabled={busy !== null || !convertForm.email} onClick={() => void findUser()}>Find account</button><label className="grid gap-1 text-sm">Username<input className="sa-input" value={convertForm.username} onChange={(event) => setConvertForm((current) => ({ ...current, username: event.target.value }))} /></label></div>{userMatches.length ? <label className="grid max-w-xl gap-1 text-sm">Existing account<select className="sa-input" value={convertForm.userId} onChange={(event) => setConvertForm((current) => ({ ...current, userId: event.target.value }))}><option value="">Select a user</option>{userMatches.map((user) => <option key={user.id} value={user.id}>{user.firstName} {user.lastName} · {user.email} · ID {user.id}</option>)}</select></label> : null}<button className="sa-button sa-button--secondary" type="button" disabled={busy !== null || !convertForm.userId || !convertForm.username} onClick={() => void convert()}>Convert existing account</button></section> : null}
    {!initial.length ? <div className="sa-card p-8 text-center"><p className="font-semibold">No applications waiting</p><p className="mt-1 sa-muted">New applications will appear here after email verification.</p></div> : initial.map((app) => <article key={app.id} className="sa-card space-y-4 p-5"><header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{app.firstName} {app.lastName}</h2><p className="sa-muted">{app.email} · @{app.username}</p><p className="mt-1 text-xs sa-muted">Applied {new Date(app.createdAt).toLocaleDateString('en-NG')} · {app.emailVerified ? 'Email verified' : 'Email not verified'}</p></div><StatusPill tone={app.emailVerified ? 'positive' : 'caution'}>{app.emailVerified ? 'Verified' : 'Unverified'}</StatusPill></header><div className="grid gap-4 md:grid-cols-2"><div><h3 className="text-sm font-semibold">Promotion plan</h3><p className="mt-1 whitespace-pre-wrap text-sm">{app.promotionPlan || 'Not provided'}</p></div><div><h3 className="text-sm font-semibold">About</h3><p className="mt-1 whitespace-pre-wrap text-sm">{app.about || 'Not provided'}</p><p className="mt-2 text-xs sa-muted">Heard about SkillsAir: {app.heardAbout || 'Not provided'}</p></div></div><div className="flex flex-wrap gap-2"><button type="button" className="sa-button sa-button--primary" disabled={busy !== null || !app.emailVerified} title={!app.emailVerified ? 'The applicant must verify their email first.' : undefined} onClick={() => void decide(app.id, 'active')}><Check size={15} aria-hidden /> Approve</button><button type="button" className="sa-button sa-button--secondary" disabled={busy !== null} onClick={() => void decide(app.id, 'blocked')}><X size={15} aria-hidden /> Decline</button><a className="sa-button sa-button--ghost" href={`/admin/ambassadors/wallet?ambassadorId=${app.id}`}>Wallet and actions</a></div></article>)}
  </div>
}
