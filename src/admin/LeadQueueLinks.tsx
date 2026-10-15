import React from 'react'

const QUEUE = '/admin/collections/leads?where[or][0][and][0][needsHuman][equals]=true&sort=-score'
const WAITLIST = '/admin/collections/leads?where[or][0][and][0][waitlist][equals]=true&sort=-createdAt'
const ALL = '/admin/collections/leads?sort=-createdAt'

const link: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 14px',
  borderRadius: 6,
  fontWeight: 600,
  textDecoration: 'none',
  border: '1px solid var(--theme-elevation-150)',
}

/** One-click views above the Leads list: Imisi's queue first. */
export function LeadQueueLinks() {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <a href={QUEUE} style={{ ...link, background: '#c2410c', color: '#fff', borderColor: '#c2410c' }}>
        Imisi&apos;s queue (needs a human, highest score first)
      </a>
      <a href={WAITLIST} style={link}>Waitlist</a>
      <a href={ALL} style={link}>All leads, newest first</a>
    </div>
  )
}
