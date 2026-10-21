/**
 * Environment ribbon (`admin.components.header`): a thin band above the app header, shown when
 * NODE_ENV is not production or STUDIO_ENV_LABEL is set (e.g. "STAGING"), so nobody edits
 * production by mistake. Nothing renders in production without a label.
 */
import React from 'react'

export function EnvRibbon() {
  const label = (process.env.STUDIO_ENV_LABEL ?? '').trim()
  if (!label && process.env.NODE_ENV === 'production') return null
  const text = label || 'DEVELOPMENT'
  return (
    <div className="sa-env-ribbon" role="note">
      <strong>{text}</strong> environment
    </div>
  )
}
