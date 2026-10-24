/**
 * Programme edit panels for learning quality (Learning Quality brief §6), as `ui` fields:
 * CourseLearningQuality (sidebar: copy lint, chapter quizzes, final exam pool, captions coverage,
 * with a "Re-import captions" button) and CourseContentHistory (History tab: restore earlier copy).
 * Server components; admins and instructors only.
 */
import React from 'react'
import type { UIFieldServerProps } from 'payload'
import { Check, X } from 'lucide-react'
import { ProgressBar } from '../ui/primitives'
import { isAdmin, isStaff } from '../data/auth'
import { programmeHealth } from '../data/learning'
import { CaptionsImportButton, RestoreHistoryButton } from './LearningActions'

type Props = UIFieldServerProps

function Row({ done, children, hint }: { done: boolean; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <li className={done ? 'sa-ready__item--done' : 'sa-ready__item--todo'}>
      {done ? <Check size={14} strokeWidth={2.5} aria-hidden /> : <X size={14} strokeWidth={2.5} aria-hidden />}
      <span>
        {children}
        <span className="sa-visually-hidden">{done ? ': done' : ': to do'}</span>
        {hint ? <span className="sa-learning__hint">{hint}</span> : null}
      </span>
    </li>
  )
}

export async function CourseLearningQuality(props: Props) {
  if (!isStaff(props.req) || !props.id) return null
  let health: Awaited<ReturnType<typeof programmeHealth>>
  try {
    health = await programmeHealth(props.payload, props.id)
  } catch {
    return <p className="sa-muted">Learning quality couldn’t be loaded.</p>
  }
  const driveFolder = Boolean((props.data as Record<string, unknown> | undefined)?.driveFolderId)
  const { lint, chapterQuizzes, finalExam, captions, questions } = health
  return (
    <section className="sa-ready sa-learning" aria-labelledby="sa-learning-title">
      <h3 id="sa-learning-title" className="sa-ready__title">
        Learning quality
      </h3>
      <ul className="sa-ready__list">
        <Row done={!lint.errors.length} hint={lint.errors.length ? lint.errors.slice(0, 3).map((issue) => issue.message).join(' · ') : lint.warnings.length ? `${lint.warnings.length} suggestion${lint.warnings.length === 1 ? '' : 's'}` : undefined}>
          Programme copy {lint.errors.length ? `(${lint.errors.length} error${lint.errors.length === 1 ? '' : 's'})` : 'passes the lint'}
        </Row>
        <Row done={health.chapters > 0 && !chapterQuizzes.missing.length} hint={chapterQuizzes.missing.length ? `Missing: ${chapterQuizzes.missing.slice(0, 3).join(', ')}${chapterQuizzes.missing.length > 3 ? '…' : ''}` : undefined}>
          Chapter quizzes published: {chapterQuizzes.published} of {health.chapters}
        </Row>
        {finalExam.needed ? (
          <Row done={finalExam.published && finalExam.pool >= finalExam.needed} hint={!finalExam.exists ? 'No final exam yet: certificates are issued without one.' : undefined}>
            Final exam {finalExam.published ? 'published' : finalExam.exists ? 'not published' : 'missing'} · pool {finalExam.pool} of {finalExam.needed}
          </Row>
        ) : null}
        <Row done={questions.flagged === 0}>
          {questions.approved} approved questions{questions.draft ? `, ${questions.draft} drafts` : ''}
          {questions.flagged ? `, ${questions.flagged} flagged` : ''}
        </Row>
      </ul>
      <div className="sa-learning__captions">
        <ProgressBar value={captions.percent} label="Lessons with subtitles" tone={captions.percent === 100 ? 'positive' : 'caution'} />
        <p className="sa-muted">
          {captions.withCaptions} of {captions.lessons} video lessons have subtitles
        </p>
        {captions.missing.length ? (
          <details>
            <summary>Lessons without subtitles</summary>
            <ul>
              {captions.missing.slice(0, 30).map((title) => (
                <li key={title}>{title}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {driveFolder ? <CaptionsImportButton courseId={Number(props.id)} /> : <p className="sa-muted">Import from Google Drive first to re-import captions.</p>}
      </div>
      <a className="sa-button sa-button--ghost sa-button--sm" href={`/admin/question-bank?course=${props.id}`}>
        Open the question bank
      </a>
    </section>
  )
}

export function CourseContentHistory(props: Props) {
  if (!isStaff(props.req) || !props.id) return null
  const history = ((props.data as Record<string, unknown> | undefined)?.contentHistory as Array<{ savedAt?: string; source?: string | null }> | undefined) ?? []
  if (!history.length) return <p className="sa-muted">No earlier versions yet. A copy is saved before each content import.</p>
  const canRestore = isAdmin(props.req)
  return (
    <ol className="sa-history" reversed>
      {history
        .map((entry, index) => ({ entry, index }))
        .reverse()
        .map(({ entry, index }) => (
          <li key={index} className="sa-history__item">
            <span>
              <strong>{entry.savedAt ? new Date(entry.savedAt).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown date'}</strong>
              <span className="sa-muted"> · {entry.source ?? 'saved'}</span>
            </span>
            {canRestore ? <RestoreHistoryButton courseId={Number(props.id)} index={index} /> : null}
          </li>
        ))}
    </ol>
  )
}
