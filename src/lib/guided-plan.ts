/**
 * The guided 12-week plan, pure part (no I/O, fully unit-tested in guided-plan.test.ts):
 * - planItems: a programme's curriculum as an ordered list of plan items (lessons, then each
 *   chapter quiz straight after the last lesson of its chapter);
 * - buildGuidedPlan: those items allocated to weeks;
 * - planProgress: where a learner is against their plan (current week, on track / behind...).
 *
 * The plan is guidance only: nothing here locks a lesson, quiz or exam.
 * All dates are Lagos dates (WAT, UTC+1, no daylight saving).
 */
import { createHash } from 'node:crypto'

export const DEFAULT_PLAN_WEEKS = 12
/** A lesson with no recorded duration counts as 10 minutes; every lesson adds 5 minutes of practice. */
export const DEFAULT_LESSON_MINUTES = 10
export const PRACTICE_MINUTES = 5
export const CHAPTER_QUIZ_MINUTES = 15
/** A learner may move their plan once every 14 days. */
export const PLAN_RESET_COOLDOWN_DAYS = 14

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const WAT_OFFSET = HOUR

export interface SourceLesson {
  id: number
  title: string
  /** Seconds (0 or missing: unknown). */
  duration?: number | null
  order: number
  sectionId: number
  sectionTitle: string
  sectionOrder: number
}

export interface SourceQuiz {
  id: number
  title: string
  kind: 'chapter' | 'final_exam'
  sectionId?: number | null
}

export interface PlanItem {
  type: 'lesson' | 'chapter_quiz'
  id: number
  title: string
  sectionId: number | null
  sectionTitle: string
  minutes: number
}

export interface PlanWeek {
  week: number
  minutes: number
  items: PlanItem[]
}

export interface GuidedPlan {
  weeks: number
  totalMinutes: number
  planVersion: string
  schedule: PlanWeek[]
  /** Shown in the last week (informational; it links to the existing exam page). */
  finalExam: { id: number; title: string } | null
}

export function lessonMinutes(duration: number | null | undefined): number {
  const seconds = Number(duration ?? 0)
  const watch = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : DEFAULT_LESSON_MINUTES
  return watch + PRACTICE_MINUTES
}

/**
 * Ordered plan items: every published lesson by chapter order then lesson order, each chapter
 * quiz directly after its chapter's last lesson. A chapter quiz whose chapter has no lessons
 * stays at its chapter's place. Ties are broken by id, so the order never depends on input order.
 */
export function planItems(lessons: SourceLesson[], quizzes: SourceQuiz[]): PlanItem[] {
  const chapters = new Map<number, { order: number; title: string; lessons: SourceLesson[] }>()
  for (const lesson of lessons) {
    const chapter = chapters.get(lesson.sectionId) ?? { order: lesson.sectionOrder, title: lesson.sectionTitle, lessons: [] }
    chapter.lessons.push(lesson)
    chapters.set(lesson.sectionId, chapter)
  }
  const chapterQuizzes = new Map<number, SourceQuiz>()
  const orphanQuizzes: SourceQuiz[] = []
  for (const quiz of [...quizzes].sort((a, b) => a.id - b.id)) {
    if (quiz.kind !== 'chapter') continue
    if (quiz.sectionId != null && chapters.has(quiz.sectionId)) {
      if (!chapterQuizzes.has(quiz.sectionId)) chapterQuizzes.set(quiz.sectionId, quiz)
    } else orphanQuizzes.push(quiz)
  }
  const items: PlanItem[] = []
  const ordered = [...chapters.entries()].sort(([idA, a], [idB, b]) => a.order - b.order || idA - idB)
  for (const [sectionId, chapter] of ordered) {
    for (const lesson of [...chapter.lessons].sort((a, b) => a.order - b.order || a.id - b.id)) {
      items.push({ type: 'lesson', id: lesson.id, title: lesson.title, sectionId, sectionTitle: chapter.title, minutes: lessonMinutes(lesson.duration) })
    }
    const quiz = chapterQuizzes.get(sectionId)
    if (quiz) items.push({ type: 'chapter_quiz', id: quiz.id, title: quiz.title, sectionId, sectionTitle: chapter.title, minutes: CHAPTER_QUIZ_MINUTES })
  }
  // Chapter quizzes for chapters with no published lessons go at the end, in id order.
  for (const quiz of orphanQuizzes) {
    items.push({ type: 'chapter_quiz', id: quiz.id, title: quiz.title, sectionId: quiz.sectionId ?? null, sectionTitle: '', minutes: CHAPTER_QUIZ_MINUTES })
  }
  return items
}

/** A hash of the ordered item ids and minutes: changes whenever the curriculum does. */
export function planVersion(items: PlanItem[]): string {
  const key = items.map((item) => `${item.type === 'lesson' ? 'l' : 'q'}${item.id}:${item.minutes}`).join('|')
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

/** Weeks for a programme: 12, or max(4, items) (capped at 12) for a small programme. */
export function planWeekCount(itemCount: number, weeks = DEFAULT_PLAN_WEEKS): number {
  if (itemCount >= weeks) return weeks
  return Math.min(DEFAULT_PLAN_WEEKS, Math.max(4, itemCount))
}

/** A lesson plus, when it closes a chapter, that chapter's quiz: the unit the allocator never splits. */
type Unit = PlanItem[]

function units(items: PlanItem[]): Unit[] {
  const out: Unit[] = []
  for (const item of items) {
    const previous = out[out.length - 1]
    // A chapter quiz stays with the last lesson of its chapter.
    if (item.type === 'chapter_quiz' && previous && previous[previous.length - 1]!.type === 'lesson' && previous[previous.length - 1]!.sectionId === item.sectionId) {
      previous.push(item)
    } else out.push([item])
  }
  return out
}

const unitMinutes = (unit: Unit) => unit.reduce((sum, item) => sum + item.minutes, 0)

/** Greedy pass: a new week when the next unit would pass target × 1.25 and the week holds target × 0.6. */
function greedy(list: Unit[], target: number): Unit[][] {
  const weeks: Unit[][] = []
  let current: Unit[] = []
  let minutes = 0
  const close = () => {
    if (current.length) weeks.push(current)
    current = []
    minutes = 0
  }
  for (const unit of list) {
    const size = unitMinutes(unit)
    if (size > target) {
      // A lesson longer than the target gets a week of its own.
      close()
      current = [unit]
      close()
      continue
    }
    if (current.length && minutes + size > target * 1.25 && minutes >= target * 0.6) close()
    current.push(unit)
    minutes += size
  }
  close()
  return weeks
}

/** Merges the smallest adjacent pair (lowest index on a tie) until `count` weeks remain. */
function mergeTo(weeks: Unit[][], count: number): Unit[][] {
  const out = weeks.map((week) => [...week])
  const size = (week: Unit[]) => week.reduce((sum, unit) => sum + unitMinutes(unit), 0)
  while (out.length > count) {
    let best = 0
    let bestSize = Infinity
    for (let i = 0; i < out.length - 1; i++) {
      const combined = size(out[i]!) + size(out[i + 1]!)
      if (combined < bestSize) {
        bestSize = combined
        best = i
      }
    }
    out.splice(best, 2, [...out[best]!, ...out[best + 1]!])
  }
  return out
}

/**
 * Allocates items to weeks. Deterministic: the same items always give the same plan.
 * Fewer units than weeks (a small programme): units are spread evenly and some weeks are left
 * free for catching up.
 */
export function buildGuidedPlan(items: PlanItem[], weeks = DEFAULT_PLAN_WEEKS, finalExam: { id: number; title: string } | null = null): GuidedPlan {
  const count = planWeekCount(items.length, weeks)
  const list = units(items)
  const totalMinutes = items.reduce((sum, item) => sum + item.minutes, 0)
  let allocated: Unit[][]
  if (!list.length) allocated = []
  else if (list.length <= count) {
    allocated = Array.from({ length: count }, () => [] as Unit[])
    list.forEach((unit, index) => allocated[Math.floor((index * count) / list.length)]!.push(unit))
  } else {
    // Greedy at the even target; when it ends early, stretch with smaller targets; when it
    // overflows, merge the smallest neighbours. Of the targets tried, the most even split wins
    // (so the last weeks aren't left nearly empty or overloaded). Same input, same choice.
    const even = totalMinutes / count
    const spread = (weeks: Unit[][]) => weeks.reduce((sum, week) => sum + (week.reduce((s, unit) => s + unitMinutes(unit), 0) - even) ** 2, 0)
    let best: Unit[][] | null = null
    let bestSpread = Infinity
    for (let step = 0; step <= 60; step++) {
      const candidate = greedy(list, even * (1 - step * 0.01))
      if (candidate.length < count) continue
      const merged = mergeTo(candidate, count)
      const score = spread(merged)
      if (score < bestSpread - 1e-9) {
        best = merged
        bestSpread = score
      }
    }
    if (!best) {
      // Very uneven lessons: keep shrinking until every week is used.
      let target = even * 0.4
      let candidate = greedy(list, target)
      for (let guard = 0; candidate.length < count && guard < 500; guard++) candidate = greedy(list, (target *= 0.97))
      best = mergeTo(candidate, count)
    }
    allocated = best
  }
  while (allocated.length < count) allocated.push([])
  const schedule = allocated.map((week, index) => {
    const weekItems = week.flat()
    return { week: index + 1, minutes: weekItems.reduce((sum, item) => sum + item.minutes, 0), items: weekItems }
  })
  return { weeks: count, totalMinutes, planVersion: planVersion(items), schedule, finalExam }
}

/* ------------------------------------------------------------------------ */
/* Learner progress against the plan                                        */
/* ------------------------------------------------------------------------ */

export type PlanStatus = 'finished' | 'ahead' | 'on_track' | 'behind' | 'overrun'
export type Pace = 'guided' | 'self_paced'

export interface LearnerState {
  pace: Pace
  /** Week 1 starts at Lagos midnight of this day (ms). */
  startedAt: number
  /** Completed lessons and passed chapter quizzes (and the final exam), with when (ms; null if unknown). */
  completedLessons: Map<number, number | null>
  passedQuizzes: Map<number, number | null>
  planResetAt?: number | null
}

export interface ItemProgress extends PlanItem {
  done: boolean
  week: number
}

export interface WeekProgress {
  week: number
  startsOn: string
  endsOn: string
  minutes: number
  doneCount: number
  totalCount: number
  items: ItemProgress[]
}

export interface PlanProgress {
  pace: Pace
  weeks: number
  currentWeek: number
  startedOn: string
  finishBy: string
  /** Guided only. */
  status?: PlanStatus
  weeksBehind?: number
  overdue?: ItemProgress[]
  projectedFinish?: string | null
  nextItem: ItemProgress | null
  /** The final exam, when the programme has one (done = passed). */
  finalExam: { id: number; title: string; done: boolean } | null
  plan: WeekProgress[]
  thisWeek: WeekProgress
  /** When "Move my plan" is (or becomes) available; null when it doesn't apply. */
  resetAvailableAt: string | null
  canReset: boolean
  /** Week of the first incomplete item (1 when nothing is left). */
  firstIncompleteWeek: number
  remainingItems: number
}

export function lagosMidnight(at: number): number {
  const shifted = at + WAT_OFFSET
  return shifted - (((shifted % DAY) + DAY) % DAY) - WAT_OFFSET
}

/** YYYY-MM-DD in Lagos. */
export function lagosDateKey(at: number): string {
  return new Date(at + WAT_OFFSET).toISOString().slice(0, 10)
}

const isDone = (item: PlanItem, state: LearnerState) => (item.type === 'lesson' ? state.completedLessons.has(item.id) : state.passedQuizzes.has(item.id))

/** Where the learner is against their plan at `now`. */
export function planProgress(plan: GuidedPlan, state: LearnerState, now: number): PlanProgress {
  const start = lagosMidnight(state.startedAt)
  const daysSinceStart = Math.floor((lagosMidnight(now) - start) / DAY)
  const currentWeek = Math.min(plan.weeks, Math.max(1, Math.floor(daysSinceStart / 7) + 1))
  const weeks: WeekProgress[] = plan.schedule.map((week) => {
    const items = week.items.map((item) => ({ ...item, done: isDone(item, state), week: week.week }))
    const startsAt = start + (week.week - 1) * WEEK
    return {
      week: week.week,
      startsOn: lagosDateKey(startsAt),
      endsOn: lagosDateKey(startsAt + 6 * DAY),
      minutes: week.minutes,
      doneCount: items.filter((item) => item.done).length,
      totalCount: items.length,
      items,
    }
  })
  const all = weeks.flatMap((week) => week.items)
  const remaining = all.filter((item) => !item.done)
  const finished = all.length > 0 && remaining.length === 0
  const firstIncompleteWeek = remaining[0]?.week ?? 1
  const finalExam = plan.finalExam ? { ...plan.finalExam, done: state.passedQuizzes.has(plan.finalExam.id) } : null
  const nextItem = remaining[0] ?? null
  const thisWeek = weeks[currentWeek - 1] ?? { week: currentWeek, startsOn: lagosDateKey(start), endsOn: lagosDateKey(start + 6 * DAY), minutes: 0, doneCount: 0, totalCount: 0, items: [] }
  const finishByAt = start + plan.weeks * WEEK
  const base: PlanProgress = {
    pace: state.pace,
    weeks: plan.weeks,
    currentWeek,
    startedOn: lagosDateKey(start),
    // The last day of the last week.
    finishBy: lagosDateKey(finishByAt - DAY),
    nextItem,
    finalExam,
    plan: weeks,
    thisWeek,
    resetAvailableAt: null,
    canReset: false,
    firstIncompleteWeek,
    remainingItems: remaining.length,
  }
  if (state.pace === 'self_paced') return base

  const overdue = weeks.filter((week) => week.week < currentWeek).flatMap((week) => week.items.filter((item) => !item.done))
  const weeksBehind = new Set(overdue.map((item) => item.week)).size
  const upToNow = weeks.filter((week) => week.week <= currentWeek).flatMap((week) => week.items)
  const overrun = !finished && daysSinceStart >= plan.weeks * 7
  const status: PlanStatus = finished
    ? 'finished'
    : overrun
      ? 'overrun'
      : overdue.length
        ? 'behind'
        : upToNow.length > 0 && upToNow.every((item) => item.done)
          ? 'ahead'
          : 'on_track'

  let projectedFinish: string | null | undefined
  if (status === 'behind' || status === 'overrun') {
    // Their pace over the last 14 days.
    const since = now - 14 * DAY
    const recent = [...state.completedLessons.values(), ...[...state.passedQuizzes.entries()].filter(([id]) => id !== plan.finalExam?.id).map(([, at]) => at)]
      .filter((at): at is number => typeof at === 'number' && at >= since && at <= now).length
    projectedFinish = recent > 0 ? lagosDateKey(now + Math.ceil(remaining.length / (recent / 14)) * DAY) : null
  }

  const movable = status === 'behind' || status === 'overrun'
  const resetAt = state.planResetAt ? state.planResetAt + PLAN_RESET_COOLDOWN_DAYS * DAY : null
  return {
    ...base,
    status,
    weeksBehind,
    overdue,
    ...(projectedFinish !== undefined ? { projectedFinish } : {}),
    resetAvailableAt: movable ? new Date(Math.max(now, resetAt ?? 0)).toISOString() : null,
    canReset: movable && (resetAt === null || resetAt <= now),
  }
}

/**
 * "Move my plan": the week of the first incomplete item becomes the current week.
 * Returns the new start (Lagos midnight, ms).
 */
export function movedPlanStart(firstIncompleteWeek: number, now: number): number {
  return lagosMidnight(now) - (Math.max(1, firstIncompleteWeek) - 1) * WEEK
}

/** Whole weeks, rounded down, for the backfill and resets. */
export const PLAN_WEEK_MS = WEEK
