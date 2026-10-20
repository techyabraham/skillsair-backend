'use client'

/**
 * Opens the admin-only email preview (GET /api/email/preview/:template, session cookie) in a
 * side drawer. Uses the native <dialog> for focus trapping, Escape to close and focus return.
 */
import React, { useRef } from 'react'
import { X } from 'lucide-react'

export function EmailPreviewButton({ step }: { step: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button type="button" className="sa-button sa-button--ghost sa-button--sm" onClick={() => dialog.current?.showModal()}>
        Preview<span className="sa-visually-hidden"> email {step}</span>
      </button>
      <dialog ref={dialog} className="sa-drawer" aria-label={`Email ${step} preview`} onClick={(event) => event.target === dialog.current && dialog.current?.close()}>
        <div className="sa-drawer__head">
          <strong>Email {step}</strong>
          <button type="button" className="sa-button sa-button--ghost sa-button--sm" onClick={() => dialog.current?.close()} aria-label="Close preview">
            <X size={18} aria-hidden />
          </button>
        </div>
        <iframe className="sa-drawer__frame" title={`Email ${step} preview`} src={`/api/email/preview/${encodeURIComponent(step)}`} loading="lazy" />
      </dialog>
    </>
  )
}
