/**
 * Above the Career waitlist list: how many people wait for each career (demand data for what to
 * launch next), whether its programme is published yet, and, once it is, a Notify button that
 * sends the launch message to consenting applicants (POST /api/career-waitlist/notify).
 */
import React from 'react'
import type { Payload, TypedUser } from 'payload'
import { StatusPill } from '../ui/primitives'
import { formatNumber } from '../format'
import { CAREER_IDS, careerStatus, careers, type CareerId } from '../../content/career-quiz'
import { NotifyWaitlistButton } from './career-waitlist-notify'

type StripProps = { payload: Payload; user?: TypedUser | null }

export async function CareerWaitlistStrip({ payload, user }: StripProps) {
  if ((user as { role?: string } | null | undefined)?.role !== 'admin') return null
  const [rows, published] = await Promise.all([
    payload.find({ collection: 'career-waitlist' as never, limit: 100_000, depth: 0, pagination: false, overrideAccess: true, select: { career: true, notifiedAt: true } as never }),
    payload.find({ collection: 'courses', where: { status: { equals: 'published' } }, limit: 500, depth: 0, pagination: false, overrideAccess: true, select: { slug: true } as never }),
  ])
  const slugs = new Set((published.docs as unknown as Array<{ slug?: string }>).map((doc) => doc.slug ?? '').filter(Boolean))
  const counts = new Map<string, { total: number; pending: number }>()
  for (const row of rows.docs as unknown as Array<{ career: string; notifiedAt?: string | null }>) {
    const entry = counts.get(row.career) ?? { total: 0, pending: 0 }
    entry.total += 1
    if (!row.notifiedAt) entry.pending += 1
    counts.set(row.career, entry)
  }
  const listed = (CAREER_IDS as readonly CareerId[])
    .filter((id) => counts.has(id) || careerStatus(id, slugs) === 'waitlist')
    .sort((a, b) => (counts.get(b)?.total ?? 0) - (counts.get(a)?.total ?? 0))

  return (
    <section className="sa-strip" aria-label="Waitlist by career">
      <table className="sa-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'left', fontWeight: 600, padding: '0 0 8px' }}>Waiting per career</caption>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left' }}>Career</th>
            <th scope="col" style={{ textAlign: 'right' }}>Waiting</th>
            <th scope="col" style={{ textAlign: 'right' }}>Not yet notified</th>
            <th scope="col" style={{ textAlign: 'left' }}>Programme</th>
            <th scope="col"><span className="sa-visually-hidden">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {listed.map((id) => {
            const count = counts.get(id) ?? { total: 0, pending: 0 }
            const open = careerStatus(id, slugs) === 'open'
            return (
              <tr key={id}>
                <td>
                  <a href={`/admin/collections/career-waitlist?where[career][equals]=${id}`}>{careers[id].name}</a>
                </td>
                <td style={{ textAlign: 'right' }}>{formatNumber(count.total)}</td>
                <td style={{ textAlign: 'right' }}>{formatNumber(count.pending)}</td>
                <td>{open ? <StatusPill tone="positive">Published</StatusPill> : <StatusPill tone="neutral">Not offered yet</StatusPill>}</td>
                <td style={{ textAlign: 'right' }}>{open && count.pending > 0 ? <NotifyWaitlistButton career={id} name={careers[id].name} pending={count.pending} /> : null}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
