import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGuidedPlan, lagosMidnight, lessonMinutes, movedPlanStart, planItems, planProgress,
  type LearnerState, type PlanItem, type SourceLesson, type SourceQuiz,
} from './guided-plan.js'

const DAY = 86_400_000

/** `chapters` chapters of `perChapter` lessons, each `seconds` long, with a chapter quiz each. */
function curriculum(chapters: number, perChapter: number, seconds: (index: number) => number = () => 600, quizzes = true) {
  const lessons: SourceLesson[] = []
  const quizList: SourceQuiz[] = []
  let id = 1
  for (let c = 1; c <= chapters; c++) {
    for (let l = 1; l <= perChapter; l++) {
      lessons.push({ id: id, title: `Lesson ${c}.${l}`, duration: seconds(id), order: l, sectionId: 100 + c, sectionTitle: `Chapter ${c}`, sectionOrder: c })
      id++
    }
    if (quizzes) quizList.push({ id: 900 + c, title: `Chapter quiz ${c}`, kind: 'chapter', sectionId: 100 + c })
  }
  return { lessons, quizzes: quizList }
}

const flatIds = (plan: ReturnType<typeof buildGuidedPlan>) => plan.schedule.flatMap((week) => week.items.map((item) => `${item.type}:${item.id}`))

test('item minutes: ceil(duration / 60) + 5 practice, 10 + 5 when unknown, 15 for a chapter quiz', () => {
  assert.equal(lessonMinutes(601), 16)
  assert.equal(lessonMinutes(0), 15)
  assert.equal(lessonMinutes(null), 15)
  const { lessons, quizzes } = curriculum(1, 2)
  const items = planItems(lessons, quizzes)
  assert.deepEqual(items.map((item) => [item.type, item.minutes]), [['lesson', 15], ['lesson', 15], ['chapter_quiz', 15]])
})

test('items follow chapter order then lesson order, whatever the input order; knowledge checks and the exam are not items', () => {
  const { lessons, quizzes } = curriculum(3, 3)
  const items = planItems([...lessons].reverse(), [...quizzes, { id: 999, title: 'Final exam', kind: 'final_exam' }])
  assert.deepEqual(items.map((item) => item.id), [1, 2, 3, 901, 4, 5, 6, 902, 7, 8, 9, 903])
})

test('even durations: 48 equal lessons fill 12 weeks of 4', () => {
  const { lessons } = curriculum(12, 4, () => 600, false)
  const plan = buildGuidedPlan(planItems(lessons, []))
  assert.equal(plan.weeks, 12)
  assert.deepEqual(plan.schedule.map((week) => week.items.length), Array(12).fill(4))
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

test('a chapter quiz always stays in the week of its chapter’s last lesson', () => {
  for (const [chapters, per] of [[8, 5], [10, 4], [3, 17], [14, 3]] as const) {
    const { lessons, quizzes } = curriculum(chapters, per, (id) => 300 + ((id * 137) % 1500))
    const plan = buildGuidedPlan(planItems(lessons, quizzes))
    for (const week of plan.schedule) {
      week.items.forEach((item, index) => {
        if (item.type !== 'chapter_quiz') return
        const previous = week.items[index - 1]
        assert.ok(previous && previous.type === 'lesson' && previous.sectionId === item.sectionId, `quiz ${item.id} separated (${chapters}x${per})`)
      })
    }
  }
})

test('exactly 12 weeks for a real-sized programme (40+ lessons), every item once, in order', () => {
  const { lessons, quizzes } = curriculum(9, 5, (id) => 240 + ((id * 211) % 1800))
  const items = planItems(lessons, quizzes)
  const plan = buildGuidedPlan(items)
  assert.equal(plan.weeks, 12)
  assert.equal(plan.schedule.length, 12)
  assert.deepEqual(flatIds(plan), items.map((item) => `${item.type}:${item.id}`))
  assert.ok(plan.schedule.every((week) => week.items.length > 0), 'no empty week')
})

test('small programme: fewer items than weeks gives max(4, items) weeks', () => {
  const tiny = buildGuidedPlan(planItems(curriculum(1, 2, () => 600, false).lessons, []))
  assert.equal(tiny.weeks, 4)
  assert.equal(tiny.schedule.length, 4)
  const seven = buildGuidedPlan(planItems(curriculum(1, 7, () => 600, false).lessons, []))
  assert.equal(seven.weeks, 7)
  assert.deepEqual(seven.schedule.map((week) => week.items.length), Array(7).fill(1))
  assert.equal(buildGuidedPlan(planItems(curriculum(3, 4).lessons, curriculum(3, 4).quizzes)).weeks, 12)
})

test('planVersion is deterministic and changes with the curriculum', () => {
  const { lessons, quizzes } = curriculum(9, 5)
  const a = buildGuidedPlan(planItems(lessons, quizzes))
  const b = buildGuidedPlan(planItems([...lessons].reverse(), [...quizzes].reverse()))
  assert.equal(a.planVersion, b.planVersion)
  assert.deepEqual(a, b)
  const changed = buildGuidedPlan(planItems(lessons.map((lesson) => (lesson.id === 3 ? { ...lesson, duration: 1200 } : lesson)), quizzes))
  assert.notEqual(changed.planVersion, a.planVersion)
})

test('the final step appears only when there is a published final exam', () => {
  const items = planItems(curriculum(4, 4).lessons, curriculum(4, 4).quizzes)
  assert.equal(buildGuidedPlan(items).finalExam, null)
  const withExam = buildGuidedPlan(items, 12, { id: 999, title: 'Final exam' })
  assert.deepEqual(withExam.finalExam, { id: 999, title: 'Final exam' })
  const state: LearnerState = { pace: 'guided', startedAt: Date.parse('2026-10-01T00:00:00Z'), completedLessons: new Map(), passedQuizzes: new Map() }
  assert.equal(planProgress(buildGuidedPlan(items), state, Date.parse('2026-10-02T10:00:00Z')).finalExam, null)
})

/* -------------------------------------------------------- status rules */

const START = Date.parse('2026-10-05T08:00:00+01:00') // a Monday in Lagos
const realPlan = () => buildGuidedPlan(planItems(curriculum(12, 4, () => 600, false).lessons, []))
const done = (items: PlanItem[], at: number | null = null) => new Map(items.map((item) => [item.id, at]))

test('fresh enrolment: week 1, on track, next item is the first lesson', () => {
  const plan = realPlan()
  const progress = planProgress(plan, { pace: 'guided', startedAt: START, completedLessons: new Map(), passedQuizzes: new Map() }, START + 3 * 3600_000)
  assert.equal(progress.currentWeek, 1)
  assert.equal(progress.status, 'on_track')
  assert.equal(progress.nextItem?.id, 1)
  assert.equal(progress.thisWeek.totalCount, 4)
  assert.equal(progress.startedOn, '2026-10-05')
  assert.equal(progress.finishBy, '2026-12-27')
  assert.equal(progress.canReset, false)
})

test('behind: overdue items, distinct weeks behind, projected finish from the last 14 days', () => {
  const plan = realPlan()
  const now = START + 22 * DAY // week 4
  const firstWeek = plan.schedule[0]!.items
  const progress = planProgress(plan, { pace: 'guided', startedAt: START, completedLessons: done(firstWeek, now - 2 * DAY), passedQuizzes: new Map() }, now)
  assert.equal(progress.currentWeek, 4)
  assert.equal(progress.status, 'behind')
  assert.equal(progress.weeksBehind, 2)
  assert.equal(progress.overdue?.length, 8)
  assert.equal(progress.firstIncompleteWeek, 2)
  assert.ok(progress.projectedFinish)
  assert.equal(progress.canReset, true)
  const idle = planProgress(plan, { pace: 'guided', startedAt: START, completedLessons: done(firstWeek, now - 20 * DAY), passedQuizzes: new Map() }, now)
  assert.equal(idle.projectedFinish, null)
})

test('ahead, finished and overrun', () => {
  const plan = realPlan()
  const items = plan.schedule.flatMap((week) => week.items)
  const ahead = planProgress(plan, { pace: 'guided', startedAt: START, completedLessons: done(items.slice(0, 5)), passedQuizzes: new Map() }, START + DAY)
  assert.equal(ahead.status, 'ahead')
  const finished = planProgress(plan, { pace: 'guided', startedAt: START, completedLessons: done(items), passedQuizzes: new Map() }, START + DAY)
  assert.equal(finished.status, 'finished')
  assert.equal(finished.nextItem, null)
  const overrun = planProgress(plan, { pace: 'guided', startedAt: START, completedLessons: done(items.slice(0, 40)), passedQuizzes: new Map() }, START + 90 * DAY)
  assert.equal(overrun.status, 'overrun')
  assert.equal(overrun.currentWeek, 12)
})

test('self-paced: the week structure stays, status and overdue are left out', () => {
  const plan = realPlan()
  const progress = planProgress(plan, { pace: 'self_paced', startedAt: START, completedLessons: new Map(), passedQuizzes: new Map() }, START + 40 * DAY)
  assert.equal(progress.status, undefined)
  assert.equal(progress.overdue, undefined)
  assert.equal(progress.weeksBehind, undefined)
  assert.equal(progress.plan.length, 12)
  assert.equal(progress.resetAvailableAt, null)
})

test('moving the plan makes the first incomplete week the current week; the cooldown is 14 days', () => {
  const plan = realPlan()
  const now = START + 40 * DAY
  const firstWeek = plan.schedule[0]!.items
  const state: LearnerState = { pace: 'guided', startedAt: START, completedLessons: done(firstWeek), passedQuizzes: new Map() }
  const before = planProgress(plan, state, now)
  const moved = movedPlanStart(before.firstIncompleteWeek, now)
  assert.equal(moved, lagosMidnight(now) - 7 * DAY)
  const after = planProgress(plan, { ...state, startedAt: moved, planResetAt: now }, now)
  assert.equal(after.currentWeek, 2)
  assert.equal(after.status, 'on_track')
  const later = planProgress(plan, { ...state, startedAt: moved, planResetAt: now }, now + 20 * DAY)
  assert.equal(later.status, 'behind')
  assert.equal(later.canReset, true)
  const soon = planProgress(plan, { ...state, startedAt: moved - 14 * DAY, planResetAt: now - 10 * DAY }, now)
  assert.equal(soon.status, 'behind')
  assert.equal(soon.canReset, false)
  assert.equal(soon.resetAvailableAt, new Date(now + 4 * DAY).toISOString())
})
