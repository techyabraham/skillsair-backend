import type { SanitizedConfig } from 'payload'
import { getPayload } from 'payload'
import { jobScheduler } from './scheduler.js'
import { logger } from '../lib/logger.js'
import { retryPendingCertificates, sweepExpiredAttempts } from '../lib/assessment-service.js'
import { analyseItems, MIN_SERVED, type ItemObservation } from '../lib/item-analysis.js'
import { isCorrect, toOriginalIndexes } from '../lib/assessments.js'

const cron = jobScheduler('assessments')

/** Nightly: pValue and discrimination for every question served at least 30 times (last 12 months). */
export async function runItemAnalysis(config: Promise<SanitizedConfig> | SanitizedConfig): Promise<number> {
  const payload = await getPayload({ config })
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString()
  const attempts = await payload.find({
    collection: 'quiz-attempts',
    where: { and: [{ status: { in: ['submitted', 'expired'] } }, { submittedAt: { greater_than: since } }] },
    limit: 50_000,
    depth: 0,
    overrideAccess: true,
  })
  const docs = attempts.docs as unknown as Array<{ score?: number | null; answers?: Record<string, number[]> | null; servedQuestionIds?: number[] | null; servedOptionOrder?: Record<string, number[]> | null }>
  const ids = [...new Set(docs.flatMap((doc) => doc.servedQuestionIds ?? []))]
  const correct = new Map<number, number[]>()
  for (let i = 0; i < ids.length; i += 500) {
    const batch = await payload.find({ collection: 'quiz-questions', where: { id: { in: ids.slice(i, i + 500) } }, limit: 500, depth: 0, overrideAccess: true })
    for (const question of batch.docs as unknown as Array<{ id: number; correctIndexes?: number[] | null; correctIndex?: number | null }>) {
      const list = (question.correctIndexes ?? []).map(Number)
      correct.set(Number(question.id), list.length ? list : typeof question.correctIndex === 'number' ? [question.correctIndex] : [])
    }
  }
  const observations: ItemObservation[] = []
  for (const doc of docs) {
    for (const id of doc.servedQuestionIds ?? []) {
      const key = String(id)
      observations.push({
        questionId: Number(id),
        correct: isCorrect({ correctIndexes: correct.get(Number(id)) ?? [] }, toOriginalIndexes(doc.answers?.[key] ?? [], doc.servedOptionOrder?.[key])),
        attemptScore: Number(doc.score ?? 0),
      })
    }
  }
  let updated = 0
  for (const stats of analyseItems(observations)) {
    if (stats.served < MIN_SERVED) continue
    await payload.update({ collection: 'quiz-questions', id: stats.questionId, data: { stats: { timesServed: stats.served, pValue: stats.pValue, discrimination: stats.discrimination } } as never, overrideAccess: true })
    updated++
  }
  return updated
}

export function registerAssessmentJobs(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  // Timed attempts whose time ran out are submitted with the learner's saved answers.
  cron.schedule('* * * * *', async () => {
    const payload = await getPayload({ config })
    const closed = await sweepExpiredAttempts(payload)
    if (closed) logger.info({ closed }, 'quiz_attempts_expired')
  })
  // Passed the exam but the certificate didn't issue (storage hiccup): try again.
  cron.schedule('*/5 * * * *', async () => {
    const payload = await getPayload({ config })
    const issued = await retryPendingCertificates(payload)
    if (issued) logger.info({ issued }, 'certificates_issued_on_retry')
  })
  cron.schedule('15 3 * * *', async () => {
    const updated = await runItemAnalysis(config)
    logger.info({ updated }, 'quiz_item_analysis_done')
  }, { timezone: 'Africa/Lagos' })
}
