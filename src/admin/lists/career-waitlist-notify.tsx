'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation.js'

/** Sends the launch message for one career after a confirmation (consenting applicants only). */
export function NotifyWaitlistButton({ career, name, pending }: { career: string; name: string; pending: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  return (
    <span>
      <button
        type="button"
        className="sa-button sa-button--primary sa-button--sm"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(`Send the "${name} is open" message to ${pending} waiting applicant${pending === 1 ? '' : 's'}? Only people with marketing consent get it.`)) return
          setBusy(true)
          setStatus('')
          try {
            const response = await fetch('/api/career-waitlist/notify', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ career }) })
            const json = (await response.json().catch(() => null)) as { data?: { notified: number; skippedNoConsent: number; failed: number }; error?: { message?: string } } | null
            if (!response.ok || !json?.data) throw new Error(json?.error?.message ?? 'That didn’t work. Try again.')
            setStatus(`Notified ${json.data.notified}. No consent: ${json.data.skippedNoConsent}. Not delivered: ${json.data.failed}.`)
            router.refresh()
          } catch (error) {
            setStatus(error instanceof Error ? error.message : 'That didn’t work.')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Sending…' : 'Notify'}
      </button>
      {status ? <span role="status" className="sa-muted" style={{ marginLeft: 8 }}>{status}</span> : null}
    </span>
  )
}
