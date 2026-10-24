/**
 * Integration test (local database only): the whole learning-to-certificate journey.
 *   complete lessons -> pass chapter quizzes -> exam refused (CERTIFICATE_PURCHASE_REQUIRED)
 *   -> pay for the certificate -> exam unlocks (T12) -> fail 3 times -> cooldown -> 48h later
 *   pass with no further payment -> certificate issued with its band (T9) -> timer expiry sweep.
 * Uses fake time for the cooldown. Needs a programme with a published final exam (import a pack first).
 *
 * Usage: node --loader ts-node/esm scripts/test-assessment-flow.ts --yes-local <course-slug>
 */
import assert from 'node:assert/strict'

if (!process.argv.includes('--yes-local') || !/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URI ?? '')) {
  console.error('Refusing to run: local database only (pass --yes-local with a localhost DATABASE_URI).')
  process.exit(1)
}
const slug = process.argv.filter((arg) => !arg.startsWith('--')).slice(2)[0] ?? 'cybersecurity'
const { getPayload } = await import('payload')
const { default: config } = await import('../payload.config.js')
const payload = await getPayload({ config })
;(payload.db as unknown as { beginTransaction: () => Promise<null> }).beginTransaction = async () => null
const svc = await import('../src/lib/assessment-service.js')
const { fulfillOrder } = await import('../src/lib/order-fulfillment.js')
const { relationId } = await import('../src/lib/course-access.js')
const { toDisplayedIndexes } = await import('../src/lib/assessments.js')

const step = (label: string) => console.log(`✔ ${label}`)
const course = (await payload.find({ collection: 'courses', where: { slug: { equals: slug } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as { id: number; title: string }
assert.ok(course, `no programme ${slug}`)

// A fresh learner with a paid one-off enrolment.
const email = `flow-${Date.now()}@example.com`
const user = await payload.create({ collection: 'users', data: { email, password: 'Flow-Test-Local-2026!', firstName: 'Flow', lastName: 'Tester', role: 'student', isVerified: true, phone: '+2348000000777' } as never, overrideAccess: true, context: { skipWelcomeEmail: true } }) as unknown as { id: number }
const courseOrder = await payload.create({ collection: 'orders', data: { user: user.id, type: 'course', course: course.id, amount: 101625, currency: 'NGN', status: 'success', reference: `FLOW-C-${Date.now()}`, paidAt: new Date().toISOString() } as never, overrideAccess: true })
await fulfillOrder(payload, courseOrder.id)
step('learner enrolled')

// Every published lesson complete.
const sections = (await payload.find({ collection: 'sections', where: { course: { equals: course.id } }, limit: 1000, depth: 0, overrideAccess: true })).docs
const lessons = (await payload.find({ collection: 'lessons', where: { and: [{ section: { in: sections.map((s) => s.id) } }, { isPublished: { equals: true } }] }, limit: 10000, depth: 0, overrideAccess: true })).docs
for (const lesson of lessons) await payload.create({ collection: 'lesson-progress', data: { student: user.id, lesson: lesson.id, course: course.id, isCompleted: true, completedAt: new Date().toISOString() } as never, overrideAccess: true })
step(`${lessons.length} lessons completed`)

/** Answers an attempt: all right, or all wrong. */
async function answerAll(attemptId: number, right: boolean): Promise<Record<string, number[]>> {
  const attempt = await payload.findByID({ collection: 'quiz-attempts', id: attemptId, depth: 0, overrideAccess: true }) as unknown as { servedQuestionIds: number[]; servedOptionOrder: Record<string, number[]> }
  const answers: Record<string, number[]> = {}
  for (const id of attempt.servedQuestionIds) {
    const q = await payload.findByID({ collection: 'quiz-questions', id, depth: 0, overrideAccess: true }) as unknown as { correctIndexes: number[]; options: unknown[] }
    const shown = toDisplayedIndexes(q.correctIndexes.map(Number), attempt.servedOptionOrder[String(id)])
    answers[String(id)] = right ? shown : [Array.from({ length: q.options.length }, (_, i) => i).find((i) => !shown.includes(i)) ?? 0]
  }
  return answers
}

// Chapter quizzes: one fail (with explanations), then a pass.
const quizzes = (await payload.find({ collection: 'quizzes', where: { and: [{ course: { equals: course.id } }, { isPublished: { equals: true } }] }, limit: 1000, depth: 0, overrideAccess: true })).docs as unknown as Array<{ id: number; kind: string }>
const chapterQuizzes = quizzes.filter((quiz) => quiz.kind === 'chapter')
assert.ok(chapterQuizzes.length > 0, 'no chapter quizzes')
let first = true
for (const quiz of chapterQuizzes) {
  if (first) {
    const started = await svc.startAttempt(payload, user.id, quiz.id)
    assert.ok(started.questions.length >= 8, 'chapter quiz draws 8–12 questions')
    assert.ok(!JSON.stringify(started).includes('correctIndex'), 'no answers in the start payload')
    const failed = await svc.submitAttempt(payload, user.id, started.attemptId, await answerAll(started.attemptId, false)) as { passed: boolean; feedback?: Array<{ explanation: string }> }
    assert.equal(failed.passed, false)
    assert.ok(failed.feedback?.[0]?.explanation, 'chapter quiz shows explanations after submit')
    first = false
  }
  const started = await svc.startAttempt(payload, user.id, quiz.id)
  const result = await svc.submitAttempt(payload, user.id, started.attemptId, await answerAll(started.attemptId, true))
  assert.equal(result.passed, true, `chapter quiz ${quiz.id} should pass`)
}
step(`${chapterQuizzes.length} chapter quizzes passed (one failed attempt first, with explanations)`)
assert.ok(await svc.programmeComplete(payload, user.id, course.id), 'programme complete')
const enrolment = (await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: user.id } }, { course: { equals: course.id } }] }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as { status: string }
assert.equal(enrolment.status, 'completed')
step('programme complete (enrolment marked completed)')

// The exam needs the certificate paid for.
const exam = quizzes.find((quiz) => quiz.kind === 'final_exam')
assert.ok(exam, 'no published final exam')
await assert.rejects(() => svc.startAttempt(payload, user.id, exam.id), (err: { code?: string }) => err.code === 'CERTIFICATE_PURCHASE_REQUIRED')
step('exam without a paid certificate: CERTIFICATE_PURCHASE_REQUIRED')

const certOrder = await payload.create({ collection: 'orders', data: { user: user.id, type: 'certificate', course: course.id, amount: 10000, currency: 'NGN', status: 'success', reference: `FLOW-X-${Date.now()}`, paidAt: new Date().toISOString() } as never, overrideAccess: true })
await fulfillOrder(payload, certOrder.id)
const entitlement = await svc.findEntitlement(payload, user.id, course.id)
assert.equal(entitlement?.status, 'awaiting_exam')
assert.equal((await payload.count({ collection: 'certificates', where: { student: { equals: user.id } }, overrideAccess: true })).totalDocs, 0, 'no certificate before the exam')
step('certificate paid: entitlement awaiting exam, no certificate yet')

// Three fails, then the cooldown.
const t0 = Date.now()
for (let i = 0; i < 3; i++) {
  const started = await svc.startAttempt(payload, user.id, exam.id, t0 + i * 1000)
  assert.ok(started.expiresAt, 'exam is timed')
  assert.ok([30, 40].includes(started.questions.length), `exam draws 30 or 40 questions (got ${started.questions.length})`)
  const result = await svc.submitAttempt(payload, user.id, started.attemptId, await answerAll(started.attemptId, false), t0 + i * 1000 + 500) as { passed: boolean; feedback?: unknown; chaptersToReview: unknown[] }
  assert.equal(result.passed, false)
  assert.equal(result.feedback, undefined, 'the exam never reveals answers')
  assert.ok(result.chaptersToReview.length > 0)
}
await assert.rejects(() => svc.startAttempt(payload, user.id, exam.id, t0 + 60_000), (err: { code?: string }) => err.code === 'QUIZ_COOLDOWN')
step('3 failed exam attempts, then a 48-hour cooldown')

// 49 hours later: attempt 4 passes, with no further payment.
const later = t0 + 49 * 3_600_000
const started = await svc.startAttempt(payload, user.id, exam.id, later)
const passed = await svc.submitAttempt(payload, user.id, started.attemptId, await answerAll(started.attemptId, true), later + 1000) as { passed: boolean; certificate?: { scoreBand: string } | null }
assert.equal(passed.passed, true)
assert.equal(passed.certificate?.scoreBand, 'distinction')
assert.equal((await svc.findEntitlement(payload, user.id, course.id))?.status, 'passed')
const certificate = (await payload.find({ collection: 'certificates', where: { student: { equals: user.id } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as { scoreBand: string; examScore: number }
assert.equal(certificate.scoreBand, 'distinction')
assert.equal((await payload.count({ collection: 'orders', where: { and: [{ user: { equals: user.id } }, { type: { equals: 'certificate' } }] }, overrideAccess: true })).totalDocs, 1, 'paid once')
step('passed after the cooldown with no further payment: certificate issued, "Passed with distinction"')

const messages = (await payload.find({ collection: 'messages', where: { personKey: { equals: `user:${user.id}` } }, limit: 100, depth: 0, overrideAccess: true })).docs.map((m) => (m as unknown as { stepId: string }).stepId)
assert.ok(messages.includes('T12'), `T12 (exam ready) recorded: ${messages.join(', ')}`)
assert.ok(messages.includes('T9'), 'T9 (certificate ready) recorded')
step(`lifecycle emails recorded: ${[...new Set(messages)].join(', ')}`)

// A timed attempt left open is submitted by the sweep when time runs out.
const other = (await payload.find({ collection: 'quizzes', where: { and: [{ course: { equals: course.id } }, { kind: { equals: 'chapter' } }] }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as { id: number }
await payload.update({ collection: 'quizzes', id: other.id, data: { timeLimitMinutes: 10 } as never, overrideAccess: true })
const timed = await svc.startAttempt(payload, user.id, other.id, later + 10_000)
const closed = await svc.sweepExpiredAttempts(payload, later + 10_000 + 11 * 60_000)
const swept = await payload.findByID({ collection: 'quiz-attempts', id: timed.attemptId, depth: 0, overrideAccess: true }) as unknown as { status: string }
await payload.update({ collection: 'quizzes', id: other.id, data: { timeLimitMinutes: null } as never, overrideAccess: true })
assert.ok(closed >= 1)
assert.equal(swept.status, 'expired')
step('timed attempt past its time limit closed by the expiry sweep')
console.log('\nAll assessment flow checks passed.')
process.exit(0)
