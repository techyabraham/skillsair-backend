/**
 * Assessment rules (pure functions, unit-tested in assessments.test.ts): drawing questions,
 * shuffling, scoring and attempt/cooldown limits. The database side is in assessment-service.ts.
 */

export type QuizKind = 'knowledge_check' | 'chapter' | 'final_exam'
export type QuestionType = 'single' | 'multiple' | 'true_false'

export interface PoolQuestion {
  id: number
  sectionId: number | null
}

export interface ScoredQuestion {
  id: number
  type: QuestionType
  sectionId: number | null
  optionCount: number
  correctIndexes: number[]
}

/** Random numbers in [0, 1); injectable so tests are repeatable. */
export type Random = () => number

/** Deterministic generator for tests (mulberry32). */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffled<T>(items: T[], random: Random = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = out[i] as T
    out[i] = out[j] as T
    out[j] = swap
  }
  return out
}

/**
 * How many questions to take from each chapter: proportional to chapter length, at least
 * `minPerSection` each (capped by what the chapter has), totalling `total` where the pool allows.
 */
export function allocateByWeight(sections: Array<{ id: number; weight: number; available: number }>, total: number, minPerSection = 2): Map<number, number> {
  const usable = sections.filter((section) => section.available > 0)
  const counts = new Map<number, number>()
  const capacity = usable.reduce((sum, section) => sum + section.available, 0)
  const target = Math.min(total, capacity)
  // Minimums first.
  let assigned = 0
  for (const section of usable) {
    const take = Math.min(minPerSection, section.available)
    counts.set(section.id, take)
    assigned += take
  }
  if (assigned > target) {
    // More chapters than the draw allows two each: trim the shortest chapters first.
    for (const section of [...usable].sort((a, b) => a.weight - b.weight)) {
      while (assigned > target && (counts.get(section.id) ?? 0) > 1) { counts.set(section.id, (counts.get(section.id) ?? 0) - 1); assigned-- }
    }
    return counts
  }
  // The rest in proportion to weight (largest remainder), never beyond what a chapter has.
  let remaining = target - assigned
  while (remaining > 0) {
    const open = usable.filter((section) => (counts.get(section.id) ?? 0) < section.available)
    if (!open.length) break
    const weightSum = open.reduce((sum, section) => sum + Math.max(section.weight, 1), 0)
    const shares = open.map((section) => {
      const exact = (remaining * Math.max(section.weight, 1)) / weightSum
      return { section, whole: Math.floor(exact), fraction: exact - Math.floor(exact) }
    })
    let given = 0
    for (const share of shares) {
      const room = share.section.available - (counts.get(share.section.id) ?? 0)
      const add = Math.min(share.whole, room)
      if (add > 0) { counts.set(share.section.id, (counts.get(share.section.id) ?? 0) + add); given += add }
    }
    if (given === 0) {
      for (const share of shares.sort((a, b) => b.fraction - a.fraction || b.section.weight - a.section.weight)) {
        if (given >= remaining) break
        if ((counts.get(share.section.id) ?? 0) < share.section.available) { counts.set(share.section.id, (counts.get(share.section.id) ?? 0) + 1); given++ }
      }
    }
    remaining -= given
    if (given === 0) break
  }
  return counts
}

/**
 * Draws an attempt's questions. Without `sectionWeights` it's a plain random sample of `count`;
 * with them (final exam) it's weighted by chapter length with at least 2 per chapter. No repeats.
 */
export function drawQuestions(pool: PoolQuestion[], count: number | null, options: { random?: Random; shuffle?: boolean; sectionWeights?: Map<number, number>; minPerSection?: number } = {}): number[] {
  const random = options.random ?? Math.random
  const unique = [...new Map(pool.map((question) => [question.id, question])).values()]
  const take = count && count > 0 ? Math.min(count, unique.length) : unique.length
  let picked: PoolQuestion[]
  if (options.sectionWeights && options.sectionWeights.size) {
    const bySection = new Map<number, PoolQuestion[]>()
    for (const question of unique) {
      const key = question.sectionId ?? -1
      bySection.set(key, [...(bySection.get(key) ?? []), question])
    }
    const allocation = allocateByWeight(
      [...bySection.entries()].map(([id, questions]) => ({ id, weight: options.sectionWeights?.get(id) ?? 1, available: questions.length })),
      take,
      options.minPerSection ?? 2,
    )
    picked = []
    for (const [sectionId, questions] of bySection) picked.push(...shuffled(questions, random).slice(0, allocation.get(sectionId) ?? 0))
  } else {
    picked = shuffled(unique, random).slice(0, take)
  }
  const ids = picked.map((question) => question.id)
  return options.shuffle === false ? ids.sort((a, b) => a - b) : shuffled(ids, random)
}

/** Display order of a question's options: position i shows original option order[i]. */
export function optionOrder(optionCount: number, random: Random = Math.random, shuffle = true): number[] {
  const order = Array.from({ length: optionCount }, (_, index) => index)
  return shuffle ? shuffled(order, random) : order
}

/** Displayed answer positions -> original option indexes. */
export function toOriginalIndexes(displayed: number[], order: number[] | undefined): number[] {
  return [...new Set(displayed.map((position) => (order ? order[position] : position)).filter((index): index is number => typeof index === 'number'))]
}

/** Original indexes -> displayed positions (for showing the right answers after a chapter quiz). */
export function toDisplayedIndexes(original: number[], order: number[] | undefined): number[] {
  return original.map((index) => (order ? order.indexOf(index) : index)).filter((position) => position >= 0).sort((a, b) => a - b)
}

/** Right only when exactly the correct options are chosen (single, true/false and multiple alike). */
export function isCorrect(question: Pick<ScoredQuestion, 'correctIndexes'>, chosenOriginal: number[]): boolean {
  const correct = new Set(question.correctIndexes)
  const chosen = new Set(chosenOriginal)
  return correct.size > 0 && correct.size === chosen.size && [...correct].every((index) => chosen.has(index))
}

export interface ScoreResult {
  score: number
  correctCount: number
  total: number
  results: Array<{ questionId: number; correct: boolean; sectionId: number | null }>
  perSection: Array<{ sectionId: number | null; correct: number; total: number; percent: number }>
}

/** Scores served questions against the learner's answers (answers keyed by question id, displayed positions). */
export function scoreAttempt(served: ScoredQuestion[], answers: Record<string, number[]>, optionOrders: Record<string, number[]>): ScoreResult {
  const results = served.map((question) => {
    const chosen = toOriginalIndexes(answers[String(question.id)] ?? [], optionOrders[String(question.id)])
    return { questionId: question.id, correct: isCorrect(question, chosen), sectionId: question.sectionId }
  })
  const correctCount = results.filter((result) => result.correct).length
  const total = served.length
  const sections = new Map<string, { sectionId: number | null; correct: number; total: number }>()
  for (const result of results) {
    const key = String(result.sectionId)
    const entry = sections.get(key) ?? { sectionId: result.sectionId, correct: 0, total: 0 }
    entry.total++
    if (result.correct) entry.correct++
    sections.set(key, entry)
  }
  return {
    score: total ? Math.round((correctCount * 100) / total) : 0,
    correctCount,
    total,
    results,
    perSection: [...sections.values()].map((entry) => ({ ...entry, percent: entry.total ? Math.round((entry.correct * 100) / entry.total) : 0 })),
  }
}

export interface AttemptRecord {
  passed: boolean
  /** When it ended (submitted or expired). */
  endedAt: number
}

export interface AttemptAllowance {
  allowed: boolean
  /** Attempts left before the next cooldown (null = unlimited). */
  attemptsLeft: number | null
  /** When a new attempt opens, if in a cooldown. */
  opensAt: number | null
  alreadyPassed: boolean
}

/**
 * Blocks of `maxAttempts` failed attempts, each followed by `cooldownHours` before the next block
 * (chapter quiz: 3 then 10 minutes; final exam: 3 then 48 hours). Unlimited when maxAttempts is null.
 */
export function attemptAllowance(previous: AttemptRecord[], rules: { maxAttempts: number | null; cooldownHours: number | null }, now = Date.now()): AttemptAllowance {
  const alreadyPassed = previous.some((attempt) => attempt.passed)
  const fails = previous.filter((attempt) => !attempt.passed).sort((a, b) => a.endedAt - b.endedAt)
  if (!rules.maxAttempts) return { allowed: true, attemptsLeft: null, opensAt: null, alreadyPassed }
  const used = fails.length % rules.maxAttempts
  if (fails.length > 0 && used === 0) {
    const last = fails[fails.length - 1]?.endedAt ?? now
    const opensAt = last + (rules.cooldownHours ?? 0) * 3_600_000
    if (opensAt > now) return { allowed: false, attemptsLeft: 0, opensAt, alreadyPassed }
    return { allowed: true, attemptsLeft: rules.maxAttempts, opensAt: null, alreadyPassed }
  }
  return { allowed: true, attemptsLeft: rules.maxAttempts - used, opensAt: null, alreadyPassed }
}

/** When a timed attempt ends: the time limit times the learner's extra-time multiplier. */
export function attemptExpiry(startedAt: number, timeLimitMinutes: number | null, multiplier = 1): number | null {
  if (!timeLimitMinutes) return null
  return startedAt + Math.round(timeLimitMinutes * Math.max(1, multiplier) * 60_000)
}

/** Default settings per kind (overridable per quiz and through EXAM_DEFAULTS). */
export const KIND_DEFAULTS: Record<QuizKind, { drawCount: number | null; timeLimitMinutes: number | null; maxAttempts: number | null; cooldownHours: number | null; passingScore: number }> = {
  knowledge_check: { drawCount: 3, timeLimitMinutes: null, maxAttempts: null, cooldownHours: null, passingScore: 0 },
  chapter: { drawCount: 10, timeLimitMinutes: null, maxAttempts: 3, cooldownHours: 10 / 60, passingScore: 70 },
  final_exam: { drawCount: 40, timeLimitMinutes: 60, maxAttempts: 3, cooldownHours: 48, passingScore: 70 },
}

/** Final exam size: 40 questions in 60 minutes, or 30 in 45 for programmes under 15 hours. */
export function examSize(totalSeconds: number): { drawCount: number; timeLimitMinutes: number } {
  return totalSeconds > 0 && totalSeconds < 15 * 3600 ? { drawCount: 30, timeLimitMinutes: 45 } : { drawCount: 40, timeLimitMinutes: 60 }
}

/** Optional overrides from EXAM_DEFAULTS (JSON), e.g. {"final_exam":{"drawCount":35}}. */
export function kindDefaults(kind: QuizKind): (typeof KIND_DEFAULTS)[QuizKind] {
  try {
    const overrides = JSON.parse(process.env.EXAM_DEFAULTS ?? '{}') as Partial<Record<QuizKind, Partial<(typeof KIND_DEFAULTS)[QuizKind]>>>
    return { ...KIND_DEFAULTS[kind], ...(overrides[kind] ?? {}) }
  } catch {
    return KIND_DEFAULTS[kind]
  }
}
