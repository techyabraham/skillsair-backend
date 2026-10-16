/**
 * Sets up the ten SkillsAir schools and puts each course in the right ones.
 *
 * 1. Ensures each school exists as a `category` with the owner's exact name. A category still
 *    using a former name ("School of Smart Phone") is renamed, slug included.
 * 2. Assigns courses to schools from the owner's line-up (src/lib/school-lineup.ts). A course
 *    can be in several schools; its home school comes first. Categories that aren't one of
 *    the ten schools are kept after them.
 * 3. Reports line-up programmes with no matching course, so they can be created in the admin
 *    (the site shows them as "Coming soon" until then).
 *
 * Dry run by default; nothing is written without --execute.
 *
 * Usage:
 *   npm run seed:schools [-- --execute]
 */
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'
import { SCHOOLS, findSchool, matchesProgramme, normaliseName, schoolsForCourse } from '../lib/school-lineup.js'
import { slugify } from '../utils/slugify.js'

interface CategoryDoc {
  id: number
  name: string
  slug: string
}

interface CourseDoc {
  id: number
  title: string
  status?: string | null
  categories?: Array<number | { id: number }> | null
}

const relationId = (value: number | { id: number }) => (typeof value === 'object' ? value.id : value)

async function run(): Promise<void> {
  const execute = process.argv.includes('--execute')
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })

  console.log('Schools')
  const existing = await payload.find({ collection: 'categories', limit: 500, depth: 0, overrideAccess: true })
  const schoolIds = new Map<string, number>()
  for (const doc of existing.docs as unknown as CategoryDoc[]) {
    const school = findSchool(doc.name)
    if (school && !schoolIds.has(school.name)) schoolIds.set(school.name, doc.id)
  }

  for (const school of SCHOOLS) {
    const id = schoolIds.get(school.name)
    const found = (existing.docs as unknown as CategoryDoc[]).find((doc) => doc.id === id)
    if (found && normaliseName(found.name) === normaliseName(school.name)) {
      console.log(`- ${school.name}: exists (/${found.slug})`)
      continue
    }
    if (found) {
      const slug = slugify(school.name)
      if (execute) await payload.update({ collection: 'categories', id: found.id, data: { name: school.name, slug }, overrideAccess: true })
      console.log(`- ${school.name}: ${execute ? 'renamed' : 'would rename'} "${found.name}" (/${found.slug} -> /${slug})`)
      continue
    }
    if (execute) {
      const created = (await payload.create({ collection: 'categories', data: { name: school.name, description: school.description }, overrideAccess: true })) as unknown as CategoryDoc
      schoolIds.set(school.name, created.id)
      console.log(`- ${school.name}: created (/${created.slug})`)
    } else {
      console.log(`- ${school.name}: would be created`)
    }
  }

  console.log('\nCourses')
  const courses = (await payload.find({ collection: 'courses', limit: 1000, depth: 0, overrideAccess: true, sort: 'title' })).docs as unknown as CourseDoc[]
  const allSchoolIds = new Set(schoolIds.values())
  for (const course of courses) {
    const schools = schoolsForCourse(course.title)
    if (schools.length === 0) continue
    const current = (course.categories ?? []).map(relationId)
    const wanted = schools.map((school) => schoolIds.get(school.name)).filter((id): id is number => typeof id === 'number')
    const next = [...wanted, ...current.filter((id) => !allSchoolIds.has(id))]
    const label = `${course.title}${course.status && course.status !== 'published' ? ` (${course.status})` : ''}: ${schools.map((school) => school.name).join(', ')}`
    if (wanted.length < schools.length) {
      console.log(`- ${label} (run with --execute first to create the missing schools)`)
      continue
    }
    if (next.length === current.length && next.every((id, index) => id === current[index])) {
      console.log(`- ${label} (already set)`)
      continue
    }
    if (execute) await payload.update({ collection: 'courses', id: course.id, data: { categories: next }, overrideAccess: true })
    console.log(`- ${label} (${execute ? 'updated' : 'would update'})`)
  }

  console.log('\nLine-up programmes with no course yet (shown as "Coming soon")')
  let missing = 0
  for (const school of SCHOOLS) {
    for (const planned of school.programmes) {
      if (courses.some((course) => matchesProgramme(course.title, planned))) continue
      missing += 1
      console.log(`- ${school.name}: ${planned.title}`)
    }
  }
  if (missing === 0) console.log('- none')

  console.log(execute ? '\nDone.' : '\nDRY RUN: nothing written. Re-run with --execute to apply.')
  process.exit(0)
}

void run()
