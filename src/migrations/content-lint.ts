/**
 * Checks programme copy against the SEO and copy rules (src/lib/content-lint.ts).
 *
 * Usage:
 *   npm run content:lint -- --course <slug> [--course ...] | --all     (live programme fields)
 *   npm run content:lint -- --pack content/packs/<slug>/programme.json  (a pack before importing)
 * Exits 1 when there are errors.
 */
import fs from 'node:fs'
import { copyFromCourse, lintProgrammeCopy, type LintIssue } from '../lib/content-lint.js'
import { programmeCopySchema } from '../lib/content-pack.js'

function print(label: string, issues: LintIssue[]): number {
  const errors = issues.filter((issue) => issue.level === 'error')
  console.log(`\n### ${label}: ${errors.length} errors, ${issues.length - errors.length} warnings`)
  for (const issue of issues) console.log(`  ${issue.level === 'error' ? '✖' : '!'} ${issue.field}: ${issue.message}`)
  return errors.length
}

async function run(): Promise<void> {
  const args = process.argv.slice(2)
  let errors = 0
  const packIndex = args.indexOf('--pack')
  if (packIndex >= 0 && args[packIndex + 1]) {
    const file = args[packIndex + 1] as string
    const parsed = programmeCopySchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
    if (!parsed.success) { console.log(`${file}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`); process.exit(1) }
    errors += print(file, lintProgrammeCopy(parsed.data))
    process.exit(errors ? 1 : 0)
  }
  const { loadEnv } = await import('payload/node')
  const { getPayload } = await import('payload')
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  const slugs: string[] = []
  args.forEach((arg, index) => { if (arg === '--course' && args[index + 1]) slugs.push((args[index + 1] as string).trim()) })
  const where = args.includes('--all') ? { status: { equals: 'published' } } : { slug: { in: slugs } }
  if (!args.includes('--all') && !slugs.length) { console.log('Usage: npm run content:lint -- --course <slug> | --all | --pack <programme.json>'); process.exit(1) }
  const courses = await payload.find({ collection: 'courses', where: where as never, limit: 200, depth: 0, overrideAccess: true })
  for (const course of courses.docs as unknown as Array<Record<string, unknown> & { slug: string; isBonus?: boolean }>) errors += print(course.slug, lintProgrammeCopy(copyFromCourse(course)))
  process.exit(errors ? 1 : 0)
}

if (process.argv[1] && /content-lint\.(ts|js)$/.test(process.argv[1])) void run()
