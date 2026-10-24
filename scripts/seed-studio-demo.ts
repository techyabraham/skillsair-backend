/**
 * LOCAL ONLY. Seeds believable demo data so SkillsAir Studio can be reviewed and screenshotted:
 * applicants across schools and statuses (some waiting in Imisi's queue with WhatsApp messages),
 * learners, enrolments, subscriptions (active, past due, cancelled), orders, lifecycle messages
 * and laptop applications, spread over the last 30 days.
 *
 * Safety: refuses to run unless DATABASE_URI points at localhost/127.0.0.1, NODE_ENV is not
 * production, no RESEND_API_KEY / WHATSAPP_ACCESS_TOKEN is set, and `--yes-local` is passed.
 * Never run it against staging or production. All demo people use @studio-demo.test emails.
 *
 *   node --loader ts-node/esm scripts/seed-studio-demo.ts --yes-local
 */
import { sql } from '@payloadcms/db-postgres'

const DEMO_DOMAIN = 'studio-demo.test'

function assertLocal() {
  const uri = process.env.DATABASE_URI ?? ''
  const host = (() => {
    try {
      return new URL(uri).hostname
    } catch {
      return ''
    }
  })()
  const problems = [
    !process.argv.includes('--yes-local') && 'pass --yes-local to confirm this is a local database',
    !['localhost', '127.0.0.1', '::1'].includes(host) && `DATABASE_URI host is "${host}", not localhost`,
    process.env.NODE_ENV === 'production' && 'NODE_ENV is production',
    process.env.RESEND_API_KEY && 'RESEND_API_KEY is set (emails could be sent)',
    process.env.WHATSAPP_ACCESS_TOKEN && 'WHATSAPP_ACCESS_TOKEN is set (messages could be sent)',
  ].filter(Boolean)
  if (problems.length) {
    console.error(`Refusing to seed demo data:\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
}

assertLocal()

const { getPayload } = await import('payload')
const { default: config } = await import('../payload.config.js')
const payload = await getPayload({ config })
// The local PGlite socket server handles one connection at a time; skip Payload transactions here.
;(payload.db as unknown as { beginTransaction: () => Promise<null> }).beginTransaction = async () => null
const db = payload.db as unknown as { drizzle: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Array<Record<string, unknown>> }> } }

// A demo instructor (local only) who teaches the first two programmes, for checking the
// instructor Overview and that admin-only views are refused. Password is local test data.
export const DEMO_INSTRUCTOR = { email: `instructor@${DEMO_DOMAIN}`, password: 'Demo-Instructor-Local-2026!' }
const instructorExists = await payload.count({ collection: 'users', where: { email: { equals: DEMO_INSTRUCTOR.email } }, overrideAccess: true })
if (!instructorExists.totalDocs) {
  const instructor = await payload.create({
    collection: 'users',
    overrideAccess: true,
    context: { skipWelcomeEmail: true },
    data: { ...DEMO_INSTRUCTOR, firstName: 'Bayo', lastName: 'Instructor', role: 'instructor', isVerified: true, phone: '+2348000000099' } as never,
  })
  const firstTwo = (await payload.find({ collection: 'courses', limit: 2, sort: 'id', depth: 0, overrideAccess: true })).docs
  for (const course of firstTwo) {
    await payload.update({ collection: 'courses', id: course.id, data: { instructor: instructor.id } as never, overrideAccess: true, context: { skipLifecycle: true } })
  }
  console.log(`Created demo instructor ${DEMO_INSTRUCTOR.email} for ${firstTwo.length} programmes.`)
}

// A local test learner whose email Paystack accepts (it rejects .test addresses), for trying
// checkout in Paystack TEST mode. Password is local test data.
export const DEMO_PAYER = { email: 'skillsair.demo.payer@example.com', password: 'Demo-Payer-Local-2026!' }
const payerExists = await payload.count({ collection: 'users', where: { email: { equals: DEMO_PAYER.email } }, overrideAccess: true })
if (!payerExists.totalDocs) {
  await payload.create({
    collection: 'users',
    overrideAccess: true,
    context: { skipWelcomeEmail: true },
    data: { ...DEMO_PAYER, firstName: 'Tolu', lastName: 'Payer', role: 'student', isStudent: true, isVerified: true, phone: '+2348000000098' } as never,
  })
  console.log(`Created demo payer ${DEMO_PAYER.email}.`)
}

const existing = await payload.count({ collection: 'users', where: { and: [{ email: { like: `%@${DEMO_DOMAIN}` } }, { role: { equals: 'student' } }] }, overrideAccess: true })
if (existing.totalDocs > 0) {
  console.log(`Demo data already present (${existing.totalDocs} demo users). Nothing to do.`)
  process.exit(0)
}

// Deterministic pseudo-random numbers so screenshots are repeatable.
let seed = 20261019
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const pick = <T,>(items: T[]): T => items[Math.floor(rand() * items.length)]!
const HOUR = 3_600_000
const DAY = 24 * HOUR
const now = Date.now()
const ago = (ms: number) => new Date(now - ms).toISOString()
const context = { skipWelcomeEmail: true, skipEnrollmentEmail: true, skipLifecycle: true }

const FIRST = ['Ada', 'Tunde', 'Chidi', 'Fatima', 'Ngozi', 'Emeka', 'Aisha', 'Bola', 'Kemi', 'Ifeanyi', 'Zainab', 'Segun', 'Amaka', 'Musa', 'Funke', 'Obinna', 'Halima', 'Yemi', 'Chioma', 'Ibrahim', 'Temi', 'Uche', 'Hauwa', 'Dayo', 'Nneka', 'Sani', 'Lola', 'Kunle', 'Ebere', 'Bisi']
const LAST = ['Obi', 'Bakare', 'Okafor', 'Bello', 'Eze', 'Nwosu', 'Abubakar', 'Adeyemi', 'Ogunleye', 'Okoro', 'Lawal', 'Balogun', 'Umeh', 'Danjuma', 'Afolabi']

const categories = (await payload.find({ collection: 'categories', limit: 50, depth: 0, overrideAccess: true })).docs as unknown as Array<{ id: number; name: string }>
const courses = (await payload.find({ collection: 'courses', limit: 50, depth: 0, overrideAccess: true })).docs as unknown as Array<{ id: number; title: string; categories?: number[] | null }>
const plans = (await payload.find({ collection: 'plans', limit: 100, depth: 0, overrideAccess: true })).docs as unknown as Array<{ id: number; course: number; kind: string; price: number }>
if (!courses.length || !categories.length) {
  console.error('Seed schools and programmes first (local seed), then run this.')
  process.exit(1)
}
const schoolFor = (course: { id: number; title: string; categories?: number[] | null }) => {
  const own = Array.isArray(course.categories) && course.categories.length ? course.categories[0] : null
  if (own) return own
  const title = course.title.toLowerCase()
  const byName = (word: string) => categories.find((c) => c.name.toLowerCase().includes(word))?.id
  return (title.includes('data') && byName('data')) || (title.includes('cyber') && byName('security')) || (title.includes('phone') && byName('smartphone')) || (title.includes('product') && byName('product')) || byName('design') || categories[0]!.id
}
const paidCourses = courses.filter((c) => plans.some((p) => p.course === c.id))

async function setTimestamps(table: string, id: number | string, createdAt: string, extra = '') {
  await db.drizzle.execute(sql.raw(`UPDATE "${table}" SET created_at = '${createdAt}'${table === 'enrollments' ? '' : `, updated_at = '${createdAt}'`}${extra} WHERE id = ${Number(id)}`))
}

/* ---------- Learners ---------- */
const learners: Array<{ id: number; name: string; first: string }> = []
for (let i = 0; i < 26; i++) {
  const first = FIRST[i % FIRST.length]!
  const last = pick(LAST)
  const user = await payload.create({
    collection: 'users',
    overrideAccess: true,
    context,
    data: {
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@${DEMO_DOMAIN}`,
      password: `Demo-${Math.round(rand() * 1e9)}-local`,
      firstName: first,
      lastName: last,
      role: 'student',
      isStudent: true,
      isVerified: true,
      phone: `+23480${String(30000000 + Math.floor(rand() * 69999999))}`,
    } as never,
  })
  const created = ago((2 + rand() * 40) * DAY)
  const lastLogin = ago(rand() * 14 * DAY)
  const lastLearning = i % 5 === 0 ? ago((11 + rand() * 10) * DAY) : ago(rand() * 6 * DAY)
  await setTimestamps('users', user.id, created, `, last_login_at = '${lastLogin}', lifecycle_last_learning_at = '${lastLearning}'`)
  learners.push({ id: Number(user.id), name: `${first} ${last}`, first })
}

/* ---------- Applicants (leads) ---------- */
const STATUSES = ['new', 'new', 'new', 'new', 'offer_viewed', 'offer_viewed', 'account_created', 'paid', 'paid', 'lost'] as const
const QUESTIONS = [
  'Hi, can I do this with only my phone?',
  'Please how do I pay the ₦2,000? My card keeps failing.',
  'Is there a certificate at the end?',
  'I work weekdays, can I learn on weekends only?',
  'My payment failed twice, what should I do?',
  'Do I need any experience before starting?',
]
let leadCount = 0
for (let i = 0; i < 74; i++) {
  const course = pick(courses)
  const status = pick([...STATUSES])
  const first = pick(FIRST)
  const createdMs = rand() < 0.35 ? rand() * 7 * DAY : (7 + rand() * 23) * DAY
  const needsHuman = i < 7
  const lastInbound = needsHuman ? now - (0.3 + rand() * 6) * HOUR : null
  const lead = await payload.create({
    collection: 'leads',
    overrideAccess: true,
    context,
    data: {
      firstName: first,
      email: `${first.toLowerCase()}.lead${i}@${DEMO_DOMAIN}`,
      phone: `+23481${String(10000000 + Math.floor(rand() * 89999999))}`,
      school: schoolFor(course),
      course: course.id,
      currentStatus: pick(['student', 'graduate_nysc', 'working_switch', 'not_working']),
      device: pick(['laptop', 'phone_only', 'both']),
      weeklyHours: pick(['under_5', '5_8', '8_plus']),
      source: pick(['apply', 'apply', 'apply', 'quiz', 'curriculum_request']),
      utm: { source: pick(['instagram', 'tiktok', 'google', 'whatsapp', '']), medium: 'paid_social', campaign: 'oct-window' },
      marketingConsent: rand() > 0.3,
      marketingConsentAt: ago(createdMs),
      marketingConsentText: 'Send me updates about SkillsAir programmes by email and WhatsApp.',
      status: needsHuman ? pick(['new', 'offer_viewed', 'account_created']) : status,
      offerViewCount: status === 'new' ? 0 : 1 + Math.floor(rand() * 3),
      score: needsHuman ? 60 + Math.floor(rand() * 40) : Math.floor(rand() * 70),
      needsHuman,
      lastEventAt: lastInbound ? new Date(lastInbound).toISOString() : ago(createdMs),
      lastInboundAt: lastInbound ? new Date(lastInbound).toISOString() : undefined,
      message: needsHuman && i % 2 ? pick(QUESTIONS) : undefined,
      whatsappLog: needsHuman
        ? [
            { direction: 'out', type: 'template', template: 'apply_welcome', at: new Date(now - createdMs).toISOString() },
            { direction: 'in', type: 'text', body: QUESTIONS[i % QUESTIONS.length], at: new Date(lastInbound!).toISOString() },
          ]
        : [],
    } as never,
  })
  await setTimestamps('leads', lead.id, ago(createdMs))
  leadCount++
}

/* ---------- Enrolments, subscriptions, orders ---------- */
let orderRef = 1
const order = async (data: Record<string, unknown>, createdAt: string) => {
  const doc = await payload.create({ collection: 'orders', overrideAccess: true, context, data: { currency: 'NGN', reference: `DEMO-${Date.now()}-${orderRef++}`, ...data } as never })
  await setTimestamps('orders', doc.id, createdAt, data.status === 'success' ? `, paid_at = '${createdAt}'` : '')
  return doc
}
const enrolments: Array<{ id: number; learner: (typeof learners)[number]; course: (typeof courses)[number]; completed: boolean }> = []
for (let i = 0; i < learners.length; i++) {
  const learner = learners[i]!
  const course = paidCourses[i % paidCourses.length]!
  const startedMs = (3 + rand() * 30) * DAY
  const completed = i % 6 === 2
  const kind = i % 7 === 0 ? 'standard' : 'scholarship'
  const plan = plans.find((p) => p.course === course.id && p.kind === kind) ?? plans.find((p) => p.course === course.id)!
  const first = await order({ user: learner.id, type: 'subscription', course: course.id, plan: plan.id, amount: Number(plan.price), status: 'success' }, ago(startedMs))
  const statusRoll = i % 9
  const subStatus = statusRoll === 4 ? 'past_due' : statusRoll === 7 ? 'cancelled' : 'active'
  const subscription = await payload.create({
    collection: 'subscriptions',
    overrideAccess: true,
    context,
    data: {
      user: learner.id,
      plan: plan.id,
      course: course.id,
      status: subStatus,
      initialOrderReference: (first as unknown as { reference: string }).reference,
      currentPeriodStart: ago(startedMs % (30 * DAY)),
      currentPeriodEnd: new Date(now + (30 * DAY - (startedMs % (30 * DAY)))).toISOString(),
      priceLocked: kind === 'scholarship',
      failedAttempts: subStatus === 'past_due' ? 1 : 0,
      lastFailedAt: subStatus === 'past_due' ? ago((0.5 + rand()) * DAY) : undefined,
      cancelledAt: subStatus === 'cancelled' ? ago(rand() * 5 * DAY) : undefined,
    } as never,
  })
  await setTimestamps('subscriptions', subscription.id, ago(startedMs))
  if (subStatus === 'past_due') await order({ user: learner.id, type: 'subscription', course: course.id, plan: plan.id, amount: Number(plan.price), status: 'failed' }, ago(DAY))
  const enrolment = await payload.create({
    collection: 'enrollments',
    overrideAccess: true,
    context,
    data: {
      student: learner.id,
      course: course.id,
      status: completed ? 'completed' : 'active',
      enrolledAt: ago(startedMs),
      completedAt: completed ? ago(rand() * 6 * DAY) : undefined,
      progressPercent: completed ? 100 : Math.floor(5 + rand() * 85),
      orderId: String(first.id),
      subscription: subscription.id,
    } as never,
  })
  enrolments.push({ id: Number(enrolment.id), learner, course, completed })
  if (completed) await order({ user: learner.id, type: 'certificate', course: course.id, amount: 10000, status: 'success' }, ago(rand() * 5 * DAY))
}
await order({ user: learners[3]!.id, type: 'course', course: paidCourses[0]!.id, amount: 100000, status: 'success' }, ago(2 * DAY))
await order({ user: learners[5]!.id, type: 'subscription', course: paidCourses[1 % paidCourses.length]!.id, amount: 2000, status: 'failed' }, ago(3 * DAY))

/* ---------- Certificates and laptop applications ---------- */
for (const [index, enrolment] of enrolments.filter((e) => e.completed).slice(0, 3).entries()) {
  const certificate = await payload.create({
    collection: 'certificates',
    overrideAccess: true,
    context,
    data: { student: enrolment.learner.id, course: enrolment.course.id, certificateCode: `DEMO-CERT-${enrolment.id}`, pdfUrl: 'https://example.invalid/demo.pdf', issuedAt: ago(index * DAY) } as never,
  })
  if (index < 2) {
    await payload.create({
      collection: 'laptop-applications',
      overrideAccess: true,
      context,
      data: {
        user: enrolment.learner.id,
        cohortLabel: 'Oct–Jan',
        certificate: certificate.id,
        story: 'I finished the programme on my sister’s phone between shifts at the shop, reading lessons on the bus and practising at night. A laptop would let me take on freelance data work, build a proper portfolio and support my family while I look for a junior role.',
        currentDevice: index ? 'phone_only' : 'shared_laptop',
        plannedUse: 'Practise projects every evening and apply for remote junior roles.',
        consentToFeature: index === 0,
        status: 'submitted',
      } as never,
    })
  }
}

/* ---------- Lifecycle messages (with one step over the unsubscribe threshold) ---------- */
const STEPS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'T1', 'T2', 'R1', 'C1']
let messageCount = 0
for (let i = 0; i < 160; i++) {
  const learner = pick(learners)
  const step = STEPS[i % STEPS.length]!
  const track = step.replace(/\d+$/, '')
  const sentMs = rand() * 28 * DAY
  const clicked = rand() < 0.22
  const doc = await payload.create({
    collection: 'messages',
    overrideAccess: true,
    context,
    data: {
      person: { relationTo: 'users', value: learner.id },
      personKey: `user:${learner.id}`,
      channel: 'email',
      kind: track === 'T' ? 'service' : 'marketing',
      track,
      stepId: step,
      template: `lifecycle-${step.toLowerCase()}`,
      subjectId: String(learner.id),
      cycle: 0,
      idempotencyKey: `demo:${track}:${step}:${learner.id}:${i}`,
      status: 'sent',
      sentAt: ago(sentMs),
      openedAt: rand() < 0.5 ? ago(sentMs - HOUR) : undefined,
      clickedAt: clicked ? ago(sentMs - 2 * HOUR) : undefined,
      convertedAt: clicked && rand() < 0.3 ? ago(sentMs - 3 * HOUR) : undefined,
      unsubscribedAt: step === 'A4' && i % 3 === 0 ? ago(sentMs - HOUR) : undefined,
      variant: step === 'A1' ? (Math.floor(i / STEPS.length) % 2 ? 'a' : 'b') : undefined,
    } as never,
  })
  void doc
  messageCount++
}

console.log(`Seeded ${learners.length} learners, ${leadCount} applicants, ${enrolments.length} enrolments with subscriptions and orders, ${messageCount} lifecycle messages (all @${DEMO_DOMAIN}).`)
process.exit(0)
