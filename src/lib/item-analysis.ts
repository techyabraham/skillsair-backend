/**
 * Item analysis for the question bank (pure; tested in assessments.test.ts):
 *   pValue = share of learners who answered correctly
 *   discrimination = point-biserial correlation between getting the item right and the attempt score
 * Flags (shown in Studio's "Needs attention"): p > 0.95 too easy, p < 0.25 too hard (or wrong key),
 * discrimination < 0.1 confusing. Only items served at least 30 times are judged.
 */

export const MIN_SERVED = 30

export interface ItemObservation {
  questionId: number
  correct: boolean
  /** The whole attempt's score, 0–100. */
  attemptScore: number
}

export interface ItemStats {
  questionId: number
  served: number
  pValue: number
  discrimination: number | null
}

export function analyseItems(observations: ItemObservation[]): ItemStats[] {
  const byQuestion = new Map<number, ItemObservation[]>()
  for (const observation of observations) byQuestion.set(observation.questionId, [...(byQuestion.get(observation.questionId) ?? []), observation])
  const out: ItemStats[] = []
  for (const [questionId, items] of byQuestion) {
    const n = items.length
    const right = items.filter((item) => item.correct)
    const p = right.length / n
    const mean = items.reduce((sum, item) => sum + item.attemptScore, 0) / n
    const sd = Math.sqrt(items.reduce((sum, item) => sum + (item.attemptScore - mean) ** 2, 0) / n)
    let discrimination: number | null = null
    if (sd > 0 && p > 0 && p < 1) {
      const meanRight = right.reduce((sum, item) => sum + item.attemptScore, 0) / right.length
      const wrong = items.filter((item) => !item.correct)
      const meanWrong = wrong.reduce((sum, item) => sum + item.attemptScore, 0) / wrong.length
      discrimination = ((meanRight - meanWrong) / sd) * Math.sqrt(p * (1 - p))
    }
    out.push({ questionId, served: n, pValue: Math.round(p * 1000) / 1000, discrimination: discrimination === null ? null : Math.round(discrimination * 1000) / 1000 })
  }
  return out
}

export type ItemFlag = 'too_easy' | 'too_hard' | 'confusing'

export function itemFlags(stats: { served?: number | null; timesServed?: number | null; pValue?: number | null; discrimination?: number | null }): ItemFlag[] {
  const served = Number(stats.served ?? stats.timesServed ?? 0)
  if (served < MIN_SERVED || stats.pValue === null || stats.pValue === undefined) return []
  const flags: ItemFlag[] = []
  if (stats.pValue > 0.95) flags.push('too_easy')
  if (stats.pValue < 0.25) flags.push('too_hard')
  if (stats.discrimination !== null && stats.discrimination !== undefined && stats.discrimination < 0.1) flags.push('confusing')
  return flags
}
