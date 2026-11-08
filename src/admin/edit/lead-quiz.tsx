/**
 * "Quiz profile" on the applicant's Overview tab: their top 3 Career Match results as bars
 * (careers SkillsAir doesn't run yet are marked "Coming soon") and their 5 trait scores, so
 * Imisi can open a WhatsApp chat already knowing the person. Server component, admin only.
 */
import React from 'react'
import type { UIFieldServerProps } from 'payload'
import { ProgressBar, StatusPill } from '../ui/primitives'
import { isAdmin } from '../data/auth'
import { TRAIT_IDS, TRAIT_LABELS, careerStatus, careers, isCareerId, matchLabel, topTraits, type TraitId } from '../../content/career-quiz'

type Lead = Record<string, unknown> & { id?: number }

export async function LeadQuizProfile(props: UIFieldServerProps) {
  if (!isAdmin(props.req) || !props.id) return null
  const lead = (props.data ?? {}) as Lead
  const scores = (Array.isArray(lead.quizScores) ? lead.quizScores : []) as Array<{ career: string; percent: number }>
  if (!scores.length) return null
  const traits = (lead.traits ?? {}) as Record<TraitId, number>

  const published = await props.payload.find({
    collection: 'courses',
    where: { status: { equals: 'published' } },
    limit: 500,
    depth: 0,
    pagination: false,
    overrideAccess: true,
    select: { slug: true } as never,
  })
  const slugs = new Set((published.docs as unknown as Array<{ slug?: string }>).map((doc) => doc.slug ?? '').filter(Boolean))
  const top3 = scores.filter((score) => isCareerId(score.career)).slice(0, 3)
  const [first, second] = topTraits(traits)

  return (
    <section className="sa-lead-summary" aria-label="Quiz profile">
      <h3 style={{ margin: '0 0 8px' }}>Quiz profile</h3>
      <p className="sa-muted" style={{ margin: '0 0 12px' }}>
        Career Match {String(lead.quizVersion ?? '')}. Mostly {TRAIT_LABELS[first].noun} and {TRAIT_LABELS[second].noun}.
        {lead.device === 'phone_only' ? ' Learning on a phone only.' : ''}
      </p>
      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {top3.map((score) => {
          const id = score.career as Parameters<typeof careerStatus>[0]
          const open = careerStatus(id, slugs) === 'open'
          return (
            <div key={score.career}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <strong>{careers[id].name}</strong>
                <span className="sa-muted">{matchLabel(score.percent)}</span>
                {open ? <StatusPill tone="positive">Open now</StatusPill> : <StatusPill tone="caution">Coming soon</StatusPill>}
              </div>
              <ProgressBar value={score.percent} label={`${careers[id].name} match`} tone={open ? 'accent' : 'caution'} />
            </div>
          )
        })}
      </div>
      <h4 style={{ margin: '0 0 8px' }}>Strengths</h4>
      <div style={{ display: 'grid', gap: 8 }}>
        {TRAIT_IDS.map((trait) => (
          <ProgressBar key={trait} value={Number(traits[trait] ?? 0)} label={TRAIT_LABELS[trait].name} tone="info" />
        ))}
      </div>
    </section>
  )
}
