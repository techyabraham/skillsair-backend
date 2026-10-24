/**
 * Imports content packs (content/packs/<course-slug>/questions.json and programme.json).
 *
 *   - Questions are validated and linted (src/lib/content-pack.ts); questions with errors are skipped
 *     and listed. Valid ones are upserted by `key` as approved, origin "content_pack". Pack questions
 *     no longer in the pack are retired, never deleted (attempt history stays valid).
 *   - Creates any missing chapter quizzes (one per chapter with chapter-pool questions), knowledge
 *     checks (lessons with knowledge-check questions) and the final exam (not for free bonus
 *     courses). The exam is published only once its pool is at least 2.5x the draw and covers every chapter.
 *   - programme.json goes into the live programme fields; the previous values are kept in the
 *     programme's content history first. The copy lint is reported.
 *
 * Dry run by default; nothing is written without --execute. Re-imports change only what changed.
 *
 * Usage:
 *   npm run content:import -- --course <slug> [--course <slug> ...] | --all [--execute] [--packs <dir>]
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Payload } from 'payload'
import { convertMarkdownToLexical, editorConfigFactory } from '@payloadcms/richtext-lexical'
import { lintQuestions, programmeCopySchema, type PackQuestion, type ProgrammePack } from '../lib/content-pack.js'
import { lintProgrammeCopy } from '../lib/content-lint.js'
import { examSize, kindDefaults } from '../lib/assessments.js'
import { relationId } from '../lib/course-access.js'
import { CACHE_KEYS, cacheDel } from '../lib/cache.js'

interface CourseRow { id: number; title: string; slug: string; isBonus?: boolean | null; totalDuration?: number | null }
interface SectionRow { id: number; title: string; order: number }
interface LessonRow { id: number; title: string; section: unknown; driveFileId?: string | null; duration?: number | null; order: number }
interface QuestionRow { id: number; key?: string | null; status?: string | null; origin?: string | null; prompt: string; type?: string | null; options?: Array<{ text: string }> | null; correctIndexes?: number[] | null; sourceTimestamp?: string | null; pools?: string[] | null; section?: unknown; lesson?: unknown; explanation?: unknown }
interface QuizRow { id: number; kind?: string | null; section?: unknown; lesson?: unknown; isPublished?: boolean | null; drawCount?: number | null }

export interface ImportSummary {
  slug: string
  added: number
  updated: number
  unchanged: number
  retired: number
  skipped: number
  quizzesCreated: string[]
  examPublished: boolean | null
  programme: 'updated' | 'unchanged' | 'none'
  warnings: string[]
  errors: string[]
}

type MarkdownConverter = (markdown: string) => unknown

async function markdownConverter(payload: Payload): Promise<MarkdownConverter> {
  const editorConfig = await editorConfigFactory.default({ config: payload.config })
  return (markdown: string) => convertMarkdownToLexical({ editorConfig, markdown })
}

/** JSON with sorted keys, so stored rich text compares equal to a fresh conversion of the same text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value ?? null)
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b)

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
}

export async function importPack(payload: Payload, slug: string, packDir: string, execute: boolean, toLexical: MarkdownConverter): Promise<ImportSummary> {
  const summary: ImportSummary = { slug, added: 0, updated: 0, unchanged: 0, retired: 0, skipped: 0, quizzesCreated: [], examPublished: null, programme: 'none', warnings: [], errors: [] }
  const course = (await payload.find({ collection: 'courses', where: { slug: { equals: slug } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as CourseRow | undefined
  if (!course) { summary.errors.push(`No programme with slug "${slug}".`); return summary }
  const sections = (await payload.find({ collection: 'sections', where: { course: { equals: course.id } }, sort: 'order', limit: 1000, depth: 0, overrideAccess: true })).docs as unknown as SectionRow[]
  const sectionIds = sections.map((section) => section.id)
  const lessons = sectionIds.length ? (await payload.find({ collection: 'lessons', where: { section: { in: sectionIds } }, limit: 10000, depth: 0, overrideAccess: true })).docs as unknown as LessonRow[] : []
  const lessonByDrive = new Map(lessons.filter((lesson) => lesson.driveFileId).map((lesson) => [lesson.driveFileId as string, lesson]))
  const sectionByOrder = new Map(sections.map((section) => [section.order, section]))
  const context = { skipCourseStats: true }

  // ---------- questions ----------
  const questionsFile = path.join(packDir, 'questions.json')
  let validQuestions: PackQuestion[] = []
  if (fs.existsSync(questionsFile)) {
    const raw = readJson(questionsFile)
    if (!Array.isArray(raw)) summary.errors.push('questions.json must be an array.')
    else {
      const { valid, issues } = lintQuestions(raw, new Set(lessonByDrive.keys()))
      validQuestions = valid
      summary.skipped = raw.length - valid.length
      for (const issue of issues) (issue.level === 'error' ? summary.errors : summary.warnings).push(`${issue.key}: ${issue.message}`)
      const existing = (await payload.find({ collection: 'quiz-questions', where: { course: { equals: course.id } }, limit: 20000, depth: 0, overrideAccess: true })).docs as unknown as QuestionRow[]
      const byKey = new Map(existing.filter((question) => question.key).map((question) => [question.key as string, question]))
      for (const q of valid) {
        const lesson = lessonByDrive.get(q.lessonDriveFileId) as LessonRow
        const sectionId = Number(relationId(lesson.section)) || sectionByOrder.get(q.chapterOrder)?.id || null
        const data = {
          key: q.key,
          prompt: q.prompt,
          type: q.type,
          options: q.options.map((text) => ({ text })),
          correctIndexes: [...q.correct].sort((a, b) => a - b),
          course: course.id,
          section: sectionId,
          lesson: lesson.id,
          sourceTimestamp: q.sourceTimestamp ?? null,
          pools: [...new Set(q.pools)].sort(),
          status: 'approved',
          origin: 'content_pack',
        }
        const current = byKey.get(q.key)
        if (!current) {
          summary.added++
          if (execute) await payload.create({ collection: 'quiz-questions', data: { ...data, explanation: toLexical(q.explanation) } as never, overrideAccess: true, context })
          continue
        }
        const currentShape = {
          key: current.key, prompt: current.prompt, type: current.type ?? 'single', options: (current.options ?? []).map((option) => ({ text: option.text })),
          correctIndexes: [...(current.correctIndexes ?? [])].map(Number).sort((a, b) => a - b), course: course.id,
          section: current.section ? Number(relationId(current.section)) : null, lesson: current.lesson ? Number(relationId(current.lesson)) : null,
          sourceTimestamp: current.sourceTimestamp ?? null, pools: [...(current.pools ?? [])].sort(), status: current.status, origin: current.origin,
        }
        const explanationChanged = !same(toLexical(q.explanation), current.explanation)
        if (same(currentShape, data) && !explanationChanged) { summary.unchanged++; continue }
        summary.updated++
        if (execute) await payload.update({ collection: 'quiz-questions', id: current.id, data: { ...data, explanation: toLexical(q.explanation) } as never, overrideAccess: true, context })
      }
      // Retire pack questions that left the pack (never delete: attempts reference them).
      const keys = new Set(valid.map((q) => q.key))
      const invalidKeys = new Set(raw.map((item) => (item as { key?: string })?.key).filter(Boolean) as string[])
      for (const question of existing) {
        if (question.origin !== 'content_pack' || !question.key || keys.has(question.key) || question.status === 'retired') continue
        // A question that's in the pack but failed the lint keeps its current state until it's fixed.
        if (invalidKeys.has(question.key)) continue
        summary.retired++
        if (execute) await payload.update({ collection: 'quiz-questions', id: question.id, data: { status: 'retired' } as never, overrideAccess: true, context })
      }
    }
  }

  // ---------- quizzes ----------
  if (validQuestions.length || fs.existsSync(questionsFile)) {
    const quizzes = (await payload.find({ collection: 'quizzes', where: { course: { equals: course.id } }, limit: 5000, depth: 0, overrideAccess: true })).docs as unknown as QuizRow[]
    const chapterSections = new Set<number>()
    const checkLessons = new Set<number>()
    const examBySection = new Map<number, number>()
    for (const q of validQuestions) {
      const lesson = lessonByDrive.get(q.lessonDriveFileId) as LessonRow
      const sectionId = Number(relationId(lesson.section))
      if (q.pools.includes('chapter')) chapterSections.add(sectionId)
      if (q.pools.includes('knowledge_check')) checkLessons.add(lesson.id)
      if (q.pools.includes('exam')) examBySection.set(sectionId, (examBySection.get(sectionId) ?? 0) + 1)
    }
    const chapter = kindDefaults('chapter')
    for (const section of sections) {
      if (!chapterSections.has(section.id)) continue
      if (quizzes.some((quiz) => quiz.kind === 'chapter' && Number(relationId(quiz.section)) === section.id)) continue
      summary.quizzesCreated.push(`chapter quiz: ${section.title}`)
      if (execute) await payload.create({ collection: 'quizzes', data: { title: `Chapter quiz: ${section.title}`, kind: 'chapter', course: course.id, section: section.id, passingScore: chapter.passingScore, drawCount: chapter.drawCount, maxAttempts: chapter.maxAttempts, cooldownHours: chapter.cooldownHours, shuffle: true, isPublished: true } as never, overrideAccess: true })
    }
    const knowledge = kindDefaults('knowledge_check')
    for (const lesson of lessons) {
      if (!checkLessons.has(lesson.id)) continue
      if (quizzes.some((quiz) => quiz.kind === 'knowledge_check' && Number(relationId(quiz.lesson)) === lesson.id)) continue
      summary.quizzesCreated.push(`knowledge check: ${lesson.title}`)
      if (execute) await payload.create({ collection: 'quizzes', data: { title: `Quick check: ${lesson.title}`, kind: 'knowledge_check', course: course.id, lesson: lesson.id, passingScore: 0, drawCount: knowledge.drawCount, shuffle: true, isPublished: true } as never, overrideAccess: true })
    }
    if (!course.isBonus && examBySection.size) {
      const size = examSize(Number(course.totalDuration ?? 0))
      const examPool = [...examBySection.values()].reduce((sum, n) => sum + n, 0)
      const coversAll = sections.filter((section) => lessons.some((lesson) => Number(relationId(lesson.section)) === section.id)).every((section) => (examBySection.get(section.id) ?? 0) > 0)
      const ready = examPool >= Math.ceil(size.drawCount * 2.5) && coversAll
      summary.examPublished = ready
      if (!ready) summary.warnings.push(`Final exam pool: ${examPool} questions${coversAll ? '' : ', not every chapter covered'}; needs at least ${Math.ceil(size.drawCount * 2.5)} covering every chapter before it's published.`)
      const exam = quizzes.find((quiz) => quiz.kind === 'final_exam')
      const final = kindDefaults('final_exam')
      if (!exam) {
        summary.quizzesCreated.push(`final exam (${ready ? 'published' : 'unpublished until the pool is big enough'})`)
        if (execute) await payload.create({ collection: 'quizzes', data: { title: `Final exam: ${course.title}`, kind: 'final_exam', course: course.id, passingScore: final.passingScore, drawCount: size.drawCount, timeLimitMinutes: size.timeLimitMinutes, maxAttempts: final.maxAttempts, cooldownHours: final.cooldownHours, weightByChapter: true, shuffle: true, isPublished: ready } as never, overrideAccess: true })
      } else if (ready && !exam.isPublished && execute) {
        await payload.update({ collection: 'quizzes', id: exam.id, data: { isPublished: true }, overrideAccess: true })
      }
    }
  }

  // ---------- programme copy ----------
  const programmeFile = path.join(packDir, 'programme.json')
  if (fs.existsSync(programmeFile)) {
    const parsed = programmeCopySchema.safeParse(readJson(programmeFile))
    if (!parsed.success) summary.errors.push(`programme.json: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`)
    else {
      const copy: ProgrammePack = parsed.data
      for (const issue of lintProgrammeCopy(copy)) (issue.level === 'error' ? summary.errors : summary.warnings).push(`programme ${issue.field}: ${issue.message}`)
      const full = await payload.findByID({ collection: 'courses', id: course.id, depth: 0, overrideAccess: true }) as unknown as Record<string, unknown> & { meta?: { title?: string; description?: string } | null; contentHistory?: unknown[] | null }
      const next = {
        meta: { ...(full.meta ?? {}), title: copy.seoTitle, description: copy.metaDescription },
        shortDescription: copy.shortDescription,
        description: toLexical(copy.description),
        objectives: copy.objectives.map((objective) => ({ objective })),
        requirements: copy.requirements.map((requirement) => ({ requirement })),
        whoItsFor: copy.whoItsFor.map((item) => ({ item })),
        toolsCovered: copy.toolsCovered.map((tool) => ({ tool })),
        careerPaths: copy.careerPaths.map((role) => ({ role })),
        faq: copy.faq,
        primaryKeyword: copy.primaryKeyword,
        secondaryKeywords: copy.secondaryKeywords.map((keyword) => ({ keyword })),
      }
      const strip = (rows: unknown) => (Array.isArray(rows) ? rows.map((row) => { const { id: _id, ...rest } = row as Record<string, unknown>; return rest }) : [])
      const previous = {
        meta: { title: full.meta?.title ?? null, description: full.meta?.description ?? null },
        shortDescription: full.shortDescription ?? null,
        description: full.description ?? null,
        objectives: strip(full.objectives), requirements: strip(full.requirements), whoItsFor: strip(full.whoItsFor),
        toolsCovered: strip(full.toolsCovered), careerPaths: strip(full.careerPaths), faq: strip(full.faq),
        primaryKeyword: full.primaryKeyword ?? null, secondaryKeywords: strip(full.secondaryKeywords),
      }
      const comparable = { ...next, meta: { title: copy.seoTitle, description: copy.metaDescription } }
      if (same(previous, comparable)) summary.programme = 'unchanged'
      else {
        summary.programme = 'updated'
        if (execute) {
          const history = [...strip(full.contentHistory), { savedAt: new Date().toISOString(), source: 'content:import', snapshot: previous }].slice(-20)
          await payload.update({ collection: 'courses', id: course.id, data: { ...next, contentHistory: history } as never, overrideAccess: true, context: { skipContentLint: true } })
        }
      }
    }
  }

  if (execute) await cacheDel(CACHE_KEYS.quizPool(course.id), CACHE_KEYS.curriculum(course.id))
  return summary
}

export function printSummary(summary: ImportSummary, execute: boolean): void {
  console.log(`\n### ${summary.slug}`)
  console.log(`  Questions: ${summary.added} ${execute ? 'added' : 'to add'}, ${summary.updated} ${execute ? 'updated' : 'to update'}, ${summary.unchanged} unchanged, ${summary.retired} ${execute ? 'retired' : 'to retire'}, ${summary.skipped} skipped (errors).`)
  if (summary.quizzesCreated.length) console.log(`  Quizzes ${execute ? 'created' : 'to create'} (${summary.quizzesCreated.length}):\n${summary.quizzesCreated.slice(0, 30).map((line) => `    - ${line}`).join('\n')}${summary.quizzesCreated.length > 30 ? '\n    …' : ''}`)
  if (summary.examPublished !== null) console.log(`  Final exam: ${summary.examPublished ? 'ready to publish' : 'pool too small, kept unpublished'}.`)
  console.log(`  Programme copy: ${summary.programme}.`)
  if (summary.errors.length) console.log(`  Errors (${summary.errors.length}):\n${summary.errors.slice(0, 50).map((line) => `    - ${line}`).join('\n')}`)
  if (summary.warnings.length) console.log(`  Warnings (${summary.warnings.length}):\n${summary.warnings.slice(0, 50).map((line) => `    - ${line}`).join('\n')}`)
}

async function run(): Promise<void> {
  const args = process.argv.slice(2)
  const execute = args.includes('--execute')
  const packsIndex = args.indexOf('--packs')
  const packsRoot = path.resolve(packsIndex >= 0 && args[packsIndex + 1] ? args[packsIndex + 1] as string : 'content/packs')
  const slugs: string[] = []
  args.forEach((arg, index) => { if (arg === '--course' && args[index + 1]) slugs.push((args[index + 1] as string).trim()) })
  if (args.includes('--all') && fs.existsSync(packsRoot)) for (const entry of fs.readdirSync(packsRoot, { withFileTypes: true })) if (entry.isDirectory() && !slugs.includes(entry.name)) slugs.push(entry.name)
  if (!slugs.length) {
    console.log('Usage: npm run content:import -- --course <slug> [--course ...] | --all [--execute] [--packs <dir>]')
    process.exit(1)
  }
  const { loadEnv } = await import('payload/node')
  const { getPayload } = await import('payload')
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  const toLexical = await markdownConverter(payload)
  console.log(execute ? 'IMPORTING: changes will be written.' : 'DRY RUN: nothing is written. Re-run with --execute to apply.')
  let failed = 0
  for (const slug of slugs) {
    const dir = path.join(packsRoot, slug)
    if (!fs.existsSync(dir)) { console.log(`\n### ${slug}: no pack at ${dir}`); failed++; continue }
    try {
      printSummary(await importPack(payload, slug, dir, execute, toLexical), execute)
    } catch (err) {
      failed++
      console.error(`\n### ${slug}: FAILED (${err instanceof Error ? err.message : String(err)})`)
    }
  }
  process.exit(failed ? 1 : 0)
}

if (process.argv[1] && /content-import\.(ts|js)$/.test(process.argv[1])) void run()
