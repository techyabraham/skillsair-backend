'use client'

import React, { useState } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'

/**
 * Imisi's queue actions on a lead: reply on WhatsApp (inside the 24-hour window) and
 * "Mark done" (clears needsHuman). Uses the admin's Payload session.
 */
export function LeadQueueActions() {
  const { id } = useDocumentInfo()
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  if (!id) return null

  const call = async (path: string, payload?: Record<string, unknown>) => {
    setBusy(true)
    setStatus(null)
    try {
      const response = await fetch(`/api/leads/${id}/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const result = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
      if (!response.ok) throw new Error(result?.error?.message ?? 'Request failed')
      return true
    } catch (err) {
      setStatus({ tone: 'error', text: err instanceof Error ? err.message : 'Request failed' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const box: React.CSSProperties = { border: '1px solid var(--theme-elevation-150)', borderRadius: 8, padding: 16, marginBottom: 24 }
  const button: React.CSSProperties = { padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600 }

  return (
    <div style={box}>
      <h3 style={{ marginTop: 0 }}>Imisi&apos;s queue</h3>
      <label htmlFor="lead-wa-reply" style={{ display: 'block', marginBottom: 6 }}>
        Reply on WhatsApp (only within 24 hours of their last message)
      </label>
      <textarea
        id="lead-wa-reply"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--theme-elevation-250)' }}
      />
      <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy || !body.trim()}
          style={{ ...button, background: '#128C7E', color: '#fff' }}
          onClick={async () => {
            if (await call('whatsapp-reply', { body })) {
              setBody('')
              setStatus({ tone: 'ok', text: 'Sent. Refresh to see it in the WhatsApp log.' })
            }
          }}
        >
          Send WhatsApp reply
        </button>
        <button
          type="button"
          disabled={busy}
          style={{ ...button, background: 'var(--theme-elevation-150)' }}
          onClick={async () => {
            if (await call('done')) setStatus({ tone: 'ok', text: 'Marked done. Refresh to update the fields.' })
          }}
        >
          Mark done
        </button>
      </div>
      {status && (
        <p role="status" style={{ marginTop: 12, color: status.tone === 'ok' ? '#15803d' : '#b91c1c' }}>
          {status.text}
        </p>
      )}
      <p style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
        Tip: open Leads → filter &ldquo;Needs human&rdquo; is true → sort by Score (highest first) for the queue. If this number can use WhatsApp Business app coexistence, you can reply from the app instead.
      </p>
    </div>
  )
}
