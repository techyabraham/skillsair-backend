'use client'

import React, { useRef, useState } from 'react'
import { useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { RefreshCw } from 'lucide-react'

export function AmbassadorOrderRefund() {
  const { id } = useDocumentInfo()
  const status = useFormFields(([fields]) => fields.status?.value) as string | undefined
  const amount = useFormFields(([fields]) => fields.amount?.value) as number | undefined
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const requestId = useRef<string | null>(null)
  if (!id || (status !== 'success' && status !== 'refunded')) return null
  return <div className="sa-doc-actions">
    <button type="button" className="sa-button sa-button--secondary sa-button--sm" disabled={busy} onClick={async () => {
      const raw = window.prompt('Refund amount in naira. Leave blank to record the remaining order amount.', '')
      if (raw === null) return
      const amountKobo = raw.trim() ? Math.round(Number(raw.replace(/,/g, '')) * 100) : undefined
      if (amountKobo !== undefined && (!Number.isSafeInteger(amountKobo) || amountKobo <= 0)) { setError('Enter a positive amount in naira.'); return }
      const amountText = amountKobo === undefined ? 'the remaining paid amount' : `₦${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amountKobo / 100)}`
      if (!window.confirm(`Record a Paystack dashboard refund of ${amountText} for order ${id}? This updates the ambassador ledger; it does not initiate a Paystack refund.`)) return
      requestId.current ??= crypto.randomUUID()
      setBusy(true); setError(''); setMessage('')
      try {
        const response = await fetch(`/api/ambassadors/admin/orders/${id}/refund`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId.current }, body: JSON.stringify(amountKobo === undefined ? {} : { amountKobo }) })
        const json = await response.json().catch(() => null) as { error?: { message?: string } } | null
        if (!response.ok) { if (response.status < 500) requestId.current = null; throw new Error(json?.error?.message ?? 'The refund could not be recorded.') }
        requestId.current = null
        setMessage('Refund recorded. The ambassador ledger has been updated.')
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'The refund could not be recorded.') }
      finally { setBusy(false) }
    }}><RefreshCw size={14} aria-hidden /> {busy ? 'Recording…' : 'Record refund'}</button>
    {message ? <p role="status" className="sa-queue__status sa-queue__status--ok">{message}</p> : null}
    {error ? <p role="alert" className="sa-queue__status sa-queue__status--error">{error}</p> : null}
    <span className="sa-muted">Records a refund completed in Paystack; it does not send money.</span>
    {typeof amount === 'number' ? <span className="sa-visually-hidden">Order amount {amount}</span> : null}
  </div>
}
