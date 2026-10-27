/**
 * Prints a programme's guided 12-week plan: which lessons and chapter quizzes fall on which weekday
 * of which week, with minutes per item and per week.
 *
 * Usage:
 *   npm run plan:preview -- --fixture scripts/fixtures/plan-data-analysis.json
 *   npm run plan:preview -- --course data-analysis      (reads a LOCAL database only)
 *
 * Fixture format: { "title", "sections": [{ "id", "title", "order", "lessons": [{ "id", "title",
 * "duration" (seconds), "order" }], "quiz"?: { "id", "title" } }], "finalExam"?: { "id", "title" } }
 *
 * --course connects with DATABASE_URI and refuses anything but localhost / 127.0.0.1: the plan
 * is read-only, but this script is for development, never production data.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { PgDialect } from 'drizzle-orm/pg-core'
import { buildGuidedPlan, DAY_NAMES, planItems, type GuidedPlan, type SourceLesson, type SourceQuiz } from '../src/lib/guided-plan.js'
import { planSourceSql, plansFromRows, type PlanSourceRow } from '../src/lib/guided-plan-source.js'

interface Fixture {
  title: string
  sections: Array<{ id: number; title: string; order: number; lessons: Array<{ id: number; title: string; duration?: number | null; order: number }>; quiz?: { id: number; title: string } }>
  finalExam?: { id: number; title: string }
}

const args = process.argv.slice(2)
const arg = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function fromFixture(fixture: Fixture): GuidedPlan {
  const lessons: SourceLesson[] = fixture.sections.flatMap((section) =>
    section.lessons.map((lesson) => ({ ...lesson, sectionId: section.id, sectionTitle: section.title, sectionOrder: section.order })),
  )
  const quizzes: SourceQuiz[] = fixture.sections.flatMap((section) => (section.quiz ? [{ ...section.quiz, kind: 'chapter' as const, sectionId: section.id }] : []))
  return buildGuidedPlan(planItems(lessons, quizzes), undefined, fixture.finalExam ?? null)
}

async function fromDatabase(slug: string): Promise<{ title: string; plan: GuidedPlan }> {
  const uri = process.env.DATABASE_URI ?? ''
  const host = (() => {
    try {
      return new URL(uri).hostname
    } catch {
      return ''
    }
  })()
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`DATABASE_URI points at "${host || 'nothing'}". plan:preview --course only reads a local database; use --fixture instead.`)
  }
  const client = new pg.Client({ connectionString: uri })
  await client.connect()
  try {
    const course = (await client.query<{ id: number; title: string; is_bonus: boolean | null }>('SELECT id, title, is_bonus FROM courses WHERE slug = $1', [slug])).rows[0]
    if (!course) throw new Error(`No programme with slug "${slug}".`)
    if (course.is_bonus) throw new Error(`${course.title} is a bonus course: bonus courses have no plan.`)
    const { sql: text, params } = new PgDialect().sqlToQuery(planSourceSql([course.id]))
    const rows = (await client.query<PlanSourceRow>(text, params)).rows
    return { title: course.title, plan: plansFromRows([course.id], rows).get(Number(course.id))! }
  } finally {
    await client.end()
  }
}

const hours = (minutes: number) => `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`

function print(title: string, plan: GuidedPlan): void {
  const target = plan.totalMinutes / plan.weeks
  console.log(`${title}: guided plan, ${plan.weeks} weeks, Monday to Friday, ${plan.schedule.flatMap((week) => week.items).length} items, ${hours(plan.totalMinutes)} in all (target ${hours(Math.round(target))} a week)`)
  console.log(`planVersion ${plan.planVersion}
`)
  for (const week of plan.schedule) {
    console.log(`Week ${String(week.week).padStart(2)}  ${hours(week.minutes)}  ${week.title}`)
    for (const day of week.days) {
      const label = DAY_NAMES[day.day].padEnd(9)
      if (!day.items.length) console.log(`    ${label}  ---      No new lesson: practise or catch up`)
      day.items.forEach((item, index) => console.log(`    ${index ? ' '.repeat(9) : label}  ${String(item.minutes).padStart(3)} min  ${item.type === 'lesson' ? '' : '[quiz] '}${item.title}`))
    }
    if (week.week === plan.weeks && plan.finalExam) console.log(`    Exam       ${plan.finalExam.title} (opens once every lesson and chapter quiz is done)`)
  }
}

const fixtureFile = arg('--fixture')
const slug = arg('--course')
if (fixtureFile) {
  const fixture = JSON.parse(await readFile(path.resolve(fixtureFile), 'utf8')) as Fixture
  print(fixture.title, fromFixture(fixture))
} else if (slug) {
  const { title, plan } = await fromDatabase(slug)
  print(title, plan)
} else {
  console.error('Usage: npm run plan:preview -- --fixture <file.json>   or   --course <slug>')
  process.exit(1)
}
