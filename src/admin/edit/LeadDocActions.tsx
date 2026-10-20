'use client'

/**
 * Imisi's actions on an applicant, beside Save (`edit.beforeDocumentControls`): "Reply on
 * WhatsApp" opens a dialog with the suggested replies (POST /api/leads/:id/whatsapp-reply, only
 * inside the 24-hour window, enforced by the endpoint) and "Mark done" clears needsHuman
 * (POST /api/leads/:id/done). Replaces the old in-form LeadQueueActions panel; same endpoints.
 */
import React, { useRef, useState } from 'react'
import { useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useRouter } from 'next/navigation.js'
import { Check, MessageCircle, Send, X } from 'lucide-react'
import { EMAIL_QUICK_REPLIES } from '../../content/email-replies'

async function post(path: string, body: Record<string, unknown> = {}) {
  const response = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!response.ok) throw new Error(json?.error?.message ?? 'That didn’t work. Try again.')
}

export function LeadDocActions() {
  const { id } = useDocumentInfo()
  const router = useRouter()
  const needsHuman = useFormFields(([fields]) => fields.needsHuman?.value) as boolean | undefined
  const lastInbound = useFormFields(([fields]) => fields.lastInboundAt?.value) as string | undefined
  const dialog = useRef<HTMLDialogElement>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  if (!id) return null
  const windowOpen = lastInbound ? Date.now() - new Date(lastInbound).getTime() < 24 * 3_600_000 : false

  return (
    <div className="sa-doc-actions">
      <button
        type="button"
        className="sa-button sa-button--whatsapp sa-button--sm"
        onClick={() => dialog.current?.showModal()}
        disabled={!windowOpen}
        title={windowOpen ? undefined : 'They haven’t messaged in the last 24 hours, so only an approved template can be sent.'}
      >
        <MessageCircle size={14} strokeWidth={2} aria-hidden /> Reply
      </button>
      {needsHuman ? (
        <button
          type="button"
          className="sa-button sa-button--secondary sa-button--sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await post(`/api/leads/${id}/done`)
              router.refresh()
            } catch (error) {
              window.alert(error instanceof Error ? error.message : 'Couldn’t mark done.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <Check size={14} strokeWidth={2.25} aria-hidden /> Mark done
        </button>
      ) : null}
      <dialog ref={dialog} className="sa-reply-dialog" aria-labelledby="sa-reply-title">
        <div className="sa-drawer__head">
          <strong id="sa-reply-title">Reply on WhatsApp</strong>
          <button type="button" className="sa-button sa-button--ghost sa-button--sm" onClick={() => dialog.current?.close()} aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="sa-reply-dialog__body">
          <div className="sa-queue__quick" role="group" aria-label="Suggested replies">
            {EMAIL_QUICK_REPLIES.map((reply) => (
              <button key={reply.label} type="button" className="sa-chip" onClick={() => setBody(reply.body)}>
                {reply.label}
              </button>
            ))}
          </div>
          <label htmlFor="sa-lead-reply" className="sa-queue__label">
            Message <span className="sa-muted">(edit the [bracketed] parts first)</span>
          </label>
          <textarea id="sa-lead-reply" className="sa-textarea" rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
          <div className="sa-queue__actions">
            <button
              type="button"
              className="sa-button sa-button--whatsapp"
              disabled={busy || !body.trim()}
              onClick={async () => {
                setBusy(true)
                setStatus(null)
                try {
                  await post(`/api/leads/${id}/whatsapp-reply`, { body })
                  setBody('')
                  setStatus({ tone: 'ok', text: 'Sent. It now shows in the Conversation tab.' })
                  router.refresh()
                } catch (error) {
                  setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'The message wasn’t sent.' })
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Send size={16} strokeWidth={2} aria-hidden /> {busy ? 'Sending…' : 'Send reply'}
            </button>
          </div>
          {status ? (
            <p role="status" className={`sa-queue__status sa-queue__status--${status.tone}`}>
              {status.text}
            </p>
          ) : null}
        </div>
      </dialog>
    </div>
  )
}
