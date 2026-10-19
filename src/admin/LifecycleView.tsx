import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'

/**
 * /admin/lifecycle: how each lifecycle step is doing over the last 30 days (brief section 12).
 * Judge steps by conversions (money or progress), not opens. A step is flagged red when more
 * than 1% of recipients unsubscribe or more than 0.1% mark it as spam.
 */
interface MessageRow {
  stepId: string
  track: string
  channel: string
  status: string
  skipReason?: string | null
  openedAt?: string | null
  clickedAt?: string | null
  convertedAt?: string | null
  unsubscribedAt?: string | null
  complainedAt?: string | null
  variant?: string | null
}

interface Stats {
  sent: number
  dryRun: number
  skipped: number
  opened: number
  clicked: number
  converted: number
  unsubscribed: number
  complained: number
  variants: Record<string, { sent: number; clicked: number; converted: number }>
}

/** Display order (same as src/lib/lifecycle/sequences.ts). */
const STEP_ORDER = [
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'W1', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'B1', 'B1-WA', 'B2', 'B3',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'D1', 'D2', 'D3', 'I0', 'I1', 'I2', 'I3',
  'R1', 'R2', 'R3', 'R4', 'R5', 'C1', 'C2', 'C2L', 'C3', 'C4', 'C5', 'G1', 'G2', 'G3', 'G4', 'X1',
]

const empty = (): Stats => ({ sent: 0, dryRun: 0, skipped: 0, opened: 0, clicked: 0, converted: 0, unsubscribed: 0, complained: 0, variants: {} })
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(part / whole < 0.01 ? 2 : 1)}%` : '–')

const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--theme-elevation-100)', textAlign: 'right', whiteSpace: 'nowrap' }
const head: React.CSSProperties = { ...cell, fontWeight: 600, color: 'var(--theme-elevation-600)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }

export const LifecycleView = async (props: AdminViewServerProps) => {
  const { initPageResult } = props
  const req = initPageResult.req
  const user = req.user as (typeof req.user & { role?: string }) | null
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const byStep = new Map<string, Stats>()
  let error = false

  if (user?.role === 'admin') {
    try {
      for (let page = 1; page <= 50; page++) {
        const result = await req.payload.find({ collection: 'messages', where: { sentAt: { greater_than: since } }, limit: 1000, page, depth: 0, overrideAccess: true })
        for (const doc of result.docs as unknown as MessageRow[]) {
          const step = doc.stepId.replace(/#\d+$/, '')
          const stats = byStep.get(step) ?? empty()
          if (doc.status === 'sent') {
            stats.sent++
            if (doc.openedAt) stats.opened++
            if (doc.clickedAt) stats.clicked++
            if (doc.convertedAt) stats.converted++
            if (doc.unsubscribedAt) stats.unsubscribed++
            if (doc.complainedAt) stats.complained++
            if (doc.variant) {
              const variant = (stats.variants[doc.variant] ??= { sent: 0, clicked: 0, converted: 0 })
              variant.sent++
              if (doc.clickedAt) variant.clicked++
              if (doc.convertedAt) variant.converted++
            }
          } else if (doc.skipReason === 'dry_run') stats.dryRun++
          else stats.skipped++
          byStep.set(step, stats)
        }
        if (!result.hasNextPage) break
      }
    } catch {
      error = true
    }
  }

  const order = new Map(STEP_ORDER.map((step, index) => [step, index]))
  const rows = [...byStep.entries()].sort(([a], [b]) => (order.get(a.replace(/-WA$/, '')) ?? 999) - (order.get(b.replace(/-WA$/, '')) ?? 999) || a.localeCompare(b))
  const dryRun = process.env.LIFECYCLE_DRY_RUN !== 'false'
  const live = (process.env.LIFECYCLE_LIVE_TRACKS ?? '').trim()

  return (
    <DefaultTemplate {...props} req={req} visibleEntities={initPageResult.visibleEntities}>
      <main style={{ padding: '32px 48px', maxWidth: 1280 }}>
        <p style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--theme-elevation-500)', margin: 0 }}>SkillsAir Studio / Lifecycle emails</p>
        <h1 style={{ margin: '8px 0 4px' }}>Lifecycle emails, last 30 days</h1>
        <p style={{ color: 'var(--theme-elevation-600)', marginTop: 0 }}>
          Mode: <strong>{dryRun ? 'dry-run (nothing is sent)' : live ? `live for ${live}` : 'live for no tracks yet'}</strong>. Judge each step by
          conversions, not opens. Red rows: more than 1% unsubscribed or more than 0.1% spam complaints.
        </p>
        {user?.role !== 'admin' ? (
          <p>Only admins can see this page.</p>
        ) : error ? (
          <p>The message log couldn&apos;t be loaded just now. Refresh to try again.</p>
        ) : rows.length === 0 ? (
          <p>No lifecycle messages in the last 30 days yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ ...head, textAlign: 'left' }}>Step</th>
                  <th style={head}>Sent</th>
                  <th style={head}>Dry-run</th>
                  <th style={head}>Skipped</th>
                  <th style={head}>Opened</th>
                  <th style={head}>Clicked</th>
                  <th style={head}>Converted</th>
                  <th style={head}>Unsubscribed</th>
                  <th style={head}>Spam</th>
                  <th style={{ ...head, textAlign: 'left' }}>A/B (sent · clicked · converted)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([step, stats]) => {
                  const red = stats.sent > 0 && (stats.unsubscribed / stats.sent > 0.01 || stats.complained / stats.sent > 0.001)
                  return (
                    <tr key={step} style={red ? { background: 'rgba(220, 38, 38, 0.12)' } : undefined}>
                      <td style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>{step}</td>
                      <td style={cell}>{stats.sent}</td>
                      <td style={cell}>{stats.dryRun}</td>
                      <td style={cell}>{stats.skipped}</td>
                      <td style={cell}>{stats.opened} <small>({pct(stats.opened, stats.sent)})</small></td>
                      <td style={cell}>{stats.clicked} <small>({pct(stats.clicked, stats.sent)})</small></td>
                      <td style={{ ...cell, fontWeight: 600 }}>{stats.converted} <small>({pct(stats.converted, stats.sent)})</small></td>
                      <td style={{ ...cell, color: red ? '#b91c1c' : undefined }}>{stats.unsubscribed} <small>({pct(stats.unsubscribed, stats.sent)})</small></td>
                      <td style={{ ...cell, color: red ? '#b91c1c' : undefined }}>{stats.complained} <small>({pct(stats.complained, stats.sent)})</small></td>
                      <td style={{ ...cell, textAlign: 'left' }}>
                        {Object.keys(stats.variants).length > 1
                          ? Object.entries(stats.variants).sort().map(([variant, v]) => `${variant}: ${v.sent} · ${v.clicked} · ${v.converted} (${pct(v.converted, v.sent)})`).join('  |  ')
                          : '–'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ color: 'var(--theme-elevation-500)', fontSize: 13, marginTop: 24 }}>
          Opens are unreliable (Apple Mail opens emails automatically). Pick A/B winners on conversions, once each version has a few hundred sends.
          Email previews: <a href="/api/email/preview/index">/api/email/preview/index</a>.
        </p>
      </main>
    </DefaultTemplate>
  )
}
