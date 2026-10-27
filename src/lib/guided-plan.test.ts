import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addWeekdays, buildGuidedPlan, dayGap, firstIncompleteSlot, lagosDateKey, lessonMinutes, planDayStart, planItems, planProgress,
  startForSlotToday, weekdaysBetween, WEEKDAYS, type GuidedPlan, type LearnerState, type PlanItem, type SourceLesson, type SourceQuiz,
} from './guided-plan.js'

const DAY = 86_400_000

/** `chapters` chapters of `perChapter` lessons, each `seconds` long, with a chapter quiz each. */
function curriculum(chapters: number, perChapter: number, seconds: (index: number) => number = () => 600, quizzes = true) {
  const lessons: SourceLesson[] = []
  const quizList: SourceQuiz[] = []
  let id = 1
  for (let c = 1; c <= chapters; c++) {
    for (let l = 1; l <= perChapter; l++) {
      lessons.push({ id, title: `Lesson ${c}.${l}`, duration: seconds(id), order: l, sectionId: 100 + c, sectionTitle: `Chapter ${c}`, sectionOrder: c })
      id++
    }
    if (quizzes) quizList.push({ id: 900 + c, title: `Chapter quiz ${c}`, kind: 'chapter', sectionId: 100 + c })
  }
  return { lessons, quizzes: quizList }
}

const flatIds = (plan: GuidedPlan) => plan.schedule.flatMap((week) => week.days.flatMap((day) => day.items.map((item) => `${item.type}:${item.id}`)))

test('item minutes: ceil(duration / 60) + 5 practice, 10 + 5 when unknown, 15 for a chapter quiz', () => {
  assert.equal(lessonMinutes(601), 16)
  assert.equal(lessonMinutes(0), 15)
  assert.equal(lessonMinutes(null), 15)
  const { lessons, quizzes } = curriculum(1, 2)
  assert.deepEqual(planItems(lessons, quizzes).map((item) => [item.type, item.minutes]), [['lesson', 15], ['lesson', 15], ['chapter_quiz', 15]])
})

test('items follow chapter order then lesson order; knowledge checks and the exam are not items', () => {
  const { lessons, quizzes } = curriculum(3, 3)
  const items = planItems([...lessons].reverse(), [...quizzes, { id: 999, title: 'Final exam', kind: 'final_exam' }])
  assert.deepEqual(items.map((item) => item.id), [1, 2, 3, 901, 4, 5, 6, 902, 7, 8, 9, 903])
})

test('even durations: 60 equal lessons fill 12 weeks of 5, one a weekday', () => {
  const { lessons } = curriculum(12, 5, () => 600, false)
  const plan = buildGuidedPlan(planItems(lessons, []))
  assert.equal(plan.weeks, 12)
  for (const week of plan.schedule) assert.deepEqual(week.days.map((day) => day.items.length), [1, 1, 1, 1, 1])
  assert.deepEqual(flatIds(plan), lessons.map((lesson) => `lesson:${lesson.id}`), 'order is kept')
})

test('one huge lesson gets a week of its own and is never split', () => {
  const { lessons, quizzes } = curriculum(6, 8, (id) => (id === 20 ? 10 * 3600 : 900))
  const plan = buildGuidedPlan(planItems(lessons, quizzes))
  assert.equal(plan.weeks, 12)
  const week = plan.schedule.find((w) => w.items.some((item) => item.id === 20))!
  assert.deepEqual(week.items.filter((item) => item.type === 'lesson').map((item) => item.id), [20])
  assert.equal(flatIds(plan).length, lessons.length + quizzes.length)
})

test('every lesson with zero duration: 10 + 5 minutes each, still 12 weeks', () => {
  const { lessons, quizzes } = curriculum(5, 9, () => 0)
  const plan = buildGuidedPlan(planItems(lessons, quizzes))
  assert.equal(plan.weeks, 12)
  assert.ok(plan.schedule.every((week) => week.items.length > 0))
  assert.equal(plan.totalMinutes, 45 * 15 + 5 * 15)
})

test('a chapter quiz stays with its chapter’s last lesson: same week and same day', () => {
  for (const [chapters, per] of [[8, 5], [10, 4], [3, 17], [14, 3]] as const) {
    const { lessons, quizzes } = curriculum(chapters, per, (id) => 300 + ((id * 137) % 1500))
    const plan = buildGuidedPlan(planItems(lessons, quizzes))
    for (const week of plan.schedule) {
      for (const day of week.days) {
        day.items.forEach((item, index) => {
          if (item.type !== 'chapter_quiz') return
          const previous = day.items[index - 1]
          assert.ok(previous && previous.type === 'lesson' && previous.sectionId === item.sectionId, `quiz ${item.id} separated (${chapters}x${per})`)
        })
      }
    }
  }
})

test('every item lands on a weekday, in order, each once; days add up to their week', () => {
  const { lessons, quizzes } = curriculum(9, 5, (id) => 240 + ((id * 211) % 1800))
  const items = planItems(lessons, quizzes)
  const plan = buildGuidedPlan(items)
  for (const week of plan.schedule) {
    assert.deepEqual(week.days.map((day) => day.day), [...WEEKDAYS])
    assert.deepEqual(week.days.flatMap((day) => day.items), week.items, `week ${week.week} days keep its order`)
    assert.equal(week.days.reduce((sum, day) => sum + day.minutes, 0), week.minutes)
  }
  assert.deepEqual(flatIds(plan), items.map((item) => `${item.type}:${item.id}`))
})

test('a week with fewer than 5 items leaves some weekdays free', () => {
  const plan = buildGuidedPlan(planItems(curriculum(12, 2, () => 600, false).lessons, []))
  for (const week of plan.schedule) {
    assert.equal(week.days.filter((day) => day.items.length).length, 2)
    assert.equal(week.days.filter((day) => !day.items.length).length, 3)
  }
})

test('exactly 12 weeks for a real-sized programme (40+ lessons), weekdays balanced', () => {
  const { lessons, quizzes } = curriculum(9, 5, (id) => 240 + ((id * 211) % 1800))
  const plan = buildGuidedPlan(planItems(lessons, quizzes))
  assert.equal(plan.weeks, 12)
  assert.ok(plan.schedule.every((week) => week.items.length > 0), 'no empty week')
  assert.ok(plan.schedule.every((week) => week.title.startsWith('Chapter ')), 'every week has a chapter title')
})

test('small programme: fewer items than weeks gives max(4, items) weeks', () => {
  assert.equal(buildGuidedPlan(planItems(curriculum(1, 2, () => 600, false).lessons, [])).weeks, 4)
  const seven = buildGuidedPlan(planItems(curriculum(1, 7, () => 600, false).lessons, []))
  assert.equal(seven.weeks, 7)
  assert.deepEqual(seven.schedule.map((week) => week.items.length), Array(7).fill(1))
})

test('planVersion is deterministic and changes with the curriculum', () => {
  const { lessons, quizzes } = curriculum(9, 5)
  const a = buildGuidedPlan(planItems(lessons, quizzes))
  const b = buildGuidedPlan(planItems([...lessons].reverse(), [...quizzes].reverse()))
  assert.deepEqual(a, b)
  const changed = buildGuidedPlan(planItems(lessons.map((lesson) => (lesson.id === 3 ? { ...lesson, duration: 1200 } : lesson)), quizzes))
  assert.notEqual(changed.planVersion, a.planVersion)
})

test('the final step appears only when there is a published final exam', () => {
  const { lessons, quizzes } = curriculum(4, 4)
  const items = planItems(lessons, quizzes)
  assert.equal(buildGuidedPlan(items).finalExam, null)
  assert.deepEqual(buildGuidedPlan(items, 12, { id: 999, title: 'Final exam' }).finalExam, { id: 999, title: 'Final exam' })
})

/* -------------------------------------------------------- calendar */

const at = (iso: string) => Date.parse(iso)
const MON = at('2026-10-26T09:00:00+01:00') // Monday 26 October 2026, Lagos

test('weekday arithmetic skips weekends', () => {
  const monday = planDayStart(MON)
  assert.equal(lagosDateKey(addWeekdays(monday, 4)), '2026-10-30')
  assert.equal(lagosDateKey(addWeekdays(monday, 5)), '2026-11-02')
  assert.equal(lagosDateKey(addWeekdays(addWeekdays(monday, 7), -7)), '2026-10-26')
  assert.equal(weekdaysBetween(monday, addWeekdays(monday, 12)), 12)
  assert.equal(lagosDateKey(planDayStart(at('2026-10-31T10:00:00+01:00'))), '2026-11-02', 'a Saturday start counts from Monday')
  assert.equal(dayGap(1), '1 day')
  assert.equal(dayGap(6), '1 week')
})

/* -------------------------------------------------------- status rules */

/** 60 lessons, one per weekday. */
const realPlan = () => buildGuidedPlan(planItems(curriculum(12, 5, () => 600, false).lessons, []))
const doneMap = (items: PlanItem[], when: number | null = null) => new Map(items.map((item) => [item.id, when]))
const state = (startedAt: number, done: PlanItem[] = [], extra: Partial<LearnerState> = {}): LearnerState => ({ pace: 'guided', startedAt, completedLessons: doneMap(done), passedQuizzes: new Map(), ...extra })
const ordered = (plan: GuidedPlan) => plan.schedule.flatMap((week) => week.items)

test('fresh enrolment mid-week: week 1 is that week, the days already past are free, on track', () => {
  const wednesday = at('2026-10-28T08:00:00+01:00')
  const progress = planProgress(realPlan(), state(wednesday), wednesday + 3 * 3_600_000)
  assert.equal(progress.currentWeek, 1)
  assert.equal(progress.today, 'wed')
  assert.equal(progress.status, 'on_track')
  assert.deepEqual(progress.plan[0]!.days.map((day) => day.state), ['free', 'free', 'today', 'upcoming', 'upcoming'])
  assert.equal(progress.todayItems[0]?.id, 1)
  assert.equal(progress.nextItem?.id, 1)
  assert.equal(progress.plan[0]!.startsOn, '2026-10-26')
})

test('completing tomorrow’s lesson today: 1 day ahead of the class', () => {
  const plan = realPlan()
  const items = ordered(plan)
  const progress = planProgress(plan, state(MON, items.slice(0, 2)), MON)
  assert.equal(progress.status, 'ahead')
  assert.equal(progress.daysAhead, 1)
  assert.deepEqual(progress.plan[0]!.days.map((day) => day.state), ['today', 'done_early', 'upcoming', 'upcoming', 'upcoming'])
  assert.equal(progress.nextItem?.id, 3, 'Keep going points at Wednesday’s lesson')
})

test('finishing Friday early: Keep going offers next week’s Monday; 4 days ahead', () => {
  const plan = realPlan()
  const progress = planProgress(plan, state(MON, ordered(plan).slice(0, 5)), MON)
  assert.equal(progress.daysAhead, 4)
  assert.equal(progress.nextItem?.plannedWeek, 2)
  assert.equal(progress.nextItem?.plannedDay, 'mon')
  assert.equal(progress.weeksSummary[0]!.state, 'done')
})

test('behind: overdue items, days behind, projected finish, Move my plan', () => {
  const plan = realPlan()
  const thursday = MON + 3 * DAY
  const progress = planProgress(plan, state(MON, ordered(plan).slice(0, 1).map((item) => item), { completedLessons: doneMap(ordered(plan).slice(0, 1), MON + DAY) }), thursday)
  assert.equal(progress.status, 'behind')
  assert.equal(progress.daysBehind, 2)
  assert.deepEqual(progress.overdue?.map((item) => item.plannedDay), ['tue', 'wed'])
  assert.deepEqual(progress.plan[0]!.days.map((day) => day.state), ['done', 'missed', 'missed', 'today', 'upcoming'])
  assert.ok(progress.projectedFinish)
  assert.equal(progress.canReset, true)
  const idle = planProgress(plan, state(MON, [], { completedLessons: doneMap(ordered(plan).slice(0, 1), MON - 30 * DAY) }), thursday)
  assert.equal(idle.projectedFinish, null)
})

test('on a weekend the whole week is expected; the week summary shows a behind week', () => {
  const plan = realPlan()
  const saturday = MON + 5 * DAY
  const progress = planProgress(plan, state(MON, ordered(plan).slice(0, 4)), saturday)
  assert.equal(progress.today, 'weekend')
  assert.equal(progress.status, 'behind')
  assert.equal(progress.daysBehind, 1)
  const later = planProgress(plan, state(MON, ordered(plan).slice(0, 4)), MON + 8 * DAY)
  assert.equal(later.weeksSummary[0]!.state, 'behind')
  assert.equal(later.weeksSummary[1]!.state, 'current')
})

test('moving the plan puts the first unfinished item on today; the cooldown is 14 days', () => {
  const plan = realPlan()
  const thursday = MON + 3 * DAY
  const done = ordered(plan).slice(0, 1)
  const before = planProgress(plan, state(MON, done), thursday)
  assert.equal(before.status, 'behind')
  const slot = firstIncompleteSlot(plan, (item) => done.some((d) => d.id === item.id))
  const moved = startForSlotToday(slot, thursday)
  assert.equal(weekdaysBetween(planDayStart(MON), moved), 2, 'moved forward by the 2 weekdays they were behind')
  const after = planProgress(plan, state(moved, done, { planResetAt: thursday }), thursday)
  assert.equal(after.status, 'on_track')
  assert.equal(after.todayItems[0]?.id, 2)
  const soon = planProgress(plan, state(MON, done, { planResetAt: thursday - 10 * DAY }), thursday)
  assert.equal(soon.canReset, false)
  assert.equal(soon.resetAvailableAt, new Date(thursday + 4 * DAY).toISOString())
})

test('finished and overrun', () => {
  const plan = realPlan()
  assert.equal(planProgress(plan, state(MON, ordered(plan)), MON + DAY).status, 'finished')
  const overrun = planProgress(plan, state(MON, ordered(plan).slice(0, 40)), MON + 100 * DAY)
  assert.equal(overrun.status, 'overrun')
  assert.equal(overrun.currentWeek, overrun.weeks)
})

test('chapter view: no status, no overdue, the dates are kept', () => {
  const plan = realPlan()
  const progress = planProgress(plan, state(MON, [], { pace: 'chapters' }), MON + 40 * DAY)
  assert.equal(progress.status, undefined)
  assert.equal(progress.overdue, undefined)
  assert.equal(progress.daysBehind, undefined)
  assert.equal(progress.startedOn, '2026-10-26')
  assert.equal(progress.resetAvailableAt, null)
})
