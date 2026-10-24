/**
 * /admin/question-bank: one programme's questions, chapter by chapter (Learning Quality brief §6).
 * Chapter rows show approved / draft / still needed for the 12-question chapter quiz; cards show the
 * correct answer highlighted, the explanation and the source lesson. Edit, Approve and Retire run
 * in QuestionBankClient (keyboard: J/K move, E edit, A approve, R retire). Admins and instructors.
 */
import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { HelpCircle } from 'lucide-react'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { Callout, Card, CardHeader, EmptyState, StatusPill } from '../../ui/primitives'
import { isAdmin, isStaff } from '../../data/auth'
import { questionBank, type QuestionBank } from '../../data/learning'
import { queueStatus } from '../../../lib/work-queue'
import { formatNumber } from '../../format'
import { QuestionBankClient, RetryTaskButton } from './QuestionBankClient'

const param = (value: unknown): string => (Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : '')

export async function QuestionBankView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!isStaff(req)) return <NotAvailable props={props} title="Question bank" />
  const search = (props.searchParams ?? {}) as Record<string, unknown>
  const courses = (await req.payload.find({ collection: 'courses', sort: 'title', limit: 200, depth: 0, overrideAccess: true, select: { title: true } as never })).docs as unknown as Array<{ id: number; title: string }>
  const selected = Number(param(search.course)) || courses[0]?.id
  const filter = param(search.filter) === 'flagged' ? 'flagged' : param(search.filter) === 'draft' ? 'draft' : 'all'
  const chapter = Number(param(search.chapter)) || null
  let bank: QuestionBank | null = null
  if (selected) {
    try {
      bank = await questionBank(req.payload, selected)
    } catch {
      bank = null
    }
  }
  const tasks = isAdmin(req) ? await queueStatus() : null
  const visible = (bank?.questions ?? []).filter((q) => q.status !== 'retired' || filter === 'all').filter((q) => (filter === 'flagged' ? q.flags.length > 0 : filter === 'draft' ? q.status === 'draft' : true)).filter((q) => (chapter ? q.sectionId === chapter : true))
  const link = (next: Record<string, string | number | null>) => {
    const query = new URLSearchParams()
    const merged = { course: selected ?? null, filter: filter === 'all' ? null : filter, chapter, ...next }
    for (const [key, value] of Object.entries(merged)) if (value !== null && value !== '') query.set(key, String(value))
    return `/admin/question-bank?${query.toString()}`
  }

  return (
    <StudioPage
      props={props}
      title="Question bank"
      icon="quiz-questions"
      eyebrow="Learning quality"
      intro="Every question with its correct answer and explanation. Learners never see these answers before they submit."
    >
      <div className="sa-qbank">
        <form className="sa-qbank__filters" method="get" action="/admin/question-bank">
          <label>
            <span>Programme</span>
            <select name="course" defaultValue={selected ? String(selected) : ''}>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Show</span>
            <select name="filter" defaultValue={filter}>
              <option value="all">All questions</option>
              <option value="flagged">Flagged by item analysis</option>
              <option value="draft">Drafts</option>
            </select>
          </label>
          <button type="submit" className="sa-button sa-button--secondary sa-button--sm">
            Show
          </button>
        </form>

        {!bank ? (
          <Callout tone="critical" title="The question bank couldn’t be loaded">
            Refresh to try again.
          </Callout>
        ) : (
          <>
            {bank.checks.length ? (
              <Callout tone="caution" title="Before publishing quizzes">
                <ul className="sa-qbank__checks">
                  {bank.checks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}

            <Card>
              <CardHeader eyebrow={bank.course.title} title="Chapters" />
              {bank.chapters.length ? (
                <div className="sa-table-wrap">
                  <table className="sa-table">
                    <caption className="sa-visually-hidden">Questions by chapter</caption>
                    <thead>
                      <tr>
                        <th scope="col">Chapter</th>
                        <th scope="col" className="sa-right">Approved</th>
                        <th scope="col" className="sa-right">Draft</th>
                        <th scope="col" className="sa-right">Exam pool</th>
                        <th scope="col">Chapter quiz</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bank.chapters.map((row) => (
                        <tr key={row.id} aria-current={chapter === row.id ? 'true' : undefined}>
                          <th scope="row">
                            <a href={link({ chapter: chapter === row.id ? null : row.id })}>
                              {row.order}. {row.title}
                            </a>
                          </th>
                          <td className="sa-right">{formatNumber(row.approved)}</td>
                          <td className="sa-right">{formatNumber(row.draft)}</td>
                          <td className="sa-right">{formatNumber(row.examPool)}</td>
                          <td>{row.chapterPool === 0 ? <span className="sa-muted">No questions</span> : row.needed ? <StatusPill tone="caution">{row.needed} more needed</StatusPill> : <StatusPill tone="positive">Ready</StatusPill>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon={<HelpCircle size={22} strokeWidth={1.75} />} title="No chapters yet">
                  Import the curriculum first, then the content pack (npm run content:import).
                </EmptyState>
              )}
            </Card>

            <Card>
              <CardHeader title={`${formatNumber(visible.length)} question${visible.length === 1 ? '' : 's'}`} action={chapter ? <a href={link({ chapter: null })}>All chapters</a> : undefined} />
              {visible.length ? (
                <QuestionBankClient questions={visible} chapters={bank.chapters.map((row) => ({ id: row.id, title: `${row.order}. ${row.title}` }))} />
              ) : (
                <EmptyState icon={<HelpCircle size={22} strokeWidth={1.75} />} title="No questions match">
                  {filter === 'flagged' ? 'Nothing is flagged. Item analysis needs 30 or more answers per question.' : 'Questions arrive from content packs (npm run content:import).'}
                </EmptyState>
              )}
            </Card>
          </>
        )}

        {tasks ? (
          <Card id="tasks">
            <CardHeader eyebrow={`${formatNumber(tasks.pending)} waiting`} title="Background tasks that failed" />
            {tasks.dead.length ? (
              <ul className="sa-qbank__tasks">
                {tasks.dead.map((task) => (
                  <li key={task.id}>
                    <span>
                      <strong>{task.type === 'captions-import' ? 'Caption import' : task.type}</strong> · {String(task.payload.slug ?? '')}
                      <span className="sa-muted"> · {task.lastError ?? 'Unknown error'}</span>
                    </span>
                    <RetryTaskButton taskId={task.id} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sa-muted">None. Failed tasks are retried 3 times before they appear here.</p>
            )}
          </Card>
        ) : null}
      </div>
    </StudioPage>
  )
}
