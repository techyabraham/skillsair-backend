/**
 * The guided 12-week plan, pure part (no I/O, fully unit-tested in guided-plan.test.ts):
 * - planItems: a programme's curriculum as an ordered list of plan items (lessons, then each
 *   chapter quiz straight after the last lesson of its chapter);
 * - buildGuidedPlan: those items allocated to weeks, and each week to weekdays (Monday to Friday);
 * - planProgress: where a learner is against their plan, by day (today, ahead, behind...).
 *
 * The plan is a sequence of weekday "slots": slot s = (week - 1) × 5 + weekday. A learner's slot 0
 * is the day their plan started (planStartedAt), and each later slot is the next weekday, so
 * weekends never hold lessons. Calendar weeks run Monday to Sunday; a learner who starts on a
 * Wednesday has Monday and Tuesday of week 1 free, and "Move my plan" moves the start forward by
 * whole weekdays.
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

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const
export type DayKey = (typeof WEEKDAYS)[number]

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

export interface PlanDay {
  day: DayKey
  minutes: number
  items: PlanItem[]
}

export interface PlanWeek {
  week: number
  minutes: number
  /** The chapter most of the week's items belong to. */
  title: string
  items: PlanItem[]
  /** Always five: Monday to Friday (a day may be empty). */
  days: PlanDay[]
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
 * goes at the end. Ties are broken by id, so the order never depends on input order.
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
    // A chapter quiz stays with the last lesson of its chapter (same week, same day).
    if (item.type === 'chapter_quiz' && previous && previous[previous.length - 1]!.type === 'lesson' && previous[previous.length - 1]!.sectionId === item.sectionId) {
      previous.push(item)
    } else out.push([item])
  }
  return out
}

const unitMinutes = (unit: Unit) => unit.reduce((sum, item) => sum + item.minutes, 0)
const groupMinutes = (group: Unit[]) => group.reduce((sum, unit) => sum + unitMinutes(unit), 0)

/** Greedy pass: a new group when the next unit would pass target × 1.25 and the group holds target × 0.6. */
function greedy(list: Unit[], target: number): Unit[][] {
  const groups: Unit[][] = []
  let current: Unit[] = []
  let minutes = 0
  const close = () => {
    if (current.length) groups.push(current)
    current = []
    minutes = 0
  }
  for (const unit of list) {
    const size = unitMinutes(unit)
    if (size > target) {
      // A lesson longer than the target gets a group of its own.
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
  return groups
}

/** Merges the smallest adjacent pair (lowest index on a tie) until `count` groups remain. */
function mergeTo(groups: Unit[][], count: number): Unit[][] {
  const out = groups.map((group) => [...group])
  while (out.length > count) {
    let best = 0
    let bestSize = Infinity
    for (let i = 0; i < out.length - 1; i++) {
      const combined = groupMinutes(out[i]!) + groupMinutes(out[i + 1]!)
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
 * Exactly `count` ordered groups of units. Fewer units than groups: spread evenly, leaving some
 * groups empty. Otherwise greedy at the even target; when it ends early, smaller targets; when it
 * overflows, merge the smallest neighbours. Of the targets tried, the most even split wins.
 * Deterministic: the same input always gives the same groups.
 */
function allocate(list: Unit[], count: number): Unit[][] {
  if (!list.length) return Array.from({ length: count }, () => [])
  if (list.length <= count) {
    const out: Unit[][] = Array.from({ length: count }, () => [])
    list.forEach((unit, index) => out[Math.floor((index * count) / list.length)]!.push(unit))
    return out
  }
  const even = list.reduce((sum, unit) => sum + unitMinutes(unit), 0) / count
  const spread = (groups: Unit[][]) => groups.reduce((sum, group) => sum + (groupMinutes(group) - even) ** 2, 0)
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
    let target = even * 0.4
    let candidate = greedy(list, target)
    for (let guard = 0; candidate.length < count && guard < 500; guard++) candidate = greedy(list, (target *= 0.97))
    best = mergeTo(candidate, count)
  }
  while (best.length < count) best.push([])
  return best
}

/** The chapter most of these items belong to (first seen wins a tie). */
function majorityChapter(items: PlanItem[]): string {
  const counts = new Map<string, number>()
  for (const item of items) if (item.sectionTitle) counts.set(item.sectionTitle, (counts.get(item.sectionTitle) ?? 0) + 1)
  let title = ''
  let most = 0
  for (const [name, count] of counts) {
    if (count > most) {
      title = name
      most = count
    }
  }
  return title
}

/** Allocates items to weeks, then each week's items to Monday–Friday. */
export function buildGuidedPlan(items: PlanItem[], weeks = DEFAULT_PLAN_WEEKS, finalExam: { id: number; title: string } | null = null): GuidedPlan {
  const count = planWeekCount(items.length, weeks)
  const totalMinutes = items.reduce((sum, item) => sum + item.minutes, 0)
  const allocated = items.length ? allocate(units(items), count) : Array.from({ length: count }, () => [] as Unit[])
  const schedule = allocated.map((week, index): PlanWeek => {
    const days = allocate(week, WEEKDAYS.length).map((day, d): PlanDay => {
      const dayItems = day.flat()
      return { day: WEEKDAYS[d]!, minutes: dayItems.reduce((sum, item) => sum + item.minutes, 0), items: dayItems }
    })
    const weekItems = week.flat()
    return { week: index + 1, minutes: weekItems.reduce((sum, item) => sum + item.minutes, 0), title: majorityChapter(weekItems), items: weekItems, days }
  })
  return { weeks: count, totalMinutes, planVersion: planVersion(items), schedule, finalExam }
}

/* ------------------------------------------------------------------------ */
/* Lagos calendar                                                           */
/* ------------------------------------------------------------------------ */

export function lagosMidnight(at: number): number {
  const shifted = at + WAT_OFFSET
  return shifted - (((shifted % DAY) + DAY) % DAY) - WAT_OFFSET
}

/** YYYY-MM-DD in Lagos. */
export function lagosDateKey(at: number): string {
  return new Date(at + WAT_OFFSET).toISOString().slice(0, 10)
}

/** 0 = Monday … 6 = Sunday, in Lagos. */
function weekdayIndex(at: number): number {
  return (new Date(lagosMidnight(at) + WAT_OFFSET).getUTCDay() + 6) % 7
}

/** Monday (Lagos midnight) of the week containing `at`. */
export function lagosMonday(at: number): number {
  return lagosMidnight(at) - weekdayIndex(at) * DAY
}

/** Lagos midnight of `at`, moved to the next Monday when it falls on a weekend. */
export function planDayStart(at: number): number {
  const midnight = lagosMidnight(at)
  const index = weekdayIndex(midnight)
  return index >= 5 ? midnight + (7 - index) * DAY : midnight
}

/** The weekday `n` weekdays after (or before, n < 0) the weekday `start`. */
export function addWeekdays(start: number, n: number): number {
  const monday = lagosMonday(start)
  const total = weekdayIndex(start) + n
  const weeks = Math.floor(total / 5)
  return monday + weeks * WEEK + (total - weeks * 5) * DAY
}

/** Weekdays from weekday `a` to weekday `b` (negative when b is earlier). */
export function weekdaysBetween(a: number, b: number): number {
  return Math.round((lagosMonday(b) - lagosMonday(a)) / WEEK) * 5 + (weekdayIndex(b) - weekdayIndex(a))
}

/* ------------------------------------------------------------------------ */
/* Learner progress against the plan                                        */
/* ------------------------------------------------------------------------ */

export type PlanStatus = 'finished' | 'ahead' | 'on_track' | 'behind' | 'overrun'
/** guided: the daily plan; chapters: chapter view (the whole course by chapter, no daily plan). */
export type Pace = 'guided' | 'chapters'
export type DayState = 'done' | 'done_early' | 'today' | 'missed' | 'upcoming' | 'free'
export type Today = DayKey | 'weekend'

export interface LearnerState {
  pace: Pace
  /** The weekday the plan started (slot 0). Weekend dates count from the next Monday. */
  startedAt: number
  /** Completed lessons and passed chapter quizzes (and the final exam), with when (ms; null if unknown). */
  completedLessons: Map<number, number | null>
  passedQuizzes: Map<number, number | null>
  planResetAt?: number | null
}

export interface ItemProgress extends PlanItem {
  done: boolean
  doneAt: number | null
  /** Weekday index from the plan's start. */
  slot: number
  /** Lagos midnight of the planned day. */
  date: number
  plannedWeek: number
  plannedDay: DayKey
}

export interface DayProgress {
  day: DayKey
  /** YYYY-MM-DD. */
  date: string
  minutes: number
  state: DayState
  doneCount: number
  totalCount: number
  items: ItemProgress[]
}

export interface WeekProgress {
  week: number
  title: string
  startsOn: string
  endsOn: string
  minutes: number
  doneCount: number
  totalCount: number
  days: DayProgress[]
}

export interface PlanProgress {
  pace: Pace
  /** Calendar weeks the plan spans (12 when it started on a Monday; one more after a mid-week start or a move). */
  weeks: number
  currentWeek: number
  today: Today
  startedOn: string
  finishBy: string
  /** Guided only. */
  status?: PlanStatus
  daysAhead?: number
  daysBehind?: number
  overdue?: ItemProgress[]
  projectedFinish?: string | null
  /** The first unfinished item in plan order, even if it's planned for a later day ("Keep going"). */
  nextItem: ItemProgress | null
  todayItems: ItemProgress[]
  finalExam: { id: number; title: string; done: boolean } | null
  /** Every calendar week, Monday to Friday. */
  plan: WeekProgress[]
  weeksSummary: Array<{ week: number; state: 'done' | 'current' | 'upcoming' | 'behind' }>
  /** When "Move my plan" is (or becomes) available; null when it doesn't apply. */
  resetAvailableAt: string | null
  canReset: boolean
  remainingItems: number
}

const isDone = (item: PlanItem, state: LearnerState): number | null | undefined =>
  item.type === 'lesson' ? (state.completedLessons.has(item.id) ? state.completedLessons.get(item.id) ?? null : undefined) : state.passedQuizzes.has(item.id) ? state.passedQuizzes.get(item.id) ?? null : undefined

/** Where the learner is against their plan at `now`. */
export function planProgress(plan: GuidedPlan, state: LearnerState, now: number): PlanProgress {
  const start = planDayStart(state.startedAt)
  const firstMonday = lagosMonday(start)
  const todayMidnight = lagosMidnight(now)
  const todayIndex = weekdayIndex(todayMidnight)
  const today: Today = todayIndex < 5 ? WEEKDAYS[todayIndex]! : 'weekend'

  const items: ItemProgress[] = []
  for (const week of plan.schedule) {
    week.days.forEach((day, d) => {
      for (const item of day.items) {
        const slot = (week.week - 1) * 5 + d
        const date = addWeekdays(start, slot)
        const doneAt = isDone(item, state)
        items.push({
          ...item, done: doneAt !== undefined, doneAt: doneAt ?? null, slot, date,
          plannedWeek: Math.round((lagosMonday(date) - firstMonday) / WEEK) + 1,
          plannedDay: WEEKDAYS[weekdayIndex(date)]!,
        })
      }
    })
  }
  const lastDate = items.length ? items[items.length - 1]!.date : addWeekdays(start, plan.weeks * 5 - 1)
  const weeks = Math.max(1, Math.round((lagosMonday(lastDate) - firstMonday) / WEEK) + 1)
  const currentWeek = Math.min(weeks, Math.max(1, Math.floor((todayMidnight - firstMonday) / WEEK) + 1))

  const remaining = items.filter((item) => !item.done)
  const finished = items.length > 0 && remaining.length === 0
  const finalExam = plan.finalExam ? { ...plan.finalExam, done: state.passedQuizzes.has(plan.finalExam.id) } : null

  const calendar: WeekProgress[] = Array.from({ length: weeks }, (_, w) => {
    const monday = firstMonday + w * WEEK
    const days = WEEKDAYS.map((day, d): DayProgress => {
      const date = monday + d * DAY
      const dayItems = items.filter((item) => item.date === date)
      const doneCount = dayItems.filter((item) => item.done).length
      const all = dayItems.length > 0 && doneCount === dayItems.length
      const dayState: DayState = date === todayMidnight
        ? 'today'
        : !dayItems.length
          ? 'free'
          : date < todayMidnight
            ? (all ? 'done' : 'missed')
            : all ? 'done_early' : 'upcoming'
      return { day, date: lagosDateKey(date), minutes: dayItems.reduce((sum, item) => sum + item.minutes, 0), state: dayState, doneCount, totalCount: dayItems.length, items: dayItems }
    })
    const weekItems = days.flatMap((day) => day.items)
    return {
      week: w + 1,
      title: majorityChapter(weekItems),
      startsOn: lagosDateKey(monday),
      endsOn: lagosDateKey(monday + 4 * DAY),
      minutes: weekItems.reduce((sum, item) => sum + item.minutes, 0),
      doneCount: weekItems.filter((item) => item.done).length,
      totalCount: weekItems.length,
      days,
    }
  })
  const weeksSummary = calendar.map((week) => ({
    week: week.week,
    state: (week.totalCount > 0 && week.doneCount === week.totalCount
      ? 'done'
      : week.week === currentWeek
        ? 'current'
        : week.week < currentWeek
          ? (state.pace === 'guided' && week.doneCount < week.totalCount ? 'behind' : 'done')
          : 'upcoming') as 'done' | 'current' | 'upcoming' | 'behind',
  }))

  const base: PlanProgress = {
    pace: state.pace,
    weeks,
    currentWeek,
    today,
    startedOn: lagosDateKey(start),
    finishBy: lagosDateKey(lastDate),
    nextItem: remaining[0] ?? null,
    todayItems: items.filter((item) => item.date === todayMidnight),
    finalExam,
    plan: calendar,
    weeksSummary,
    resetAvailableAt: null,
    canReset: false,
    remainingItems: remaining.length,
  }
  if (state.pace !== 'guided') return base

  // Expected done: everything planned for a day before today (on a weekend, the whole week).
  const overdue = remaining.filter((item) => item.date < todayMidnight)
  const daysBehind = new Set(overdue.map((item) => item.date)).size
  // Days ahead: planned weekdays after today, in order, whose items are all done.
  const futureDays = [...new Set(items.filter((item) => item.date > todayMidnight).map((item) => item.date))].sort((a, b) => a - b)
  let daysAhead = 0
  for (const date of futureDays) {
    if (items.every((item) => item.date !== date || item.done)) daysAhead++
    else break
  }
  const overrun = !finished && todayMidnight > lastDate
  const status: PlanStatus = finished ? 'finished' : overrun ? 'overrun' : overdue.length ? 'behind' : daysAhead > 0 ? 'ahead' : 'on_track'

  let projectedFinish: string | null | undefined
  if (status === 'behind' || status === 'overrun') {
    const since = now - 14 * DAY
    const recent = items.filter((item) => item.doneAt !== null && item.doneAt >= since && item.doneAt <= now).length
    projectedFinish = recent > 0 ? lagosDateKey(todayMidnight + Math.ceil(remaining.length / (recent / 14)) * DAY) : null
  }

  const movable = status === 'behind' || status === 'overrun'
  const resetAt = state.planResetAt ? state.planResetAt + PLAN_RESET_COOLDOWN_DAYS * DAY : null
  return {
    ...base,
    status,
    daysAhead,
    daysBehind,
    overdue,
    ...(projectedFinish !== undefined ? { projectedFinish } : {}),
    resetAvailableAt: movable ? new Date(Math.max(now, resetAt ?? 0)).toISOString() : null,
    canReset: movable && (resetAt === null || resetAt <= now),
  }
}

/**
 * The plan start that puts the item at `slot` on today (on a weekend, on Monday): used by
 * "Move my plan" (the first unfinished item's day becomes today) and to place learners when
 * the plan is introduced. Returns Lagos midnight of a weekday.
 */
export function startForSlotToday(slot: number, now: number): number {
  return addWeekdays(planDayStart(now), -Math.max(0, slot))
}

/** Slot of the first unfinished item (0 when nothing is planned). */
export function firstIncompleteSlot(plan: GuidedPlan, done: (item: PlanItem) => boolean): number {
  for (const week of plan.schedule) {
    for (let d = 0; d < week.days.length; d++) {
      for (const item of week.days[d]!.items) if (!done(item)) return (week.week - 1) * 5 + d
    }
  }
  return 0
}

/** "1 day", "2 days", "1 week" (from 5 days). */
export function dayGap(days: number): string {
  if (days >= 5) {
    const weeks = Math.floor(days / 5)
    return `${weeks} week${weeks === 1 ? '' : 's'}`
  }
  return `${days} day${days === 1 ? '' : 's'}`
}

export const DAY_NAMES: Record<DayKey, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' }
