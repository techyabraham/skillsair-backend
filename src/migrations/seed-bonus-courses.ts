/**
 * Free bonus courses: creates Freelancer's Academy (if it doesn't exist) as a bonus course, then
 * adds bonus courses to "My courses" for every learner who already qualifies (a programme running
 * now, or at least two paid months; see bonusEligible in src/lib/course-access.ts). New payments do
 * this automatically (order fulfilment).
 *
 * Run before importing the course content:
 *   npm run seed:bonus-courses [-- --execute]
 *   npm run import:drive-curriculum -- --course freelancers-academy=<drive folder> [--execute]
 *
 * Dry run by default; nothing is written without --execute.
 */
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'
import { ensureBonusEnrollments } from '../lib/bonus-access.js'

const BONUS_COURSES = [
  {
    slug: 'freelancers-academy',
    title: "Freelancer's Academy",
    shortDescription: 'Win your first freelance clients: set up a professional profile, get found, write offers that sell and deliver work clients come back for.',
  },
]

async function run(): Promise<void> {
  const execute = process.argv.includes('--execute')
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  const report: string[] = []

  for (const spec of BONUS_COURSES) {
    const found = await payload.find({ collection: 'courses', where: { slug: { equals: spec.slug } }, limit: 1, depth: 0, overrideAccess: true })
    const course = found.docs[0] as unknown as { id: number; isBonus?: boolean | null } | undefined
    if (course) {
      if (!course.isBonus) {
        report.push(`${spec.title}: exists; ${execute ? 'marked' : 'would be marked'} as a free bonus course`)
        if (execute) await payload.update({ collection: 'courses', id: course.id, data: { isBonus: true }, overrideAccess: true })
      } else report.push(`${spec.title}: already a free bonus course`)
      continue
    }
    const admin = (await payload.find({ collection: 'users', where: { role: { equals: 'admin' } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as { id: number } | undefined
    report.push(`${spec.title}: ${execute ? 'created' : 'would be created'} (published, free bonus course, slug ${spec.slug})`)
    if (execute) {
      await payload.create({
        collection: 'courses',
        overrideAccess: true,
        data: { title: spec.title, slug: spec.slug, shortDescription: spec.shortDescription, status: 'published', level: 'beginner', price: 0, isBonus: true, ...(admin ? { instructor: admin.id } : {}) } as never,
      })
    }
  }

  // Learners who have paid for anything: check each and add their bonus courses.
  const paid = await payload.find({ collection: 'orders', where: { and: [{ status: { equals: 'success' } }, { type: { in: ['course', 'subscription'] } }] }, limit: 100000, depth: 0, overrideAccess: true })
  const userIds = [...new Set(paid.docs.map((doc) => String(typeof doc.user === 'object' && doc.user ? (doc.user as { id: number }).id : doc.user)))]
  let learners = 0
  let enrolments = 0
  for (const userId of userIds) {
    // In a dry run the course may not exist yet, so only existing bonus courses are counted.
    const added = await ensureBonusEnrollments(payload, Number(userId), { execute })
    if (added) { learners++; enrolments += added }
  }
  report.push(`Learners who paid: ${userIds.length}; ${execute ? 'enrolled' : 'would enrol'} ${learners} qualifying learners in bonus courses (${enrolments} enrolments)${execute ? '' : '. Run again after --execute creates the course to see the full count.'}`)

  console.log(execute ? 'EXECUTED: changes written.' : 'DRY RUN: nothing is written. Re-run with --execute to apply.')
  console.log(report.map((line) => `  - ${line}`).join('\n'))
  process.exit(0)
}

void run()
