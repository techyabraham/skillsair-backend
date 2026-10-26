/**
 * Lifecycle email stats for the last 30 days (brief 7.4), in one SQL aggregate instead of paging
 * up to 50,000 message documents in JavaScript as the old view did. Admin only; cached 60 s.
 * A step is red when more than 1% of recipients unsubscribed or more than 0.1% complained.
 */
import type { PayloadRequest } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { assertAdmin } from './auth.js'
import { cached } from './cache.js'
import { stepHealth } from './metrics-core.js'

export interface StepStats {
  step: string
  track: string
  sent: number
  dryRun: number
  skipped: number
  opened: number
  clicked: number
  converted: number
  unsubscribed: number
  complained: number
  variants: Array<{ variant: string; sent: number; clicked: number; converted: number }>
  health: 'positive' | 'caution' | 'critical' | 'neutral'
}

export interface TrackStats {
  track: string
  sent: number
  clicked: number
  converted: number
  health: 'positive' | 'caution' | 'critical' | 'neutral'
}

/** Display order (same as src/lib/lifecycle/sequences.ts). */
export const STEP_ORDER = [
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'W1', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'B1', 'B1-WA', 'B2', 'B3',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'D1', 'D2', 'D3', 'I0', 'I1', 'I2', 'I3', 'L1', 'L2',
  'R1', 'R2', 'R3', 'R4', 'R5', 'C1', 'C2', 'C2L', 'C3', 'C4', 'C5', 'G1', 'G2', 'G3', 'G4', 'X1',
]

export const TRACKS: Array<{ track: string; name: string }> = [
  { track: 'A', name: 'Applied, not paid' },
  { track: 'Apost', name: 'After the window' },
  { track: 'B', name: 'Payment trouble' },
  { track: 'T', name: 'Receipts and service' },
  { track: 'D', name: 'Renewal failed' },
  { track: 'I', name: 'Inactive learners' },
  { track: 'L', name: 'Learning plan' },
  { track: 'R', name: 'Win-back' },
  { track: 'C', name: 'Completion' },
  { track: 'G', name: 'Graduates' },
  { track: 'X', name: 'Sunset' },
]

export async function getLifecycleStats(req: PayloadRequest): Promise<{ steps: StepStats[]; tracks: TrackStats[] }> {
  assertAdmin(req)
  const { value } = await cached('lifecycle', async () => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const db = req.payload.db as unknown as { drizzle: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Array<Record<string, unknown>> }> } }
    // Step totals and A/B splits come from two grouped sets joined by step (a correlated
    // subquery on an ungrouped column isn't allowed under GROUP BY).
    const { rows } = await db.drizzle.execute(sql`
      WITH m AS (
        SELECT regexp_replace(step_id, '#[0-9]+$', '') AS step, track, status, skip_reason,
               opened_at, clicked_at, converted_at, unsubscribed_at, complained_at, variant
        FROM messages WHERE sent_at >= ${since}::timestamptz),
      v AS (
        SELECT step, json_agg(json_build_object('variant', variant, 'sent', sent, 'clicked', clicked, 'converted', converted) ORDER BY variant) AS variants
        FROM (SELECT step, variant, count(*)::int AS sent, count(clicked_at)::int AS clicked, count(converted_at)::int AS converted
              FROM m WHERE status = 'sent' AND variant IS NOT NULL GROUP BY step, variant) x
        GROUP BY step)
      SELECT m.step, m.track,
        count(*) FILTER (WHERE m.status = 'sent')::int AS sent,
        count(*) FILTER (WHERE m.status <> 'sent' AND m.skip_reason = 'dry_run')::int AS dry_run,
        count(*) FILTER (WHERE m.status <> 'sent' AND coalesce(m.skip_reason, '') <> 'dry_run')::int AS skipped,
        count(*) FILTER (WHERE m.status = 'sent' AND m.opened_at IS NOT NULL)::int AS opened,
        count(*) FILTER (WHERE m.status = 'sent' AND m.clicked_at IS NOT NULL)::int AS clicked,
        count(*) FILTER (WHERE m.status = 'sent' AND m.converted_at IS NOT NULL)::int AS converted,
        count(*) FILTER (WHERE m.status = 'sent' AND m.unsubscribed_at IS NOT NULL)::int AS unsubscribed,
        count(*) FILTER (WHERE m.status = 'sent' AND m.complained_at IS NOT NULL)::int AS complained,
        coalesce(max(v.variants::text), '[]')::json AS variants
      FROM m LEFT JOIN v ON v.step = m.step
      GROUP BY m.step, m.track
    `)
    const order = new Map(STEP_ORDER.map((step, index) => [step, index]))
    const steps: StepStats[] = rows
      .map((row) => {
        const base = {
          step: String(row.step),
          track: String(row.track),
          sent: Number(row.sent),
          dryRun: Number(row.dry_run),
          skipped: Number(row.skipped),
          opened: Number(row.opened),
          clicked: Number(row.clicked),
          converted: Number(row.converted),
          unsubscribed: Number(row.unsubscribed),
          complained: Number(row.complained),
          variants: (row.variants as StepStats['variants']) ?? [],
        }
        return { ...base, health: stepHealth(base) }
      })
      .sort((a, b) => (order.get(a.step) ?? 999) - (order.get(b.step) ?? 999) || a.step.localeCompare(b.step))
    const tracks = TRACKS.map(({ track }) => {
      const mine = steps.filter((s) => s.track === track)
      const totals = mine.reduce((sum, s) => ({ sent: sum.sent + s.sent, clicked: sum.clicked + s.clicked, converted: sum.converted + s.converted, unsubscribed: sum.unsubscribed + s.unsubscribed, complained: sum.complained + s.complained }), { sent: 0, clicked: 0, converted: 0, unsubscribed: 0, complained: 0 })
      const health = mine.some((s) => s.health === 'critical') ? 'critical' : mine.some((s) => s.health === 'caution') ? 'caution' : stepHealth(totals)
      return { track, sent: totals.sent, clicked: totals.clicked, converted: totals.converted, health }
    })
    return { steps, tracks }
  })
  return value
}
