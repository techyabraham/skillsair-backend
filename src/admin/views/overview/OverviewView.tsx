/**
 * Overview (`admin.components.views.dashboard`, replaces SkillsAirDashboard). Answers "how are
 * we doing?" in five seconds: hero (greeting, scholarship window, queue), six KPIs with deltas
 * and sparklines, funnel, revenue, schools, programmes, problems, learning and activity.
 * Admins get the business view; instructors get their own programmes (no revenue or applicants).
 * Period switch: ?period=today|7d|30d|window. "Refresh" (?refresh=1) drops the 60-second cache.
 */
import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { BookOpen, FilePlus2, Image as ImageIcon, PenLine, RefreshCw, Workflow } from 'lucide-react'
import { StudioPage } from '../../ui/StudioPage'
import { AdirePattern } from '../../brand/StudioBrand'
import { Countdown } from '../../ui/client'
import { Card, CardHeader, EmptyState, ProgressBar, ProgressRing, StatusPill } from '../../ui/primitives'
import { studioUser } from '../../data/auth'
import { invalidate } from '../../data/cache'
import { getWindowState } from '../../data/nav'
import { getAdmissions, getInstructorOverview } from '../../data/metrics'
import { PERIODS, parsePeriod, periodRange } from '../../data/metrics-core'
import { formatClock, formatDay, formatDuration, formatLongDate, formatPercent, formatWhen, greeting } from '../../format'
import { ActivityPanel, AdmissionsFunnelPanel, KpiRow, LearningHealthPanel, NeedsAttentionPanel, RevenuePanel, SchoolsPanel, TopProgrammesPanel } from './panels'
import { AmbassadorOverview } from '../ambassadors/AmbassadorOverview'

const param = (value: unknown) => (Array.isArray(value) ? value[0] : value) as string | undefined

function QuickActions({ admin }: { admin: boolean }) {
  const actions = [
    { href: '/admin/collections/courses/create', label: 'New programme', icon: <BookOpen size={18} strokeWidth={1.75} /> },
    { href: '/admin/collections/lessons/create', label: 'New lesson', icon: <FilePlus2 size={18} strokeWidth={1.75} /> },
    { href: '/admin/collections/media/create', label: 'Upload media', icon: <ImageIcon size={18} strokeWidth={1.75} /> },
    ...(admin
      ? [
          { href: '/admin/globals/email-content', label: 'Edit email content', icon: <PenLine size={18} strokeWidth={1.75} /> },
          { href: '/admin/lifecycle', label: 'View lifecycle', icon: <Workflow size={18} strokeWidth={1.75} /> },
        ]
      : []),
  ]
  return (
    <nav className="sa-quick" aria-label="Quick actions">
      {actions.map((action) => (
        <a key={action.href} className="sa-quick__item" href={action.href}>
          <span className="sa-quick__icon" aria-hidden="true">
            {action.icon}
          </span>
          {action.label}
        </a>
      ))}
    </nav>
  )
}

export async function OverviewView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const user = studioUser(req)
  const now = Date.now()
  const firstName = user?.firstName || 'there'

  if (user?.role !== 'admin') return <InstructorOverview props={props} firstName={firstName} />

  if (param(props.searchParams?.refresh) === '1') invalidate()
  const window = await getWindowState(req).catch(() => null)
  const range = periodRange(parsePeriod(param(props.searchParams?.period)), now, window?.opensAt)
  const school = param(props.searchParams?.school)
  const admissions = await getAdmissions(req, range).catch(() => null)
  const queue = admissions?.queue
  const closingSoon = window?.isOpen && window.closesAt ? new Date(window.closesAt).getTime() - now < 48 * 3_600_000 : false

  return (
    <StudioPage bare props={props} title="Overview" eyebrow="SkillsAir Studio" className="sa-overview">
      <section className="sa-hero" aria-label="Today">
        <AdirePattern className="sa-hero__pattern" id="sa-adire-hero" dotOpacity={0.35} />
        <div className="sa-hero__intro">
          <p className="sa-hero__greeting">
            {greeting(now)}, {firstName}
          </p>
          <p className="sa-hero__date">{formatLongDate(now)}</p>
          <a className="sa-button sa-button--primary sa-hero__cta" href="/admin/queue">
            Open Imisi’s queue{queue ? ` (${queue.waiting} waiting)` : ''}
          </a>
          {queue?.waiting && queue.oldestSince ? <p className="sa-hero__note">Oldest waiting {formatDuration(now - new Date(queue.oldestSince).getTime())}</p> : null}
        </div>
        <div className={`sa-window${window?.isOpen ? ' sa-window--open' : ''}`}>
          <p className="sa-window__state">
            {closingSoon ? <span className="sa-window__pulse" aria-hidden="true" /> : null}
            <span>Scholarship window {window?.isOpen ? 'open' : 'closed'}</span>
          </p>
          {window?.isOpen && window.closesAt ? (
            <>
              <Countdown to={window.closesAt} initialNow={now} />
              <p className="sa-window__meta">
                Closes {formatDay(window.closesAt)} at {formatClock(window.closesAt)} WAT{window.cohortLabel ? ` · ${window.cohortLabel}` : ''}
              </p>
            </>
          ) : (
            <p className="sa-window__meta">New learners pay the standard fee until a window opens.{window?.opensAt && new Date(window.opensAt).getTime() > now ? ` Next window opens ${formatWhen(window.opensAt, now)}.` : ''}</p>
          )}
          <a className="sa-window__manage" href="/admin/globals/scholarship-window">
            Manage window
          </a>
        </div>
      </section>

      <div className="sa-overview__bar">
        <nav className="sa-segmented" aria-label="Period">
          {PERIODS.map((p) => (
            <a key={p.key} href={`/admin?period=${p.key}`} aria-current={p.key === range.key ? 'page' : undefined}>
              {p.label}
            </a>
          ))}
        </nav>
        <p className="sa-overview__updated">
          Updated {formatClock(now)} ·{' '}
          <a className="sa-link" href={`/admin?period=${range.key}&refresh=1`}>
            <RefreshCw size={13} strokeWidth={2} aria-hidden /> Refresh
          </a>
        </p>
      </div>

      <KpiRow req={req} range={range} />

      <AmbassadorOverview req={req} />

      <div className="sa-overview__grid">
        <AdmissionsFunnelPanel req={req} range={range} school={school} />
        <NeedsAttentionPanel req={req} range={range} />
        <RevenuePanel req={req} range={range} />
        <SchoolsPanel req={req} range={range} />
        <TopProgrammesPanel req={req} range={range} />
        <LearningHealthPanel req={req} range={range} />
        <ActivityPanel req={req} />
      </div>

      <QuickActions admin />
    </StudioPage>
  )
}

async function InstructorOverview({ props, firstName }: { props: AdminViewServerProps; firstName: string }) {
  const req = props.initPageResult.req
  const user = studioUser(req)
  const now = Date.now()
  if (user?.role !== 'instructor') {
    // Learners (and anyone else) never see Studio data.
    return (
      <StudioPage bare props={props} title="Overview">
        <Card>
          <EmptyState icon={<BookOpen size={22} strokeWidth={1.75} />} title="Not available for your role" action={{ href: '/', label: 'Go to the SkillsAir website' }}>
            Studio is for the SkillsAir team.
          </EmptyState>
        </Card>
      </StudioPage>
    )
  }
  const data = await getInstructorOverview(req).catch(() => null)
  return (
    <StudioPage bare props={props} title={`${greeting(now)}, ${firstName}`} eyebrow={formatLongDate(now)} intro="Your programmes and the learners who could use a nudge.">
      <section aria-labelledby="my-programmes" className="sa-overview__section">
        <h2 id="my-programmes" className="sa-section-title">
          My programmes
        </h2>
        {!data ? (
          <Card>
            <EmptyState icon={<BookOpen size={22} strokeWidth={1.75} />} title="Couldn’t load your programmes">
              Refresh the page to try again.
            </EmptyState>
          </Card>
        ) : data.programmes.length ? (
          <div className="sa-programme-cards">
            {data.programmes.map((p) => (
              <a key={p.id} className="sa-programme-card" href={`/admin/collections/courses/${p.id}`}>
                <span className="sa-programme-card__head">
                  <span className="sa-programme-card__title">{p.title}</span>
                  <StatusPill tone={p.status === 'published' ? 'positive' : 'neutral'}>{p.status === 'published' ? 'Published' : 'Draft'}</StatusPill>
                </span>
                <span className="sa-programme-card__stats">
                  <span>
                    <strong>{p.learners}</strong> learners
                  </span>
                  <span>
                    <strong>{p.averageQuizScore === null ? '–' : `${p.averageQuizScore}%`}</strong> avg quiz
                  </span>
                  <span className="sa-muted">Updated {formatWhen(p.updatedAt, now)}</span>
                </span>
                <span className="sa-programme-card__progress">
                  <ProgressRing value={(p.completionRate ?? 0) * 100} label="Completion" size={36} />
                  <span className="sa-muted">{formatPercent(p.completionRate)} completed</span>
                </span>
              </a>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState icon={<BookOpen size={22} strokeWidth={1.75} />} title="No programmes assigned to you yet" action={{ href: '/admin/collections/courses', label: 'See all programmes' }}>
              Ask an admin to set you as the instructor on a programme.
            </EmptyState>
          </Card>
        )}
      </section>

      <Card className="sa-overview__section">
        <CardHeader eyebrow="Inactive 10+ days" title="Learners needing help" />
        {data?.needingHelp.length ? (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th scope="col">Learner</th>
                  <th scope="col">Programme</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Last learning</th>
                </tr>
              </thead>
              <tbody>
                {data.needingHelp.map((h) => (
                  <tr key={h.enrollmentId}>
                    <td>{h.learner}</td>
                    <td>{h.programme}</td>
                    <td style={{ minWidth: 120 }}>
                      <ProgressBar value={h.progress} label={`${h.learner} progress`} />
                    </td>
                    <td>{h.lastLearningAt ? formatWhen(h.lastLearningAt, now) : 'Not started'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<BookOpen size={22} strokeWidth={1.75} />} title="Everyone is moving">
            No learner in your programmes has been inactive for 10 days.
          </EmptyState>
        )}
      </Card>

      <QuickActions admin={false} />
    </StudioPage>
  )
}
