/** Imports additional Tutor LMS exports after users and courses exist.
 * Usage: node --loader ts-node/esm src/migrations/import-learning-data.ts <kind> <csv-path> [--execute]
 * Kinds: subscriptions, prerequisites, progress, quizzes, quiz-attempts, reviews, discussions, certificates.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'

type Row = Record<string, string>
type Kind = 'subscriptions' | 'prerequisites' | 'progress' | 'quizzes' | 'quiz-attempts' | 'reviews' | 'discussions' | 'certificates'
const kinds = new Set<Kind>(['subscriptions', 'prerequisites', 'progress', 'quizzes', 'quiz-attempts', 'reviews', 'discussions', 'certificates'])

async function run(): Promise<void> {
  const kind = process.argv[2] as Kind
  const filename = process.argv[3]
  const execute = process.argv.includes('--execute')
  if (!kinds.has(kind) || !filename) throw new Error('Usage: import-learning-data.ts <subscriptions|prerequisites|progress|quizzes|quiz-attempts|reviews|discussions|certificates> <csv-path> [--execute]')
  const rows = parse(readFileSync(filename, 'utf8'), { columns: true, skip_empty_lines: true, trim: true }) as Row[]
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  const api = payload as any
  const findOne = async (collection: string, where: Record<string, unknown>): Promise<any | null> =>
    (await api.find({ collection, where, limit: 1, depth: 0, overrideAccess: true })).docs[0] ?? null
  const user = async (email: string) => {
    const doc = await findOne('users', { email: { equals: email?.toLowerCase() } })
    if (!doc) throw new Error(`Unknown user: ${email}`)
    return doc
  }
  const course = async (slug: string) => {
    const doc = await findOne('courses', { slug: { equals: slug } })
    if (!doc) throw new Error(`Unknown course: ${slug}`)
    return doc
  }
  const lesson = async (courseId: number, slug: string) => {
    const sections = await api.find({ collection: 'sections', where: { course: { equals: courseId } }, limit: 1000, depth: 0, overrideAccess: true })
    const doc = await findOne('lessons', { and: [{ section: { in: sections.docs.map((item: any) => item.id) } }, { slug: { equals: slug } }] })
    if (!doc) throw new Error(`Unknown lesson: ${slug}`)
    return doc
  }
  const requireCell = (row: Row, key: string) => {
    const value = row[key]?.trim()
    if (!value) throw new Error(`Missing ${key}`)
    return value
  }
  const create = async (collection: string, data: Record<string, unknown>) => {
    if (execute) await api.create({ collection, data, overrideAccess: true })
  }
  let created = 0, skipped = 0, failed = 0
  const quizGroups = new Map<string, { courseId: number; title: string; passingScore: number; questions: Array<{ prompt: string; options: Array<{ text: string }>; correctIndex: number }> }>()
  for (const [index, row] of rows.entries()) {
    try {
      const c = await course(requireCell(row, 'course_slug'))
      if (kind === 'subscriptions') {
        const u = await user(requireCell(row, 'student_email'))
        const plan = await findOne('plans', { and: [{ name: { equals: requireCell(row, 'plan_name') } }, { course: { equals: c.id } }] })
        if (!plan) throw new Error('Unknown course plan')
        const periodEnd = new Date(requireCell(row, 'current_period_end'))
        if (Number.isNaN(periodEnd.getTime())) throw new Error('Invalid current_period_end')
        const code = row.paystack_subscription_code?.trim()
        const existing = await findOne('subscriptions', code ? { paystackSubscriptionCode: { equals: code } } : { and: [{ user: { equals: u.id } }, { plan: { equals: plan.id } }, { currentPeriodEnd: { equals: periodEnd.toISOString() } }] })
        if (existing) { skipped++; continue }
        const status = row.status || 'active'
        if (!['active', 'cancelled', 'expired'].includes(status)) throw new Error('Invalid status')
        if (execute) {
          const createdSubscription = await api.create({ collection: 'subscriptions', data: {
            user: u.id, plan: plan.id, course: c.id, status,
            currentPeriodStart: row.current_period_start || undefined, currentPeriodEnd: periodEnd.toISOString(),
            paystackSubscriptionCode: code || undefined, paystackEmailToken: row.paystack_email_token || undefined,
          }, overrideAccess: true })
          const enrollment = await findOne('enrollments', { and: [{ student: { equals: u.id } }, { course: { equals: c.id } }] })
          if (enrollment) await api.update({ collection: 'enrollments', id: enrollment.id, data: { subscription: createdSubscription.id }, overrideAccess: true })
          else await api.create({ collection: 'enrollments', data: { student: u.id, course: c.id, status: 'active', subscription: createdSubscription.id }, overrideAccess: true })
        }
      } else if (kind === 'prerequisites') {
        const prerequisite = await course(requireCell(row, 'prerequisite_slug'))
        if (c.id === prerequisite.id) throw new Error('A course cannot require itself')
        const current = (c.prerequisites ?? []).map((item: any) => typeof item === 'object' ? item.id : item)
        if (current.includes(prerequisite.id)) { skipped++; continue }
        if (execute) await api.update({ collection: 'courses', id: c.id, data: { prerequisites: [...current, prerequisite.id] }, overrideAccess: true })
      } else if (kind === 'progress') {
        const u = await user(requireCell(row, 'student_email'))
        const l = await lesson(c.id, requireCell(row, 'lesson_slug'))
        const enrollment = await findOne('enrollments', { and: [{ student: { equals: u.id } }, { course: { equals: c.id } }] })
        if (!enrollment) throw new Error('Student is not enrolled')
        if (await findOne('lesson-progress', { and: [{ student: { equals: u.id } }, { lesson: { equals: l.id } }] })) { skipped++; continue }
        const watchedSeconds = Number(row.watched_seconds || 0)
        if (!Number.isFinite(watchedSeconds) || watchedSeconds < 0) throw new Error('Invalid watched_seconds')
        const isCompleted = row.is_completed?.toLowerCase() === 'true'
        await create('lesson-progress', { student: u.id, course: c.id, lesson: l.id, watchedSeconds, isCompleted, ...(isCompleted ? { completedAt: row.completed_at || new Date().toISOString() } : {}) })
      } else if (kind === 'quizzes') {
        const title = requireCell(row, 'quiz_title')
        const prompt = requireCell(row, 'question')
        const options = JSON.parse(requireCell(row, 'options_json')) as string[]
        const correctIndex = Number(requireCell(row, 'correct_index'))
        const passingScore = Number(row.passing_score || 70)
        if (!Array.isArray(options) || options.length < 2 || options.some((item) => typeof item !== 'string') || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length || !Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100) throw new Error('Invalid quiz question or score')
        const key = `${c.id}:${title}`
        const group = quizGroups.get(key) ?? { courseId: c.id, title, passingScore, questions: [] as Array<{ prompt: string; options: Array<{ text: string }>; correctIndex: number }> }
        group.questions.push({ prompt, options: options.map((text) => ({ text })), correctIndex })
        quizGroups.set(key, group)
        continue
      } else if (kind === 'quiz-attempts') {
        const u = await user(requireCell(row, 'student_email'))
        const quiz = await findOne('quizzes', { and: [{ course: { equals: c.id } }, { title: { equals: requireCell(row, 'quiz_title') } }] })
        if (!quiz) throw new Error('Unknown quiz')
        const score = Number(requireCell(row, 'score'))
        if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Invalid score')
        if (await findOne('quiz-attempts', { and: [{ student: { equals: u.id } }, { quiz: { equals: quiz.id } }, { score: { equals: score } }] })) { skipped++; continue }
        await create('quiz-attempts', { student: u.id, quiz: quiz.id, score, passed: row.passed?.toLowerCase() === 'true' })
      } else if (kind === 'reviews') {
        const u = await user(requireCell(row, 'student_email'))
        const rating = Number(requireCell(row, 'rating'))
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Invalid rating')
        if (await findOne('reviews', { and: [{ student: { equals: u.id } }, { course: { equals: c.id } }] })) { skipped++; continue }
        await create('reviews', { student: u.id, course: c.id, rating, body: requireCell(row, 'body') })
      } else if (kind === 'discussions') {
        const u = await user(requireCell(row, 'student_email'))
        const l = row.lesson_slug ? await lesson(c.id, row.lesson_slug) : null
        const externalId = requireCell(row, 'external_id')
        if (await findOne('discussions', { externalId: { equals: externalId } })) { skipped++; continue }
        const parent = row.parent_external_id ? await findOne('discussions', { externalId: { equals: row.parent_external_id } }) : null
        if (row.parent_external_id && !parent) throw new Error('Import parent discussion first')
        await create('discussions', { author: u.id, course: c.id, lesson: l?.id, parent: parent?.id, externalId, body: requireCell(row, 'body') })
      } else if (kind === 'certificates') {
        const u = await user(requireCell(row, 'student_email'))
        const certificateCode = requireCell(row, 'certificate_code')
        if (await findOne('certificates', { certificateCode: { equals: certificateCode } })) { skipped++; continue }
        await create('certificates', { student: u.id, course: c.id, certificateCode, pdfUrl: requireCell(row, 'pdf_url'), issuedAt: row.issued_at || new Date().toISOString() })
      }
      created++
    } catch (err) {
      failed++
      console.error(`FAILED row ${index + 2}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (kind === 'quizzes') {
    for (const group of quizGroups.values()) {
      const existing = await findOne('quizzes', { and: [{ course: { equals: group.courseId } }, { title: { equals: group.title } }] })
      if (existing) { skipped++; continue }
      if (execute) {
        const questions: number[] = []
        for (const question of group.questions) {
          const createdQuestion = await api.create({ collection: 'quiz-questions', data: question, overrideAccess: true })
          questions.push(createdQuestion.id)
        }
        await api.create({ collection: 'quizzes', data: { title: group.title, course: group.courseId, passingScore: group.passingScore, questions, isPublished: true }, overrideAccess: true })
      }
      created++
    }
  }
  console.log(JSON.stringify({ kind, mode: execute ? 'execute' : 'dry-run', rows: rows.length, created, skipped, failed }))
  if (failed) process.exitCode = 1
}

run().catch((err: unknown) => { console.error(err); process.exitCode = 1 })
