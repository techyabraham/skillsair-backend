'use client'

/**
 * Branded error state for SkillsAir Studio (brief 7.13). Next.js renders this when a Studio page
 * throws; it offers a retry and a way back to Overview. No error details are shown or logged
 * here (the server logs have them).
 */
import React from 'react'

export default function StudioError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="sa-error-page">
      <div className="sa-error-page__card">
        <p className="sa-eyebrow">SkillsAir Studio</p>
        <h1 className="sa-error-page__title">Something went wrong on this page</h1>
        <p className="sa-error-page__text">It’s not something you did. Try again, or go back to Overview. If it keeps happening, the admin service logs will say why.</p>
        <div className="sa-error-page__actions">
          <button type="button" className="sa-button sa-button--primary" onClick={() => reset()}>
            Try again
          </button>
          <a className="sa-button sa-button--secondary" href="/admin">
            Back to Overview
          </a>
        </div>
      </div>
    </main>
  )
}
