/**
 * /admin/studio-kit (hidden, admin only): every Studio component in every state (normal,
 * loading, empty, error) for design review and screenshots. Uses clearly labelled sample
 * values; it reads nothing from the database.
 */
import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { Award, Inbox, Receipt, UserPlus, XCircle } from 'lucide-react'
import { NotAvailable, StudioPage } from '../ui/StudioPage'
import { isAdmin } from '../data/auth'
import { Avatar, Callout, Card, CardHeader, ChatBubbles, EmptyState, InfoTip, MaskedPhone, Money, ProgressBar, ProgressRing, Skeleton, StatusPill, Timeline } from '../ui/primitives'
import { CHART_COLOURS, ColumnChart, Donut, Funnel, HBarChart, LineChart, Sparkline } from '../ui/charts'
import { StatCard } from '../ui/StatCard'
import { Countdown, RelativeTime, Tabs } from '../ui/client'
import { EntityIcon } from '../ui/icons'
import { formatNaira } from '../format'

const SPARK = [3, 5, 4, 8, 6, 9, 7, 11, 10, 14, 12, 13, 17, 16]

export async function StudioKitView(props: AdminViewServerProps) {
  if (!isAdmin(props.initPageResult.req)) return <NotAvailable props={props} title="Studio kit" />
  const now = Date.now()
  const days = Array.from({ length: 14 }, (_, i) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(now - (13 - i) * 86_400_000))

  return (
    <StudioPage props={props} title="Studio kit" eyebrow="Design system · sample data only" icon="overview" intro="Every Studio component in each state. Nothing on this page is real data.">
      <div className="sa-kit">
        <Card>
          <CardHeader eyebrow="Stat cards" title="Normal, attention, loading" />
          <div className="sa-kit__grid">
            <StatCard label="Applicants" value="128" delta={{ current: 128, previous: 101, periodLabel: 'last 7 days' }} spark={SPARK} href="#" tooltip="People who applied in this period." icon={<EntityIcon slug="leads" size={16} />} />
            <StatCard label="MRR" value={<Money amount={1_240_000} compact />} delta={{ current: 1_240_000, previous: 1_300_000, periodLabel: 'last 7 days' }} spark={[...SPARK].reverse()} href="#" tooltip="Monthly recurring revenue." />
            <StatCard label="Needs attention" value="4" tone="attention" goodWhen="down" delta={{ current: 4, previous: 2, periodLabel: 'last 7 days' }} href="#" />
            <StatCard label="Conversion to paid" loading />
          </div>
        </Card>

        <Card>
          <CardHeader eyebrow="Status" title="Pills, avatars, money, phone" action={<InfoTip text="Status is always colour plus words plus an icon shape." />} />
          <div className="sa-kit__row">
            <StatusPill tone="positive">Paid</StatusPill>
            <StatusPill tone="caution">Pending</StatusPill>
            <StatusPill tone="critical">Failed</StatusPill>
            <StatusPill tone="info">Offer viewed</StatusPill>
            <StatusPill tone="neutral">Refunded</StatusPill>
            <StatusPill tone="accent">Needs reply</StatusPill>
          </div>
          <div className="sa-kit__row" style={{ marginTop: 16 }}>
            {['Ada Obi', 'Tunde Bakare', 'Imisi A.', 'Chidi Okafor', 'Fatima Bello', 'Grace Grad'].map((name) => (
              <Avatar key={name} name={name} />
            ))}
            <Money amount={2000} /> <Money amount={40_000} /> <Money amount={1_200_000} compact />
            <MaskedPhone phone="+2348181236524" />
            <MaskedPhone phone="+2348181236524" reveal />
          </div>
        </Card>

        <div className="sa-kit__grid">
          <Card>
            <CardHeader eyebrow="Progress" title="Bars and rings" />
            <div style={{ display: 'grid', gap: 12 }}>
              <ProgressBar value={72} label="Data Analysis progress" />
              <ProgressBar value={35} label="Completion" tone="positive" />
              <div className="sa-kit__row">
                <ProgressRing value={100} label="Ready to publish" />
                <ProgressRing value={71} label="Ready to publish" />
                <ProgressRing value={29} label="Ready to publish" />
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader eyebrow="Time" title="Countdown and relative time" />
            <p style={{ margin: 0 }}>
              <Countdown to={new Date(now + 3 * 86_400_000 + 4 * 3_600_000).toISOString()} initialNow={now} />
            </p>
            <p className="sa-muted" style={{ margin: '12px 0 0' }}>
              Updated <RelativeTime at={new Date(now - 25 * 60_000).toISOString()} initialNow={now} />
            </p>
          </Card>
          <Card>
            <CardHeader eyebrow="Loading" title="Skeletons" />
            <div style={{ display: 'grid', gap: 10 }}>
              <Skeleton width="40%" height={28} />
              <Skeleton />
              <Skeleton width="80%" />
            </div>
          </Card>
        </div>

        <div className="sa-kit__grid">
          <Callout tone="info" title="Dry-run is ON">
            Lifecycle emails are recorded but not sent.
          </Callout>
          <Callout tone="caution" title="Don’t extend an announced window">
            Close windows when announced.
          </Callout>
          <Callout tone="critical" title="Couldn’t load revenue">
            The database didn’t answer. Refresh to try again.
          </Callout>
        </div>

        <div className="sa-kit__grid">
          <Card>
            <CardHeader eyebrow="Charts" title="Admissions funnel" />
            <Funnel
              title="Admissions funnel (sample)"
              steps={[
                { label: 'Applicants', value: 128, href: '#' },
                { label: 'Offer viewed', value: 84, href: '#' },
                { label: 'Account created', value: 41, href: '#' },
                { label: 'Paid', value: 23, href: '#' },
              ]}
            />
          </Card>
          <Card>
            <CardHeader eyebrow="Charts" title="Applicants by school" />
            <HBarChart
              title="Applicants by school (sample)"
              data={[
                { label: 'Data', value: 41, href: '#' },
                { label: 'Security', value: 33, href: '#' },
                { label: 'Engineering', value: 27, href: '#' },
                { label: 'Smartphone Creators', value: 18, href: '#' },
                { label: 'Design', value: 9, href: '#' },
              ]}
            />
          </Card>
        </div>

        <Card>
          <CardHeader eyebrow="Charts" title="Revenue over time" />
          <ColumnChart
            title="Revenue per day (sample)"
            labels={days}
            series={[
              { key: 'subscription', label: 'Subscriptions', colour: CHART_COLOURS[0]! },
              { key: 'certificate', label: 'Certificates', colour: CHART_COLOURS[1]! },
              { key: 'course', label: 'One-off', colour: CHART_COLOURS[2]! },
            ]}
            values={{
              subscription: SPARK.map((v) => v * 2000),
              certificate: SPARK.map((v, i) => (i % 3 === 0 ? 10_000 : 0)),
              course: SPARK.map((v, i) => (i % 5 === 0 ? 100_000 : 0)),
            }}
            line={{ label: 'MRR', values: SPARK.map((v) => 40_000 + v * 4000), colour: 'var(--sa-ink)' }}
            format={(v) => formatNaira(v, { compact: true })}
            lineFormat={(v) => formatNaira(v, { compact: true })}
          />
        </Card>

        <div className="sa-kit__grid">
          <Card>
            <CardHeader eyebrow="Charts" title="Enrolment status" />
            <Donut
              title="Enrolment status (sample)"
              centreLabel="enrolments"
              data={[
                { label: 'Active', value: 214, colour: CHART_COLOURS[0]! },
                { label: 'Completed', value: 61, colour: CHART_COLOURS[2]! },
                { label: 'Refunded', value: 4, colour: CHART_COLOURS[5]! },
              ]}
            />
          </Card>
          <Card>
            <CardHeader eyebrow="Charts" title="Line and sparkline" />
            <LineChart title="MRR (sample)" labels={days} values={SPARK.map((v) => v * 3000)} format={(v) => formatNaira(v, { compact: true })} />
            <div className="sa-kit__row">
              <Sparkline values={SPARK} />
              <Sparkline values={SPARK} tone="info" />
              <Sparkline values={[...SPARK].reverse()} tone="critical" />
            </div>
          </Card>
        </div>

        <div className="sa-kit__grid">
          <Card>
            <CardHeader eyebrow="Feed" title="Timeline" />
            <Timeline
              now={now}
              items={[
                { id: '1', icon: <UserPlus size={16} />, title: 'Ada Obi applied', meta: 'Data Analysis', at: now - 5 * 60_000, tone: 'info', href: '#' },
                { id: '2', icon: <Receipt size={16} />, title: 'Tunde paid ₦2,000', meta: 'Cyber Security', at: now - 3 * 3_600_000, tone: 'positive', href: '#' },
                { id: '3', icon: <Award size={16} />, title: 'Grace bought a certificate', meta: 'UI/UX Design', at: now - 26 * 3_600_000, tone: 'accent', href: '#' },
                { id: '4', icon: <XCircle size={16} />, title: 'Chidi cancelled', meta: 'Frontend', at: now - 4 * 86_400_000, tone: 'neutral' },
              ]}
            />
          </Card>
          <Card>
            <CardHeader eyebrow="WhatsApp" title="Chat bubbles" />
            <ChatBubbles
              now={now}
              messages={[
                { direction: 'out', template: 'apply_welcome', at: new Date(now - 2 * 3_600_000).toISOString() },
                { direction: 'in', body: 'Hi, can I do the course with only my phone?', at: new Date(now - 90 * 60_000).toISOString() },
                { direction: 'out', body: 'Yes, Smartphone Creators is built for phones. Data Analysis needs a laptop for the projects.', at: new Date(now - 80 * 60_000).toISOString() },
              ]}
            />
          </Card>
        </div>

        <Card>
          <CardHeader eyebrow="Tabs" title="Accessible tabs" />
          <Tabs
            label="Sample tabs"
            tabs={[
              { id: 'one', label: 'Overview', content: <p style={{ margin: 0 }}>Arrow keys move between tabs; Home and End jump.</p> },
              { id: 'two', label: 'Conversation', content: <p style={{ margin: 0 }}>Second panel.</p> },
              { id: 'three', label: 'Details', content: <p style={{ margin: 0 }}>Third panel.</p> },
            ]}
          />
        </Card>

        <div className="sa-kit__grid">
          <Card>
            <EmptyState icon={<Inbox size={22} strokeWidth={1.75} />} title="No applicants yet this period" action={{ href: '#', label: 'Share your Apply link' }}>
              New applications appear here as they arrive.
            </EmptyState>
          </Card>
          <Card>
            <CardHeader eyebrow="Error state" title="Revenue over time" />
            <Callout tone="critical" title="This panel couldn’t load">
              Refresh the page. If it keeps happening, check the database connection.
            </Callout>
          </Card>
        </div>
      </div>
    </StudioPage>
  )
}
