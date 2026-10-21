/**
 * /admin/guide (admins and instructors): a one-page how-to for SkillsAir Studio (brief 7.13):
 * publishing a programme, working the queue, reading the Overview numbers and changing the
 * scholarship window safely. Static content; no data is read.
 */
import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { BookOpen, Inbox, LayoutDashboard, Timer } from 'lucide-react'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { Callout, Card } from '../../ui/primitives'
import { isStaff, studioUser } from '../../data/auth'
import { METRIC_DEFINITIONS } from '../../data/metrics'

const DEFINITIONS: Array<[string, string]> = [
  ['Applicants', METRIC_DEFINITIONS.applicants],
  ['Conversion to paid', METRIC_DEFINITIONS.conversion],
  ['Active subscribers', METRIC_DEFINITIONS.activeSubscribers],
  ['MRR', METRIC_DEFINITIONS.mrr],
  ['Revenue', METRIC_DEFINITIONS.revenue],
  ['Needs attention', METRIC_DEFINITIONS.attention],
  ['Completions', METRIC_DEFINITIONS.completions],
  ['Inactive 10+ days', METRIC_DEFINITIONS.inactive],
]

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="sa-guide__step">
      <span className="sa-guide__n" aria-hidden="true">
        {n}
      </span>
      <div>{children}</div>
    </li>
  )
}

export function GuideView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!isStaff(req)) return <NotAvailable props={props} title="Studio guide" />
  const admin = studioUser(req)?.role === 'admin'
  return (
    <StudioPage props={props} title="Studio guide" icon="pages" eyebrow="Help" intro="The four jobs you’ll do most, step by step. Press Ctrl K (⌘K on a Mac) anywhere to search.">
      <div className="sa-guide">
        <nav className="sa-guide__toc" aria-label="On this page">
          <a href="#publish">
            <BookOpen size={16} aria-hidden /> Publish a programme
          </a>
          {admin ? (
            <>
              <a href="#queue">
                <Inbox size={16} aria-hidden /> Work Imisi’s queue
              </a>
              <a href="#numbers">
                <LayoutDashboard size={16} aria-hidden /> Read the Overview
              </a>
              <a href="#window">
                <Timer size={16} aria-hidden /> Change the scholarship window
              </a>
            </>
          ) : null}
        </nav>

        <Card id="publish">
          <h2 className="sa-guide__title">Publish a programme</h2>
          <ol className="sa-guide__steps">
            <Step n={1}>
              Open <a href="/admin/collections/courses">Programmes</a> and choose <strong>Create New</strong> (or open a draft).
            </Step>
            <Step n={2}>
              Fill in the <strong>Overview</strong> tab: title, short description, thumbnail and school. Add at least three objectives and the requirements in <strong>Outcomes</strong>.
            </Step>
            <Step n={3}>
              In <strong>Curriculum</strong>, add sections (in order), then add lessons to each section from <a href="/admin/collections/lessons/create">Lessons</a>. The outline shows what learners will see.
            </Step>
            <Step n={4}>
              Check <strong>Pricing</strong>. “What learners will see” spells out the prices in plain words.
            </Step>
            <Step n={5}>
              Watch the <strong>Ready to publish</strong> checklist in the sidebar. When everything is ticked, set Status to <strong>Published</strong> and save. Use <strong>View on site</strong> to check the page.
            </Step>
          </ol>
          <Callout tone="info" title="A scholarship plan is needed">
            The checklist asks for an active Access Scholarship plan (Revenue → Plans) so learners can pay ₦2,000 a month while a window is open.
          </Callout>
        </Card>

        {admin ? (
          <>
            <Card id="queue">
              <h2 className="sa-guide__title">Work Imisi’s queue</h2>
              <ol className="sa-guide__steps">
                <Step n={1}>
                  Open <a href="/admin/queue">Imisi’s queue</a>. The highest score is first; the card says why they’re waiting and for how long (in working hours, Mon–Sat 9–6).
                </Step>
                <Step n={2}>
                  <strong>Reply on WhatsApp</strong> works for 24 hours after their last message. Pick a suggested reply, edit the [bracketed] parts, then send. Outside that window, use <strong>Open WhatsApp app</strong> or email.
                </Step>
                <Step n={3}>
                  When the conversation is handled, press <strong>Mark done</strong>. They leave the queue and the number in the menu goes down.
                </Step>
              </ol>
              <Callout tone="caution" title="If someone replied STOP">
                The card says so and the WhatsApp buttons are hidden. Don’t message them unless they write START.
              </Callout>
            </Card>

            <Card id="numbers">
              <h2 className="sa-guide__title">Read the Overview</h2>
              <p>
                Pick a period at the top (Today, 7 days, 30 days, This window). Every number compares with the same length of time before it and opens the records behind it when you click it. Numbers refresh every minute; use <strong>Refresh</strong> for the latest.
              </p>
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <caption className="sa-visually-hidden">What each Overview number means</caption>
                  <thead>
                    <tr>
                      <th scope="col">Number</th>
                      <th scope="col">What it counts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DEFINITIONS.map(([name, text]) => (
                      <tr key={name}>
                        <th scope="row">{name}</th>
                        <td>{text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card id="window">
              <h2 className="sa-guide__title">Change the scholarship window safely</h2>
              <ol className="sa-guide__steps">
                <Step n={1}>
                  Open <a href="/admin/globals/scholarship-window">Scholarship window</a>. The panel at the top shows whether it’s open and what changes when it closes.
                </Step>
                <Step n={2}>To open a window, set the opening and closing dates, the cohort label and dates, then tick “Scholarship window is open” and save.</Step>
                <Step n={3}>Close it on the announced date. Learners who joined keep ₦2,000 a month for their programme; new learners pay the standard fee.</Step>
              </ol>
              <Callout tone="caution" title="Don’t extend an announced window">
                Once learners have been told the closing date, keep it. Open a new window later instead.
              </Callout>
            </Card>
          </>
        ) : null}
      </div>
    </StudioPage>
  )
}
