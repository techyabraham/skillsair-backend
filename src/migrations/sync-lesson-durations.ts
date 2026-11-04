/**
 * Lesson lengths from Google Drive: sets each lesson's duration to its Drive video's real length.
 *
 * Lessons imported from WordPress kept the length Tutor LMS had on record, which is often wrong,
 * and the Drive imports only fill in a length that is missing. The length shows beside every
 * lesson, adds up to the programme's total, and sets how much of a video a learner must watch
 * before "Mark as Complete" is accepted, so a wrong one can stop a lesson being completed.
 *
 * Reads Drive with the service account (GOOGLE_SERVICE_ACCOUNT_KEY). Lessons without a Drive
 * video, and videos Drive has no length for yet, are left as they are and listed.
 *
 * Usage (dry run first; --execute writes):
 *   npm run lessons:sync-durations -- --course <slug> [--course <slug> ...] | --all [--execute]
 */
import type { Payload } from 'payload'
import { progress, serviceAccountDrive, videoDurationSeconds } from '../lib/drive-folders.js'
import { recalculateCourseStats } from '../collections/Lessons.js'

/** Within a second either way counts as the same length (Drive reports milliseconds). */
const TOLERANCE_SECONDS = 1

interface LessonRow {
  id: number
  title: string
  driveFileId?: string | null
  duration?: number | null
}

export interface DurationReport {
  slug: string
  videos: number
  changed: Array<{ id: number; title: string; from: number; to: number }>
  unknown: string[]
}

const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.round(seconds % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export async function syncCourseDurations(payload: Payload, slug: string, execute: boolean): Promise<DurationReport | null> {
  const found = await payload.find({ collection: 'courses', where: { slug: { equals: slug } }, limit: 1, depth: 0, overrideAccess: true })
  const course = found.docs[0] as unknown as { id: number; title: string } | undefined
  if (!course) {
    console.log(`\n### ${slug}: no course with this slug. Skipped.`)
    return null
  }
  const sections = await payload.find({ collection: 'sections', where: { course: { equals: course.id } }, limit: 1000, depth: 0, overrideAccess: true })
  const sectionIds = sections.docs.map((section) => section.id)
  const lessons = sectionIds.length
    ? ((await payload.find({ collection: 'lessons', where: { section: { in: sectionIds } }, limit: 5000, depth: 0, overrideAccess: true })).docs as unknown as LessonRow[])
    : []
  const withVideo = lessons.filter((lesson) => lesson.driveFileId)
  const report: DurationReport = { slug, videos: withVideo.length, changed: [], unknown: [] }

  const queue = [...withVideo]
  let done = 0
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let lesson = queue.shift(); lesson; lesson = queue.shift()) {
      if (++done % 50 === 0) progress(`checked ${done} of ${withVideo.length} videos`)
      const seconds = await videoDurationSeconds(lesson.driveFileId ?? '')
      if (!seconds) {
        report.unknown.push(lesson.title)
        continue
      }
      const stored = Number(lesson.duration ?? 0)
      if (Math.abs(seconds - stored) <= TOLERANCE_SECONDS) continue
      report.changed.push({ id: lesson.id, title: lesson.title, from: stored, to: seconds })
      if (execute) {
        await payload.update({ collection: 'lessons', id: lesson.id, data: { duration: seconds }, overrideAccess: true, context: { skipCourseStats: true } })
      }
    }
  }))
  // One recalculation for the programme (total length, cached curriculum) instead of one per lesson.
  if (execute && report.changed.length) await recalculateCourseStats(course.id, payload as unknown as Parameters<typeof recalculateCourseStats>[1])

  console.log(`\n### ${course.title} (${slug})`)
  console.log(`  ${withVideo.length} lessons with a Drive video; ${report.changed.length} ${execute ? 'corrected' : 'would be corrected'}; ${report.unknown.length} with no length on Drive.`)
  for (const item of report.changed.sort((a, b) => a.id - b.id)) console.log(`    lesson ${item.id} "${item.title}": ${item.from ? clock(item.from) : 'none'} -> ${clock(item.to)}`)
  if (report.unknown.length) console.log(`  No length on Drive (left as they are): ${report.unknown.slice(0, 20).join('; ')}${report.unknown.length > 20 ? ` and ${report.unknown.length - 20} more` : ''}`)
  return report
}

async function run(): Promise<void> {
  const args = process.argv.slice(2)
  const execute = args.includes('--execute')
  const { loadEnv } = await import('payload/node')
  const { getPayload } = await import('payload')
  await loadEnv()
  if (!serviceAccountDrive()) {
    console.log('GOOGLE_SERVICE_ACCOUNT_KEY is not set here, so Drive lengths can’t be read. Run this on the migration runner.')
    process.exit(1)
  }
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })

  const slugs: string[] = []
  args.forEach((arg, index) => { if (arg === '--course' && args[index + 1]) slugs.push((args[index + 1] as string).trim()) })
  if (args.includes('--all')) {
    const courses = await payload.find({ collection: 'courses', limit: 200, depth: 0, overrideAccess: true })
    for (const course of courses.docs as unknown as Array<{ slug: string }>) if (!slugs.includes(course.slug)) slugs.push(course.slug)
  }
  if (!slugs.length) {
    console.log('Usage: npm run lessons:sync-durations -- --course <slug> [--course ...] | --all [--execute]')
    process.exit(1)
  }
  console.log(execute ? 'CORRECTING lesson lengths.' : 'DRY RUN: nothing is written. Add --execute to correct them.')
  let failed = 0
  let changed = 0
  for (const slug of slugs) {
    try {
      const report = await syncCourseDurations(payload, slug, execute)
      if (!report) failed++
      else changed += report.changed.length
    } catch (err) {
      failed++
      console.error(`\n### ${slug}: FAILED (${err instanceof Error ? err.message : String(err)})`)
    }
  }
  console.log(`\n${changed} lesson lengths ${execute ? 'corrected' : 'would be corrected'} across ${slugs.length} programmes.`)
  process.exit(failed ? 1 : 0)
}

if (process.argv[1] && /sync-lesson-durations\.(ts|js)$/.test(process.argv[1])) void run()
