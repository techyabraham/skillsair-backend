/**
 * Assessments, database side: start, resume, autosave, submit and expire attempts, and the
 * learner's assessment status per programme. All scoring happens here on the server; answers and
 * explanations never reach the client before a submit (and the final exam never reveals answers).
 */
import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { AppError } from '../types/index.js'
import { logger } from './logger.js'
import { courseCompletion, refreshEnrollmentProgress, relationId, requireCourseAccess } from './course-access.js'
import { attemptAllowance, attemptExpiry, drawQuestions, examSize, kindDefaults, optionOrder, scoreAttempt, toDisplayedIndexes, type QuizKind, type QuestionType } from './assessments.js'
import { issueCertificate } from '../hooks/courses/afterComplete.js'
import { CACHE_KEYS, cachedJson, courseCacheGeneration } from './cache.js'

const GRACE_MS = 30_000
const POOL_FOR_KIND: Record<QuizKind, string> = { knowledge_check: 'knowledge_check', chapter: 'chapter', final_exam: 'exam' }

interface QuizDoc {
  id: number
  title: string
  kind?: QuizKind | null
  course: unknown
  section?: unknown
  lesson?: unknown
  questions?: unknown[] | null
  passingScore?: number | null
  drawCount?: number | null
  timeLimitMinutes?: number | null
  maxAttempts?: number | null
  cooldownHours?: number | null
  shuffle?: boolean | null
  weightByChapter?: boolean | null
  isPublished?: boolean | null
}

interface QuestionDoc {
  id: number
  prompt: string
  type?: QuestionType | null
  options?: Array<{ text: string }> | null
  correctIndexes?: number[] | null
  correctIndex?: number | null
  explanation?: unknown
  section?: unknown
  lesson?: unknown
  sourceTimestamp?: string | null
  status?: string | null
}

export interface AttemptDoc {
  id: number
  student: unknown
  quiz: unknown
  status: 'in_progress' | 'submitted' | 'expired'
  attemptNumber?: number | null
  score?: number | null
  passed?: boolean | null
  answers?: Record<string, number[]> | null
  servedQuestionIds?: number[] | null
  servedOptionOrder?: Record<string, number[]> | null
  perSectionScores?: Array<{ sectionId: number | null; title?: string; correct: number; total: number; percent: number }> | null
  startedAt?: string | null
  expiresAt?: string | null
  submittedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface QuizSettings {
  kind: QuizKind
  passingScore: number
  drawCount: number | null
  timeLimitMinutes: number | null
  maxAttempts: number | null
  cooldownHours: number | null
  shuffle: boolean
}

const num = (value: unknown): number | null => (value === null || value === undefined || value === '' ? null : Number(value))

export function quizSettings(quiz: QuizDoc, courseSeconds = 0): QuizSettings {
  const kind = (quiz.kind ?? 'chapter') as QuizKind
  const defaults = kindDefaults(kind)
  const exam = kind === 'final_exam' ? examSize(courseSeconds) : null
  return {
    kind,
    passingScore: num(quiz.passingScore) ?? defaults.passingScore,
    drawCount: num(quiz.drawCount) ?? exam?.drawCount ?? defaults.drawCount,
    timeLimitMinutes: num(quiz.timeLimitMinutes) ?? exam?.timeLimitMinutes ?? defaults.timeLimitMinutes,
    maxAttempts: num(quiz.maxAttempts) ?? defaults.maxAttempts,
    cooldownHours: num(quiz.cooldownHours) ?? defaults.cooldownHours,
    shuffle: quiz.shuffle !== false,
  }
}

/** Plain text from a Lexical rich-text value (explanations). */
export function richTextToPlain(value: unknown): string {
  if (typeof value === 'string') return value
  const parts: string[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const current = node as { text?: unknown; children?: unknown[]; type?: string; root?: unknown }
    if (current.root) return visit(current.root)
    if (typeof current.text === 'string') parts.push(current.text)
    if (Array.isArray(current.children)) {
      current.children.forEach(visit)
      if (current.type === 'paragraph') parts.push('\n')
    }
  }
  visit(value)
  return parts.join('').replace(/\n{2,}/g, '\n').trim()
}

const correctOf = (question: QuestionDoc): number[] => {
  const list = (question.correctIndexes ?? []).map(Number).filter((n) => Number.isInteger(n))
  return list.length ? list : typeof question.correctIndex === 'number' ? [question.correctIndex] : []
}

async function loadQuiz(payload: Payload, quizId: number | string): Promise<QuizDoc> {
  const quiz = (await payload.findByID({ collection: 'quizzes', id: quizId, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as QuizDoc | null
  if (!quiz || !quiz.isPublished) throw new AppError('NOT_FOUND', 'Quiz not found')
  return quiz
}

async function courseSeconds(payload: Payload, courseId: number | string): Promise<number> {
  const course = await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true }).catch(() => null) as { totalDuration?: number | null } | null
  return Number(course?.totalDuration ?? 0)
}

/** Programme complete = every published lesson done and every chapter quiz passed. */
export async function programmeComplete(payload: Payload, userId: number | string, courseId: number | string): Promise<boolean> {
  const completion = await courseCompletion(payload, userId, courseId)
  return completion.total > 0 && completion.completed >= completion.total && completion.passedQuizzes >= completion.totalQuizzes
}

export async function findEntitlement(payload: Payload, userId: number | string, courseId: number | string) {
  const result = await payload.find({ collection: 'certificate-entitlements', where: { and: [{ student: { equals: userId } }, { course: { equals: courseId } }, { status: { not_equals: 'refunded' } }] }, sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })
  return result.docs[0] as unknown as { id: number; status: 'awaiting_exam' | 'passed'; order?: unknown } | undefined
}

async function previousAttempts(payload: Payload, userId: number | string, quizId: number | string): Promise<AttemptDoc[]> {
  const result = await payload.find({ collection: 'quiz-attempts', where: { and: [{ student: { equals: userId } }, { quiz: { equals: quizId } }] }, sort: 'createdAt', limit: 1000, depth: 0, overrideAccess: true })
  return result.docs as unknown as AttemptDoc[]
}

const endedAt = (attempt: AttemptDoc) => Date.parse(attempt.submittedAt ?? attempt.updatedAt ?? attempt.createdAt ?? new Date().toISOString())

function allowanceFor(settings: QuizSettings, attempts: AttemptDoc[], now: number) {
  return attemptAllowance(attempts.filter((attempt) => attempt.status !== 'in_progress').map((attempt) => ({ passed: Boolean(attempt.passed), endedAt: endedAt(attempt) })), settings, now)
}

/** Checks the learner may take this quiz at all (access, and for the exam: complete + paid). */
async function assertEligible(payload: Payload, userId: number, quiz: QuizDoc, courseId: number | string): Promise<void> {
  await requireCourseAccess(payload, userId, courseId)
  if ((quiz.kind ?? 'chapter') !== 'final_exam') return
  if (!(await programmeComplete(payload, userId, courseId))) throw new AppError('INSUFFICIENT_PERMISSION', 'Finish every lesson and chapter quiz first. The final exam opens after that, once your certificate is paid for.')
  const entitlement = await findEntitlement(payload, userId, courseId)
  if (!entitlement) throw new AppError('CERTIFICATE_PURCHASE_REQUIRED', 'Get your certificate first: your ₦10,000 covers your final exam (retakes included) and your certificate when you pass.')
  if (entitlement.status === 'passed') throw new AppError('ALREADY_EXISTS', "You've passed this exam and your certificate is ready.")
}

/** Approved questions this quiz draws from. */
async function questionPool(payload: Payload, quiz: QuizDoc, courseId: number | string): Promise<QuestionDoc[]> {
  const fixed = (quiz.questions ?? []).map(relationId).filter((id): id is number | string => id !== undefined)
  const kind = (quiz.kind ?? 'chapter') as QuizKind
  const where = fixed.length
    ? { and: [{ id: { in: fixed } }, { status: { equals: 'approved' } }] }
    : {
        and: [
          { course: { equals: courseId } },
          { status: { equals: 'approved' } },
          { pools: { contains: POOL_FOR_KIND[kind] } },
          ...(kind === 'chapter' && quiz.section ? [{ section: { equals: relationId(quiz.section) } }] : []),
          ...(kind === 'knowledge_check' && quiz.lesson ? [{ lesson: { equals: relationId(quiz.lesson) } }] : []),
        ],
      }
  // Cached per quiz for 10 minutes; question and quiz edits retire it (course cache generation).
  const key = `${CACHE_KEYS.quizPool(courseId)}:${await courseCacheGeneration(courseId)}:${quiz.id}`
  return cachedJson(key, 600, async () => (await payload.find({ collection: 'quiz-questions', where: where as never, limit: 5000, depth: 0, overrideAccess: true })).docs as unknown as QuestionDoc[])
}

/** Chapter lengths (seconds; lesson count when durations are missing) for weighting the exam. */
async function sectionWeights(payload: Payload, courseId: number | string): Promise<Map<number, number>> {
  const sections = await payload.find({ collection: 'sections', where: { course: { equals: courseId } }, limit: 1000, depth: 0, overrideAccess: true })
  const ids = sections.docs.map((section) => Number(section.id))
  const lessons = ids.length ? await payload.find({ collection: 'lessons', where: { and: [{ section: { in: ids } }, { isPublished: { equals: true } }] }, limit: 10000, depth: 0, overrideAccess: true }) : { docs: [] }
  const weights = new Map<number, number>()
  for (const lesson of lessons.docs as unknown as Array<{ section: unknown; duration?: number | null }>) {
    const sectionId = Number(relationId(lesson.section))
    weights.set(sectionId, (weights.get(sectionId) ?? 0) + (Number(lesson.duration ?? 0) || 60))
  }
  return weights
}

async function sectionTitles(payload: Payload, ids: Array<number | null>): Promise<Map<number, { title: string; firstLessonId: number | null }>> {
  const known = ids.filter((id): id is number => typeof id === 'number')
  const out = new Map<number, { title: string; firstLessonId: number | null }>()
  if (!known.length) return out
  const sections = await payload.find({ collection: 'sections', where: { id: { in: known } }, limit: 1000, depth: 0, overrideAccess: true })
  const lessons = await payload.find({ collection: 'lessons', where: { and: [{ section: { in: known } }, { isPublished: { equals: true } }] }, sort: 'order', limit: 10000, depth: 0, overrideAccess: true })
  for (const section of sections.docs as unknown as Array<{ id: number; title: string }>) {
    const first = (lessons.docs as unknown as Array<{ id: number; section: unknown }>).find((lesson) => Number(relationId(lesson.section)) === Number(section.id))
    out.set(Number(section.id), { title: section.title, firstLessonId: first ? Number(first.id) : null })
  }
  return out
}

/** What the client sees of an attempt in progress: questions in served order, options shuffled, no answers. */
async function servePayload(payload: Payload, attempt: AttemptDoc, quiz: QuizDoc, settings: QuizSettings, attemptsLeft: number | null) {
  const ids = attempt.servedQuestionIds ?? []
  const result = ids.length ? await payload.find({ collection: 'quiz-questions', where: { id: { in: ids } }, limit: ids.length, depth: 0, overrideAccess: true }) : { docs: [] }
  const byId = new Map((result.docs as unknown as QuestionDoc[]).map((question) => [Number(question.id), question]))
  const orders = attempt.servedOptionOrder ?? {}
  return {
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber ?? 1,
    attemptsLeft,
    status: attempt.status,
    quiz: { id: quiz.id, title: quiz.title, kind: settings.kind, passingScore: settings.passingScore, timeLimitMinutes: settings.timeLimitMinutes, questionCount: ids.length },
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt ?? null,
    serverTime: new Date().toISOString(),
    answers: attempt.answers ?? {},
    questions: ids.map((id) => byId.get(Number(id))).filter((question): question is QuestionDoc => Boolean(question)).map((question) => {
      const order = orders[String(question.id)] ?? (question.options ?? []).map((_, index) => index)
      return {
        id: question.id,
        type: question.type ?? 'single',
        prompt: question.prompt,
        options: order.map((index) => question.options?.[index]?.text ?? ''),
      }
    }),
  }
}

/** POST /api/quizzes/:quizId/start (or resume the attempt in progress). */
export async function startAttempt(payload: Payload, userId: number, quizId: number | string, now = Date.now()) {
  const quiz = await loadQuiz(payload, quizId)
  const courseId = relationId(quiz.course)
  if (courseId === undefined) throw new AppError('NOT_FOUND', 'Quiz course not found')
  await assertEligible(payload, userId, quiz, courseId)
  const settings = quizSettings(quiz, await courseSeconds(payload, courseId))
  let attempts = await previousAttempts(payload, userId, quiz.id)

  const open = attempts.find((attempt) => attempt.status === 'in_progress')
  if (open) {
    const expired = open.expiresAt && Date.parse(open.expiresAt) + GRACE_MS < now
    if (!expired) return servePayload(payload, open, quiz, settings, allowanceFor(settings, attempts, now).attemptsLeft)
    await finalizeAttempt(payload, open, quiz, settings, { expired: true, now })
    attempts = await previousAttempts(payload, userId, quiz.id)
  }

  const allowance = allowanceFor(settings, attempts, now)
  if (!allowance.allowed) {
    const opens = new Intl.DateTimeFormat('en-GB', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' }).format(new Date(allowance.opensAt ?? now))
    throw new AppError('QUIZ_COOLDOWN', `You've used this round of attempts. Your next attempt opens ${opens} (WAT).`, { opensAt: new Date(allowance.opensAt ?? now).toISOString() })
  }

  const pool = await questionPool(payload, quiz, courseId)
  if (!pool.length) throw new AppError('NOT_FOUND', 'This quiz has no questions yet.')
  const weights = settings.kind === 'final_exam' && quiz.weightByChapter !== false ? await sectionWeights(payload, courseId) : undefined
  const served = drawQuestions(pool.map((question) => ({ id: Number(question.id), sectionId: question.section ? Number(relationId(question.section)) : null })), settings.drawCount, { shuffle: settings.shuffle, sectionWeights: weights })
  const byId = new Map(pool.map((question) => [Number(question.id), question]))
  const orders: Record<string, number[]> = {}
  for (const id of served) {
    const question = byId.get(id)
    // True/false keeps True before False.
    orders[String(id)] = optionOrder(question?.options?.length ?? 0, Math.random, settings.shuffle && question?.type !== 'true_false')
  }
  const user = await payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true }) as unknown as { examTimeMultiplier?: number | null }
  const expiresAt = attemptExpiry(now, settings.timeLimitMinutes, Number(user.examTimeMultiplier ?? 1))
  let attempt: AttemptDoc
  try {
    attempt = await payload.create({
      collection: 'quiz-attempts',
      data: {
        student: userId,
        quiz: quiz.id,
        status: 'in_progress',
        attemptNumber: attempts.filter((item) => item.status !== 'in_progress').length + 1,
        servedQuestionIds: served,
        servedOptionOrder: orders,
        answers: {},
        startedAt: new Date(now).toISOString(),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      } as never,
      overrideAccess: true,
    }) as unknown as AttemptDoc
  } catch (err) {
    // Two tabs started at once: the unique index allows one; return that one.
    const existing = (await previousAttempts(payload, userId, quiz.id)).find((item) => item.status === 'in_progress')
    if (!existing) throw err
    attempt = existing
  }
  await bumpServed(payload, served)
  return servePayload(payload, attempt, quiz, settings, allowance.attemptsLeft)
}

async function bumpServed(payload: Payload, ids: number[]): Promise<void> {
  if (!ids.length) return
  try {
    const db = payload.db as unknown as { drizzle: { execute: (query: unknown) => Promise<unknown> } }
    await db.drizzle.execute(sql`UPDATE "quiz_questions" SET "stats_times_served" = COALESCE("stats_times_served", 0) + 1 WHERE "id" IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
  } catch (err) {
    logger.warn({ err }, 'quiz_stats_served_failed')
  }
}

async function loadOwnAttempt(payload: Payload, userId: number, attemptId: number | string): Promise<AttemptDoc> {
  const attempt = await payload.findByID({ collection: 'quiz-attempts', id: attemptId, depth: 0, overrideAccess: true }).catch(() => null) as unknown as AttemptDoc | null
  if (!attempt || String(relationId(attempt.student)) !== String(userId)) throw new AppError('NOT_FOUND', 'Attempt not found')
  return attempt
}

function cleanAnswers(attempt: AttemptDoc, answers: Record<string, unknown>): Record<string, number[]> {
  const allowed = new Set((attempt.servedQuestionIds ?? []).map(String))
  const out: Record<string, number[]> = { ...(attempt.answers ?? {}) }
  for (const [questionId, value] of Object.entries(answers ?? {})) {
    if (!allowed.has(questionId)) continue
    const list = (Array.isArray(value) ? value : [value]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 10)
    out[questionId] = [...new Set(list)]
  }
  return out
}

/** PUT /api/quiz-attempts/:id/answers: autosave while the attempt is open. */
export async function saveAnswers(payload: Payload, userId: number, attemptId: number | string, answers: Record<string, unknown>, now = Date.now()) {
  const attempt = await loadOwnAttempt(payload, userId, attemptId)
  if (attempt.status !== 'in_progress') throw new AppError('QUIZ_CLOSED', 'This attempt has already been submitted.')
  if (attempt.expiresAt && Date.parse(attempt.expiresAt) + GRACE_MS < now) throw new AppError('QUIZ_CLOSED', "Time's up for this attempt; it has been submitted with your saved answers.")
  const merged = cleanAnswers(attempt, answers)
  await payload.update({ collection: 'quiz-attempts', id: attempt.id, data: { answers: merged } as never, overrideAccess: true })
  return { saved: true, savedAt: new Date(now).toISOString(), answered: Object.values(merged).filter((list) => list.length).length }
}

/** POST /api/quiz-attempts/:id/submit (idempotent: a submitted attempt returns its stored result). */
export async function submitAttempt(payload: Payload, userId: number, attemptId: number | string, answers: Record<string, unknown> | undefined, now = Date.now()) {
  const attempt = await loadOwnAttempt(payload, userId, attemptId)
  const quiz = await loadQuiz(payload, relationId(attempt.quiz) as number)
  const courseId = relationId(quiz.course) as number
  const settings = quizSettings(quiz, await courseSeconds(payload, courseId))
  if (attempt.status !== 'in_progress') return resultPayload(payload, attempt, quiz, settings, now)
  const late = attempt.expiresAt && Date.parse(attempt.expiresAt) + GRACE_MS < now
  if (answers && !late) attempt.answers = cleanAnswers(attempt, answers)
  const finished = await finalizeAttempt(payload, attempt, quiz, settings, { expired: Boolean(late), now })
  return resultPayload(payload, finished, quiz, settings, now)
}

/** Scores and closes an attempt, then runs what passing unlocks. */
async function finalizeAttempt(payload: Payload, attempt: AttemptDoc, quiz: QuizDoc, settings: QuizSettings, options: { expired: boolean; now: number }): Promise<AttemptDoc> {
  const ids = attempt.servedQuestionIds ?? []
  const result = ids.length ? await payload.find({ collection: 'quiz-questions', where: { id: { in: ids } }, limit: ids.length, depth: 0, overrideAccess: true }) : { docs: [] }
  const questions = (result.docs as unknown as QuestionDoc[]).map((question) => ({
    id: Number(question.id),
    type: (question.type ?? 'single') as QuestionType,
    sectionId: question.section ? Number(relationId(question.section)) : null,
    optionCount: question.options?.length ?? 0,
    correctIndexes: correctOf(question),
  }))
  const scored = scoreAttempt(questions, attempt.answers ?? {}, attempt.servedOptionOrder ?? {})
  const titles = await sectionTitles(payload, scored.perSection.map((section) => section.sectionId))
  const passed = settings.kind === 'knowledge_check' ? true : scored.score >= settings.passingScore
  const updated = await payload.update({
    collection: 'quiz-attempts',
    id: attempt.id,
    data: {
      status: options.expired ? 'expired' : 'submitted',
      score: scored.score,
      passed,
      answers: attempt.answers ?? {},
      submittedAt: new Date(options.now).toISOString(),
      perSectionScores: scored.perSection.map((section) => ({ ...section, title: section.sectionId ? titles.get(section.sectionId)?.title ?? '' : '' })),
    } as never,
    overrideAccess: true,
  }) as unknown as AttemptDoc

  const userId = relationId(attempt.student) as number
  const courseId = relationId(quiz.course) as number
  try {
    if (settings.kind === 'chapter' && passed) {
      const enrollments = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: userId } }, { course: { equals: courseId } }, { status: { not_equals: 'refunded' } }] }, limit: 1, overrideAccess: true })
      if (enrollments.docs[0]) await refreshEnrollmentProgress(payload, enrollments.docs[0].id, userId, courseId)
    }
    if (settings.kind === 'final_exam' && passed) await completeCertificate(payload, userId, courseId, scored.score)
  } catch (err) {
    logger.error({ err, attemptId: attempt.id }, 'assessment_after_pass_failed')
  }
  return updated
}

/** Passing the final exam: entitlement passed, certificate issued (with the result band, T9 email). */
async function completeCertificate(payload: Payload, userId: number, courseId: number, score: number): Promise<void> {
  const entitlement = await findEntitlement(payload, userId, courseId)
  if (!entitlement || entitlement.status === 'passed') return
  const order = entitlement.order ? await payload.findByID({ collection: 'orders', id: relationId(entitlement.order) as number, depth: 0, overrideAccess: true }).catch(() => null) as { reference?: string; amount?: number; paidAt?: string } | null : null
  // Certificate first; the entitlement is marked passed only once it exists (a failure is retried by the job).
  await issueCertificate(payload, userId, courseId, order?.reference ? { reference: order.reference, amount: Number(order.amount ?? 0), paidAt: String(order.paidAt ?? new Date().toISOString()) } : undefined, { score })
  await payload.update({ collection: 'certificate-entitlements', id: entitlement.id, data: { status: 'passed', passedAt: new Date().toISOString() }, overrideAccess: true })
}

/** The result shown after submitting. Chapter quizzes and knowledge checks explain each answer; the exam never reveals answers. */
async function resultPayload(payload: Payload, attempt: AttemptDoc, quiz: QuizDoc, settings: QuizSettings, now: number) {
  const userId = relationId(attempt.student) as number
  const attempts = await previousAttempts(payload, userId, quiz.id)
  const allowance = allowanceFor(settings, attempts, now)
  const sections = (attempt.perSectionScores ?? []) as NonNullable<AttemptDoc['perSectionScores']>
  const titles = await sectionTitles(payload, sections.map((section) => section.sectionId))
  const base = {
    attemptId: attempt.id,
    status: attempt.status,
    quiz: { id: quiz.id, title: quiz.title, kind: settings.kind, passingScore: settings.passingScore },
    score: attempt.score ?? 0,
    passed: Boolean(attempt.passed),
    attemptsLeft: allowance.attemptsLeft,
    nextAttemptAt: allowance.opensAt ? new Date(allowance.opensAt).toISOString() : null,
    perSection: sections.map((section) => ({ ...section, title: section.title || (section.sectionId ? titles.get(section.sectionId)?.title ?? '' : ''), firstLessonId: section.sectionId ? titles.get(section.sectionId)?.firstLessonId ?? null : null })),
  }
  const review = base.perSection.filter((section) => section.percent < settings.passingScore)
  if (settings.kind === 'final_exam') {
    const certificate = attempt.passed ? await payload.find({ collection: 'certificates', where: { and: [{ student: { equals: userId } }, { course: { equals: relationId(quiz.course) } }] }, limit: 1, depth: 0, overrideAccess: true }) : null
    const cert = certificate?.docs[0] as unknown as { id: number; certificateCode: string; pdfUrl: string; scoreBand?: string } | undefined
    return { ...base, chaptersToReview: review, certificate: cert ? { id: cert.id, code: cert.certificateCode, pdfUrl: cert.pdfUrl, scoreBand: cert.scoreBand ?? 'passed' } : null }
  }
  // Explanations and correct answers (in the order the learner saw the options).
  const ids = attempt.servedQuestionIds ?? []
  const result = ids.length ? await payload.find({ collection: 'quiz-questions', where: { id: { in: ids } }, limit: ids.length, depth: 0, overrideAccess: true }) : { docs: [] }
  const byId = new Map((result.docs as unknown as QuestionDoc[]).map((question) => [Number(question.id), question]))
  const orders = attempt.servedOptionOrder ?? {}
  const answers = attempt.answers ?? {}
  return {
    ...base,
    chaptersToReview: review,
    feedback: ids.map((id) => byId.get(Number(id))).filter((question): question is QuestionDoc => Boolean(question)).map((question) => {
      const order = orders[String(question.id)]
      const correctShown = toDisplayedIndexes(correctOf(question), order)
      const chosen = [...(answers[String(question.id)] ?? [])].sort((a, b) => a - b)
      return {
        questionId: question.id,
        correct: chosen.length === correctShown.length && chosen.every((value, index) => value === correctShown[index]),
        chosen,
        correctOptions: correctShown,
        explanation: richTextToPlain(question.explanation),
        lessonId: question.lesson ? Number(relationId(question.lesson)) : null,
        sourceTimestamp: question.sourceTimestamp ?? null,
      }
    }),
  }
}

/** Job: closes timed attempts whose time ran out (the learner's saved answers are scored). */
export async function sweepExpiredAttempts(payload: Payload, now = Date.now()): Promise<number> {
  const due = await payload.find({ collection: 'quiz-attempts', where: { and: [{ status: { equals: 'in_progress' } }, { expiresAt: { less_than: new Date(now - GRACE_MS).toISOString() } }] }, limit: 500, depth: 0, overrideAccess: true })
  let closed = 0
  for (const attempt of due.docs as unknown as AttemptDoc[]) {
    try {
      const quiz = await loadQuiz(payload, relationId(attempt.quiz) as number)
      const settings = quizSettings(quiz, await courseSeconds(payload, relationId(quiz.course) as number))
      await finalizeAttempt(payload, attempt, quiz, settings, { expired: true, now })
      closed++
    } catch (err) {
      logger.error({ err, attemptId: attempt.id }, 'quiz_expiry_sweep_failed')
    }
  }
  return closed
}

/** The learner's assessments for a programme: chapter quizzes, knowledge checks and the final exam. */
export async function courseAssessments(payload: Payload, userId: number, courseId: number | string, now = Date.now()) {
  await requireCourseAccess(payload, userId, courseId)
  const quizzes = (await payload.find({ collection: 'quizzes', where: { and: [{ course: { equals: courseId } }, { isPublished: { equals: true } }] }, limit: 1000, depth: 0, overrideAccess: true })).docs as unknown as QuizDoc[]
  const quizIds = quizzes.map((quiz) => quiz.id)
  const attempts = quizIds.length ? (await payload.find({ collection: 'quiz-attempts', where: { and: [{ student: { equals: userId } }, { quiz: { in: quizIds } }] }, sort: 'createdAt', limit: 5000, depth: 0, overrideAccess: true })).docs as unknown as AttemptDoc[] : []
  const seconds = await courseSeconds(payload, courseId)
  const complete = await programmeComplete(payload, userId, courseId)
  const entitlement = await findEntitlement(payload, userId, courseId)
  return {
    complete,
    certificate: entitlement ? { status: entitlement.status } : null,
    quizzes: quizzes.map((quiz) => {
      const settings = quizSettings(quiz, seconds)
      const mine = attempts.filter((attempt) => String(relationId(attempt.quiz)) === String(quiz.id))
      const allowance = allowanceFor(settings, mine, now)
      const finished = mine.filter((attempt) => attempt.status !== 'in_progress')
      const best = finished.reduce<number | null>((max, attempt) => (max === null || (attempt.score ?? 0) > max ? attempt.score ?? 0 : max), null)
      const examLock = settings.kind !== 'final_exam' ? null : !complete ? 'finish_programme' : !entitlement ? 'buy_certificate' : entitlement.status === 'passed' ? 'passed' : null
      return {
        id: quiz.id,
        title: quiz.title,
        kind: settings.kind,
        sectionId: quiz.section ? Number(relationId(quiz.section)) : null,
        lessonId: quiz.lesson ? Number(relationId(quiz.lesson)) : null,
        passingScore: settings.passingScore,
        drawCount: settings.drawCount,
        timeLimitMinutes: settings.timeLimitMinutes,
        maxAttempts: settings.maxAttempts,
        passed: allowance.alreadyPassed,
        bestScore: best,
        attempts: finished.length,
        attemptsLeft: allowance.attemptsLeft,
        nextAttemptAt: allowance.opensAt ? new Date(allowance.opensAt).toISOString() : null,
        inProgress: mine.some((attempt) => attempt.status === 'in_progress' && !(attempt.expiresAt && Date.parse(attempt.expiresAt) + GRACE_MS < now)),
        locked: examLock,
      }
    }),
  }
}

/** Job: learners who passed the final exam but whose certificate failed to issue (e.g. storage was down). */
export async function retryPendingCertificates(payload: Payload): Promise<number> {
  const waiting = await payload.find({ collection: 'certificate-entitlements', where: { status: { equals: 'awaiting_exam' } }, limit: 500, depth: 0, overrideAccess: true })
  let issued = 0
  for (const entitlement of waiting.docs as unknown as Array<{ student: unknown; course: unknown }>) {
    const userId = Number(relationId(entitlement.student))
    const courseId = Number(relationId(entitlement.course))
    const exams = await payload.find({ collection: 'quizzes', where: { and: [{ course: { equals: courseId } }, { kind: { equals: 'final_exam' } }] }, limit: 5, depth: 0, overrideAccess: true })
    if (!exams.totalDocs) continue
    const pass = await payload.find({ collection: 'quiz-attempts', where: { and: [{ student: { equals: userId } }, { quiz: { in: exams.docs.map((exam) => exam.id) } }, { passed: { equals: true } }] }, sort: '-score', limit: 1, depth: 0, overrideAccess: true })
    const best = pass.docs[0] as unknown as { score?: number } | undefined
    if (!best) continue
    try {
      await completeCertificate(payload, userId, courseId, Number(best.score ?? 0))
      issued++
    } catch (err) {
      logger.error({ err, userId, courseId }, 'certificate_retry_failed')
    }
  }
  return issued
}
