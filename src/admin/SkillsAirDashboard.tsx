import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'

type Row = Record<string, unknown> & { id: number | string }

const relation = (value: unknown): Row | undefined =>
  value && typeof value === 'object' ? value as Row : undefined

const dateLabel = (value: unknown): string => {
  if (typeof value !== 'string') return 'Recently'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Recently' : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date)
}

function Icon({ name }: { name: 'book' | 'users' | 'activity' | 'chart' | 'arrow' | 'plus' | 'spark' }) {
  const paths: Record<typeof name, React.ReactNode> = {
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z" /><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h8M8 10h6" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
    chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-4 3 2 6-7" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></>,
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

async function count(payload: AdminViewServerProps['payload'], collection: string, where?: Record<string, unknown>) {
  const result = await payload.find({ collection: collection as never, where: where as never, limit: 1, depth: 0, overrideAccess: true })
  return result.totalDocs
}

export const SkillsAirDashboard = async (props: AdminViewServerProps) => {
  const { initPageResult } = props
  const req = initPageResult.req
  const user = req.user as (typeof req.user & { role?: string; firstName?: string }) | null
  let stats = { courses: 0, publishedCourses: 0, sections: 0, lessons: 0, students: 0, activeEnrollments: 0, completedEnrollments: 0 }
  let recent: Row[] = []
  let popular: Array<{ title: string; enrollments: number; id: string | number }> = []
  let error = false

  if (user?.role === 'admin') {
    try {
      const [courses, publishedCourses, sections, lessons, students, activeEnrollments, completedEnrollments, activity] = await Promise.all([
        count(req.payload, 'courses'),
        count(req.payload, 'courses', { status: { equals: 'published' } }),
        count(req.payload, 'sections'),
        count(req.payload, 'lessons'),
        count(req.payload, 'users', { isStudent: { equals: true } }),
        count(req.payload, 'enrollments', { status: { equals: 'active' } }),
        count(req.payload, 'enrollments', { status: { equals: 'completed' } }),
        req.payload.find({ collection: 'enrollments', sort: '-enrolledAt', limit: 100, depth: 2, overrideAccess: true }),
      ])
      stats = { courses, publishedCourses, sections, lessons, students, activeEnrollments, completedEnrollments }
      recent = activity.docs.slice(0, 6) as unknown as Row[]
      const courseCounts = new Map<string, { title: string; id: string | number; enrollments: number }>()
      for (const enrollment of activity.docs as unknown as Row[]) {
        const course = relation(enrollment.course)
        if (!course) continue
        const key = String(course.id)
        const item = courseCounts.get(key) ?? { title: String(course.title ?? 'Untitled course'), id: course.id, enrollments: 0 }
        item.enrollments += 1
        courseCounts.set(key, item)
      }
      popular = [...courseCounts.values()].sort((a, b) => b.enrollments - a.enrollments).slice(0, 4)
    } catch {
      error = true
    }
  }

  const activityTotal = stats.activeEnrollments + stats.completedEnrollments
  const completionRate = activityTotal ? Math.round((stats.completedEnrollments / activityTotal) * 100) : 0
  const greeting = user?.firstName ? `Good to see you, ${user.firstName}` : 'Your learning platform, at a glance'

  return (
    <DefaultTemplate {...props} req={req} visibleEntities={initPageResult.visibleEntities}>
      <main className={`sa-dashboard${user?.role === 'admin' ? '' : ' sa-dashboard--restricted'}`}>
        <div className="sa-dashboard__topline">
          <div>
            <p className="sa-eyebrow"><span className="sa-eyebrow__dot" /> SKILLSAIR STUDIO <span className="sa-eyebrow__divider">/</span> OVERVIEW</p>
            <h1>{greeting}</h1>
            <p className="sa-dashboard__intro">A clear picture of your courses, learners, and learning activity. <a href="/admin/lifecycle">Lifecycle emails →</a></p>
          </div>
          <a className="sa-button sa-button--primary" href="/admin/collections/courses/create"><Icon name="plus" /> Create a course</a>
        </div>

        {error && <div className="sa-notice">Some live metrics could not be loaded. Check collection permissions and database connectivity.</div>}
        {user?.role !== 'admin' && <div className="sa-notice">Platform-wide learner metrics are available to administrators.</div>}

        <section className="sa-stat-grid" aria-label="Platform summary">
          <article className="sa-stat-card sa-stat-card--ink"><div className="sa-stat-card__head"><span>Courses</span><i><Icon name="book" /></i></div><strong>{stats.courses}</strong><div className="sa-stat-card__foot"><span className="sa-stat-card__dot" /> {stats.publishedCourses} published</div></article>
          <article className="sa-stat-card"><div className="sa-stat-card__head"><span>Learners</span><i className="sa-icon--mint"><Icon name="users" /></i></div><strong>{stats.students.toLocaleString()}</strong><div className="sa-stat-card__foot">Your learning community</div></article>
          <article className="sa-stat-card"><div className="sa-stat-card__head"><span>Active enrolments</span><i className="sa-icon--blue"><Icon name="activity" /></i></div><strong>{stats.activeEnrollments.toLocaleString()}</strong><div className="sa-stat-card__foot">Currently learning</div></article>
          <article className="sa-stat-card"><div className="sa-stat-card__head"><span>Completion rate</span><i className="sa-icon--amber"><Icon name="chart" /></i></div><strong>{completionRate}<small>%</small></strong><div className="sa-progress"><span style={{ width: `${completionRate}%` }} /></div><div className="sa-stat-card__foot">{stats.completedEnrollments} courses completed</div></article>
        </section>

        <section className="sa-content-grid">
          <article className="sa-panel sa-panel--activity">
            <div className="sa-panel__header"><div><p className="sa-eyebrow">LEARNING ACTIVITY</p><h2>Enrollment mix</h2></div><a className="sa-text-link" href="/admin/collections/enrollments">View enrolments <Icon name="arrow" /></a></div>
            <div className="sa-chart" aria-label={`${stats.activeEnrollments} active and ${stats.completedEnrollments} completed enrollments`}>
              <div className="sa-chart__summary"><div><strong>{activityTotal.toLocaleString()}</strong><span>Total tracked enrolments</span></div><div className="sa-chart__legend"><span><i className="sa-legend-dot sa-legend-dot--blue" /> Active</span><span><i className="sa-legend-dot sa-legend-dot--mint" /> Completed</span></div></div>
              <div className="sa-enrollment-bars"><div className="sa-enrollment-bars__row"><span>Active</span><div><i className="sa-enrollment-bars__active" style={{ width: `${activityTotal ? stats.activeEnrollments / activityTotal * 100 : 0}%` }} /></div><strong>{stats.activeEnrollments.toLocaleString()}</strong></div><div className="sa-enrollment-bars__row"><span>Completed</span><div><i className="sa-enrollment-bars__complete" style={{ width: `${activityTotal ? stats.completedEnrollments / activityTotal * 100 : 0}%` }} /></div><strong>{stats.completedEnrollments.toLocaleString()}</strong></div></div>
              <div className="sa-chart__labels"><span>Learning structure</span><strong>{stats.sections} sections <b>·</b> {stats.lessons} lessons</strong></div>
            </div>
          </article>

          <article className="sa-panel sa-panel--popular">
            <div className="sa-panel__header"><div><p className="sa-eyebrow">COURSE LIBRARY</p><h2>Most active courses</h2></div><a className="sa-panel__round-link" href="/admin/collections/courses" aria-label="Open courses"><Icon name="arrow" /></a></div>
            {popular.length ? <div className="sa-course-list">{popular.map((course, index) => <a className="sa-course-row" href={`/admin/collections/courses/${course.id}`} key={course.id}><span className={`sa-course-row__number sa-course-row__number--${index + 1}`}>{String(index + 1).padStart(2, '0')}</span><span className="sa-course-row__title">{course.title}<small>{course.enrollments} recent enrolments</small></span><span className="sa-course-row__arrow"><Icon name="arrow" /></span></a>)}</div> : <div className="sa-empty"><span className="sa-empty__icon"><Icon name="spark" /></span><strong>Your course highlights will appear here</strong><span>Once learners enrol, the most active courses show up here.</span><a href="/admin/collections/courses/create">Create your first course <Icon name="arrow" /></a></div>}
          </article>

          <article className="sa-panel sa-panel--recent">
            <div className="sa-panel__header"><div><p className="sa-eyebrow">WHAT’S HAPPENING</p><h2>Recent enrolments</h2></div><a className="sa-text-link" href="/admin/collections/enrollments">View all <Icon name="arrow" /></a></div>
            {recent.length ? <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Learner</th><th>Course</th><th>Status</th><th>Date</th></tr></thead><tbody>{recent.map((item) => { const student = relation(item.student); const course = relation(item.course); const learnerName = [student?.firstName, student?.lastName].filter(Boolean).join(' ') || String(student?.email ?? 'Learner'); const status = String(item.status ?? 'active'); return <tr key={item.id}><td><span className="sa-avatar">{learnerName.slice(0, 1).toUpperCase()}</span><span className="sa-learner-name">{learnerName}</span></td><td>{String(course?.title ?? 'Course')}</td><td><span className={`sa-status sa-status--${status}`}>{status}</span></td><td>{dateLabel(item.enrolledAt)}</td></tr> })}</tbody></table></div> : <div className="sa-empty sa-empty--compact"><span className="sa-empty__icon"><Icon name="users" /></span><strong>No enrolments yet</strong><span>New learner activity will appear here.</span></div>}
          </article>
        </section>

        <section className="sa-quick-actions" aria-label="Quick actions"><div><p className="sa-eyebrow">QUICK ACTIONS</p><h2>Keep your academy moving</h2><p>Jump straight to the tools you use most.</p></div><a href="/admin/collections/courses/create"><i className="sa-quick-actions__icon sa-quick-actions__icon--blue"><Icon name="book" /></i><span><strong>Build a course</strong><small>Set up sections and lessons</small></span><Icon name="arrow" /></a><a href="/admin/collections/users"><i className="sa-quick-actions__icon sa-quick-actions__icon--mint"><Icon name="users" /></i><span><strong>Manage learners</strong><small>View your student community</small></span><Icon name="arrow" /></a><a href="/admin/collections/media"><i className="sa-quick-actions__icon sa-quick-actions__icon--amber"><Icon name="spark" /></i><span><strong>Organize media</strong><small>Keep course assets close</small></span><Icon name="arrow" /></a></section>
      </main>
    </DefaultTemplate>
  )
}
