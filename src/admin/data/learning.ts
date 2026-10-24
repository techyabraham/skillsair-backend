/**
 * Studio data for learning quality: a programme's checklist (copy lint, quizzes, exam, captions),
 * the question bank, and the learning items in Overview's "Needs attention". Server only.
 */
import type { Payload } from 'payload'
import { copyFromCourse, lintProgrammeCopy, type LintIssue } from '../../lib/content-lint.js'
import { itemFlags, type ItemFlag } from '../../lib/item-analysis.js'
import { richTextToPlain } from '../../lib/assessment-service.js'
import { queueStatus } from '../../lib/work-queue.js'
import { examSize } from '../../lib/assessments.js'

const rel = (value: unknown): number | null => (value && typeof value === 'object' ? Number((value as { id: number }).id) : value === null || value === undefined ? null : Number(value))

export interface ProgrammeHealth {
  lint: { errors: LintIssue[]; warnings: LintIssue[]; managed: boolean }
  counts: { objectives: number; requirements: number; faq: number }
  chapters: number
  chapterQuizzes: { published: number; missing: string[] }
  finalExam: { exists: boolean; published: boolean; pool: number; needed: number }
  captions: { lessons: number; withCaptions: number; percent: number; missing: string[] }
  questions: { approved: number; draft: number; retired: number; flagged: number }
}

export async function programmeHealth(payload: Payload, courseId: number | string): Promise<ProgrammeHealth> {
  const course = await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true }) as unknown as Record<string, unknown> & { primaryKeyword?: string | null; totalDuration?: number | null; isBonus?: boolean | null }
  const issues = lintProgrammeCopy(copyFromCourse(course))
  const sections = (await payload.find({ collection: 'sections', where: { course: { equals: courseId } }, sort: 'order', limit: 1000, depth: 0, overrideAccess: true })).docs as unknown as Array<{ id: number; title: string }>
  const lessons = sections.length ? (await payload.find({ collection: 'lessons', where: { and: [{ section: { in: sections.map((s) => s.id) } }, { isPublished: { equals: true } }] }, limit: 10000, depth: 0, overrideAccess: true, select: { title: true, section: true, driveFileId: true, hasCaptions: true } as never })).docs as unknown as Array<{ id: number; title: string; section: unknown; driveFileId?: string | null; hasCaptions?: boolean | null }> : []
  const quizzes = (await payload.find({ collection: 'quizzes', where: { course: { equals: courseId } }, limit: 5000, depth: 0, overrideAccess: true })).docs as unknown as Array<{ kind?: string; section?: unknown; isPublished?: boolean }>
  const questions = (await payload.find({ collection: 'quiz-questions', where: { course: { equals: courseId } }, limit: 20000, depth: 0, overrideAccess: true, select: { status: true, pools: true, stats: true } as never })).docs as unknown as Array<{ status?: string; pools?: string[] | null; stats?: { timesServed?: number; pValue?: number; discrimination?: number } | null }>
  const sectionsWithLessons = sections.filter((section) => lessons.some((lesson) => rel(lesson.section) === section.id))
  const publishedChapterQuiz = new Set(quizzes.filter((quiz) => quiz.kind === 'chapter' && quiz.isPublished).map((quiz) => rel(quiz.section)))
  const exam = quizzes.find((quiz) => quiz.kind === 'final_exam')
  const video = lessons.filter((lesson) => lesson.driveFileId)
  const withCaptions = video.filter((lesson) => lesson.hasCaptions)
  const approved = questions.filter((q) => q.status === 'approved')
  return {
    lint: { errors: issues.filter((issue) => issue.level === 'error'), warnings: issues.filter((issue) => issue.level === 'warning'), managed: Boolean(course.primaryKeyword) },
    counts: { objectives: Array.isArray(course.objectives) ? course.objectives.length : 0, requirements: Array.isArray(course.requirements) ? course.requirements.length : 0, faq: Array.isArray(course.faq) ? course.faq.length : 0 },
    chapters: sectionsWithLessons.length,
    chapterQuizzes: { published: sectionsWithLessons.filter((section) => publishedChapterQuiz.has(section.id)).length, missing: sectionsWithLessons.filter((section) => !publishedChapterQuiz.has(section.id)).map((section) => section.title) },
    finalExam: { exists: Boolean(exam), published: Boolean(exam?.isPublished), pool: approved.filter((q) => (q.pools ?? []).includes('exam')).length, needed: course.isBonus ? 0 : Math.ceil(examSize(Number(course.totalDuration ?? 0)).drawCount * 2.5) },
    captions: { lessons: video.length, withCaptions: withCaptions.length, percent: video.length ? Math.round((withCaptions.length / video.length) * 100) : 0, missing: video.filter((lesson) => !lesson.hasCaptions).map((lesson) => lesson.title) },
    questions: {
      approved: approved.length,
      draft: questions.filter((q) => q.status === 'draft').length,
      retired: questions.filter((q) => q.status === 'retired').length,
      flagged: approved.filter((q) => itemFlags({ timesServed: q.stats?.timesServed, pValue: q.stats?.pValue, discrimination: q.stats?.discrimination }).length > 0).length,
    },
  }
}

export interface BankQuestion {
  id: number
  prompt: string
  type: string
  options: string[]
  correct: number[]
  explanation: string
  status: string
  pools: string[]
  sectionId: number | null
  lessonId: number | null
  lessonTitle: string | null
  sourceTimestamp: string | null
  flags: ItemFlag[]
  stats: { timesServed: number; pValue: number | null; discrimination: number | null }
}

export interface QuestionBank {
  course: { id: number; title: string; slug: string }
  chapters: Array<{ id: number; title: string; order: number; approved: number; draft: number; chapterPool: number; examPool: number; needed: number }>
  questions: BankQuestion[]
  checks: string[]
}

/** The question bank for one programme (admins and instructors). */
export async function questionBank(payload: Payload, courseId: number | string): Promise<QuestionBank> {
  const course = await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true }) as unknown as { id: number; title: string; slug: string; totalDuration?: number | null; isBonus?: boolean | null }
  const sections = (await payload.find({ collection: 'sections', where: { course: { equals: courseId } }, sort: 'order', limit: 1000, depth: 0, overrideAccess: true })).docs as unknown as Array<{ id: number; title: string; order: number }>
  const lessons = sections.length ? (await payload.find({ collection: 'lessons', where: { section: { in: sections.map((s) => s.id) } }, limit: 10000, depth: 0, overrideAccess: true, select: { title: true } as never })).docs as unknown as Array<{ id: number; title: string }> : []
  const lessonTitle = new Map(lessons.map((lesson) => [Number(lesson.id), lesson.title]))
  const docs = (await payload.find({ collection: 'quiz-questions', where: { course: { equals: courseId } }, sort: 'createdAt', limit: 20000, depth: 0, overrideAccess: true })).docs as unknown as Array<Record<string, unknown> & { id: number; prompt: string; options?: Array<{ text: string }>; correctIndexes?: number[]; pools?: string[]; stats?: { timesServed?: number; pValue?: number; discrimination?: number } }>
  const questions: BankQuestion[] = docs.map((doc) => {
    const stats = { timesServed: Number(doc.stats?.timesServed ?? 0), pValue: doc.stats?.pValue ?? null, discrimination: doc.stats?.discrimination ?? null }
    return {
      id: Number(doc.id),
      prompt: doc.prompt,
      type: String(doc.type ?? 'single'),
      options: (doc.options ?? []).map((option) => option.text),
      correct: (doc.correctIndexes ?? []).map(Number),
      explanation: richTextToPlain(doc.explanation),
      status: String(doc.status ?? 'draft'),
      pools: doc.pools ?? [],
      sectionId: rel(doc.section),
      lessonId: rel(doc.lesson),
      lessonTitle: rel(doc.lesson) ? lessonTitle.get(rel(doc.lesson) as number) ?? null : null,
      sourceTimestamp: (doc.sourceTimestamp as string | null) ?? null,
      flags: itemFlags({ timesServed: stats.timesServed, pValue: stats.pValue, discrimination: stats.discrimination }),
      stats,
    }
  })
  const exam = examSize(Number(course.totalDuration ?? 0))
  const chapters = sections.map((section) => {
    const mine = questions.filter((q) => q.sectionId === section.id)
    const approved = mine.filter((q) => q.status === 'approved')
    return {
      id: section.id,
      title: section.title,
      order: section.order,
      approved: approved.length,
      draft: mine.filter((q) => q.status === 'draft').length,
      chapterPool: approved.filter((q) => q.pools.includes('chapter')).length,
      examPool: approved.filter((q) => q.pools.includes('exam')).length,
      needed: Math.max(0, 12 - approved.filter((q) => q.pools.includes('chapter')).length),
    }
  })
  const checks: string[] = []
  for (const chapter of chapters) if (chapter.chapterPool > 0 && chapter.chapterPool < 12) checks.push(`${chapter.title}: ${chapter.chapterPool} approved chapter-quiz questions (at least 12).`)
  if (!course.isBonus) {
    const examPool = chapters.reduce((sum, chapter) => sum + chapter.examPool, 0)
    if (examPool && examPool < exam.drawCount * 2.5) checks.push(`Final exam: ${examPool} approved exam questions (at least ${Math.ceil(exam.drawCount * 2.5)}).`)
    const uncovered = chapters.filter((chapter) => chapter.approved > 0 && chapter.examPool === 0)
    if (examPool && uncovered.length) checks.push(`Final exam pool doesn't cover: ${uncovered.map((chapter) => chapter.title).join(', ')}.`)
  }
  return { course: { id: course.id, title: course.title, slug: course.slug }, chapters, questions, checks }
}

export interface LearningAttention {
  flaggedQuestions: Array<{ courseId: number; title: string; count: number }>
  missingSubtitles: Array<{ courseId: number; title: string; count: number; total: number }>
  lintErrors: Array<{ courseId: number; title: string; count: number }>
  deadTasks: number
}

/** Overview's "Needs attention" learning items. */
export async function learningAttention(payload: Payload): Promise<LearningAttention> {
  const courses = (await payload.find({ collection: 'courses', where: { status: { equals: 'published' } }, limit: 200, depth: 0, overrideAccess: true })).docs as unknown as Array<Record<string, unknown> & { id: number; title: string; primaryKeyword?: string | null }>
  const flaggedQuestions: LearningAttention['flaggedQuestions'] = []
  const missingSubtitles: LearningAttention['missingSubtitles'] = []
  const lintErrors: LearningAttention['lintErrors'] = []
  for (const course of courses) {
    const health = await programmeHealth(payload, course.id)
    if (health.questions.flagged) flaggedQuestions.push({ courseId: course.id, title: course.title, count: health.questions.flagged })
    if (health.captions.lessons && health.captions.missing.length) missingSubtitles.push({ courseId: course.id, title: course.title, count: health.captions.missing.length, total: health.captions.lessons })
    if (health.lint.managed && health.lint.errors.length) lintErrors.push({ courseId: course.id, title: course.title, count: health.lint.errors.length })
  }
  return { flaggedQuestions, missingSubtitles, lintErrors, deadTasks: (await queueStatus()).dead.length }
}
