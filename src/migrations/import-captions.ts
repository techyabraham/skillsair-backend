/**
 * Captions, transcripts and lesson durations from Google Drive.
 *
 * For each lesson with a Drive video, finds the .srt with the same name in the same Drive folder,
 * converts it to WebVTT captions and a [mm:ss] transcript (src/lib/captions.ts) and stores them on
 * the lesson. Fills in missing durations from Drive's video metadata (service account only).
 * Skips lessons whose subtitle file hasn't changed, unless --force. Video delivery is unchanged.
 *
 * Runs from the migration runner or the worker, never inside an API request. Also runs
 * automatically for a course after import:drive-curriculum --execute.
 *
 * Usage:
 *   npm run captions:import -- --course <slug> [--course <slug> ...] | --all [--force] [--dry-run]
 * Writes a summary CSV per course to tmp/captions-<slug>.csv.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Payload } from 'payload'
import { convertSrt, findSubtitle } from '../lib/captions.js'
import { downloadText, flattenFiles, progress, serviceAccountDrive, videoDurationSeconds, walkFolder, type DriveItem } from '../lib/drive-folders.js'
import { CACHE_KEYS, cacheDel } from '../lib/cache.js'
import { recalculateCourseStats } from '../collections/Lessons.js'
import { bumpCourseCache } from '../lib/cache.js'

interface LessonRow {
  id: number
  title: string
  order: number
  driveFileId?: string | null
  duration?: number | null
  hasCaptions?: boolean | null
  captions?: Array<{ sourceFileId?: string | null; sourceModifiedTime?: string | null; vtt?: string | null }> | null
}

export interface CaptionReport {
  slug: string
  lessons: number
  withCaptions: number
  updated: number
  unchanged: number
  noSubtitle: string[]
  videoNotInFolder: string[]
  /** Lessons whose save was refused; the rest of the programme still imports. */
  saveFailed: string[]
  durationsFilled: number
  csvPath: string | null
}

const fingerprint = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 16)

export async function importCaptionsForCourse(payload: Payload, slug: string, options: { force?: boolean; execute?: boolean; folderId?: string; tree?: DriveItem[] } = {}): Promise<CaptionReport | null> {
  const execute = options.execute ?? true
  const found = await payload.find({ collection: 'courses', where: { slug: { equals: slug } }, limit: 1, depth: 0, overrideAccess: true })
  const course = found.docs[0] as unknown as { id: number; title: string; driveFolderId?: string | null } | undefined
  if (!course) {
    console.log(`\n### ${slug}: no course with this slug. Skipped.`)
    return null
  }
  const folderId = options.folderId ?? course.driveFolderId
  if (!folderId) {
    console.log(`\n### ${course.title}: no Drive folder recorded. Run import:drive-curriculum for it first (or pass --course ${slug}=<folderId>).`)
    return null
  }
  // Remember a folder passed on the command line, so --all and Studio's "Re-import captions" find it next time.
  if (execute && options.folderId && !course.driveFolderId) {
    await payload.update({ collection: 'courses', id: course.id, data: { driveFolderId: options.folderId } as never, overrideAccess: true, context: { skipContentLint: true } })
  }
  if (!options.tree) {
    console.log(`\n### ${course.title} (${slug})`)
    progress('reading the Drive folder...')
  } else progress('captions: matching subtitle files...')
  const files = flattenFiles(options.tree ?? await walkFolder(folderId))
  const byId = new Map(files.map((file) => [file.id, file]))

  const sections = await payload.find({ collection: 'sections', where: { course: { equals: course.id } }, limit: 1000, depth: 0, sort: 'order', overrideAccess: true })
  const sectionIds = sections.docs.map((section) => section.id)
  const lessons = sectionIds.length
    ? (await payload.find({ collection: 'lessons', where: { section: { in: sectionIds } }, limit: 10000, depth: 0, overrideAccess: true })).docs as unknown as LessonRow[]
    : []
  const withVideo = lessons.filter((lesson) => lesson.driveFileId)

  const report: CaptionReport = { slug, lessons: withVideo.length, withCaptions: 0, updated: 0, unchanged: 0, noSubtitle: [], videoNotInFolder: [], saveFailed: [], durationsFilled: 0, csvPath: null }
  const rows: string[][] = [['lesson_id', 'lesson', 'duration_seconds', 'captions', 'note']]
  const canReadDurations = Boolean(serviceAccountDrive())
  const context = { skipCourseStats: true }
  progress(`${withVideo.length} lessons with a video; matching subtitle files...`)

  const queue = [...withVideo]
  let done = 0
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let lesson = queue.shift(); lesson; lesson = queue.shift()) {
      if (++done % 50 === 0) progress(`processed ${done} of ${withVideo.length} lessons`)
      const video = byId.get(lesson.driveFileId ?? '')
      const data: Record<string, unknown> = {}
      let note = ''
      let hasCaptions = Boolean(lesson.hasCaptions)

      if (!lesson.duration && canReadDurations) {
        const seconds = await videoDurationSeconds(lesson.driveFileId ?? '')
        if (seconds) { data.duration = seconds; report.durationsFilled++ }
      }

      if (!video) {
        report.videoNotInFolder.push(lesson.title)
        note = 'video not found in the programme folder'
      } else {
        const subtitle = findSubtitle(video.name, video.siblings)
        if (!subtitle) {
          report.noSubtitle.push(lesson.title)
          note = 'no subtitle file'
        } else {
          const stored = lesson.captions?.[0]
          const sameFile = stored?.sourceFileId === subtitle.id && Boolean(subtitle.modifiedTime) && stored?.sourceModifiedTime === subtitle.modifiedTime
          if (sameFile && !options.force) {
            report.unchanged++
            hasCaptions = true
          } else {
            try {
              const converted = convertSrt(await downloadText(subtitle.id))
              if (!converted) {
                note = 'subtitle file has no usable cues'
                report.noSubtitle.push(lesson.title)
              } else {
                // Without Drive's modified time (public access), compare the content instead.
                const modified = subtitle.modifiedTime ?? `sha1:${fingerprint(converted.vtt)}`
                if (!options.force && stored?.sourceFileId === subtitle.id && stored?.sourceModifiedTime === modified) {
                  report.unchanged++
                } else {
                  data.captions = [{ language: 'en', label: 'English', vtt: converted.vtt, sourceFileId: subtitle.id, sourceModifiedTime: modified }]
                  data.transcript = converted.transcript
                  data.hasCaptions = true
                  report.updated++
                }
                hasCaptions = true
              }
            } catch (err) {
              note = `could not download the subtitle file (${err instanceof Error ? err.message : String(err)})`
              report.noSubtitle.push(lesson.title)
            }
          }
        }
      }
      if (execute && Object.keys(data).length) {
        try {
          await payload.update({ collection: 'lessons', id: lesson.id, data, overrideAccess: true, context })
          if (data.captions) await cacheDel(CACHE_KEYS.captions(lesson.id, 'en'), CACHE_KEYS.transcript(lesson.id))
        } catch (err) {
          // One lesson that can't be saved shouldn't stop the rest of the programme.
          if (data.captions) { report.updated--; hasCaptions = Boolean(lesson.hasCaptions) }
          if (data.duration) report.durationsFilled--
          note = `could not save (${err instanceof Error ? err.message : String(err)})`
          report.saveFailed.push(`${lesson.title}: ${note}`)
        }
      }
      if (hasCaptions) report.withCaptions++
      rows.push([String(lesson.id), lesson.title, String(data.duration ?? lesson.duration ?? 0), hasCaptions ? 'yes' : 'no', note])
    }
  }))

  if (execute && report.durationsFilled) await recalculateCourseStats(course.id, payload as unknown as Parameters<typeof recalculateCourseStats>[1])
  else if (execute && report.updated) await bumpCourseCache(course.id) // hasCaptions shows in the cached curriculum

  try {
    const dir = path.resolve('tmp')
    fs.mkdirSync(dir, { recursive: true })
    report.csvPath = path.join(dir, `captions-${slug}.csv`)
    const csv = rows.map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',')).join('\n')
    fs.writeFileSync(report.csvPath, `${csv}\n`)
  } catch {
    report.csvPath = null
  }

  const coverage = report.lessons ? Math.round((report.withCaptions / report.lessons) * 100) : 0
  console.log(`  Captions: ${report.withCaptions} of ${report.lessons} lessons (${coverage}%); ${report.updated} ${execute ? 'updated' : 'would update'}, ${report.unchanged} unchanged; ${report.durationsFilled} durations ${execute ? 'filled' : 'would be filled'}${canReadDurations ? '' : ' (durations need the service account)'}.`)
  if (report.noSubtitle.length) console.log(`  No subtitle file (${report.noSubtitle.length}):\n${report.noSubtitle.slice(0, 40).map((title) => `    - ${title}`).join('\n')}${report.noSubtitle.length > 40 ? '\n    …' : ''}`)
  if (report.saveFailed.length) console.log(`  Could not save (${report.saveFailed.length}):\n${report.saveFailed.slice(0, 20).map((line) => `    - ${line}`).join('\n')}`)
  if (report.videoNotInFolder.length) console.log(`  Video not found in the Drive folder (${report.videoNotInFolder.length}):\n${report.videoNotInFolder.slice(0, 20).map((title) => `    - ${title}`).join('\n')}`)
  if (report.csvPath) console.log(`  CSV: ${report.csvPath}`)
  return report
}

async function run(): Promise<void> {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const execute = !args.includes('--dry-run')
  const { loadEnv } = await import('payload/node')
  const { getPayload } = await import('payload')
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })

  const targets: Array<{ slug: string; folderId?: string }> = []
  args.forEach((arg, index) => {
    const value = args[index + 1]
    if (arg === '--course' && value) {
      const [slug, raw] = value.split('=')
      const folderId = raw ? /folders\/([A-Za-z0-9_-]+)/.exec(raw)?.[1] ?? raw : undefined
      if (slug) targets.push({ slug: slug.trim(), folderId: folderId?.trim() })
    }
  })
  if (args.includes('--all')) {
    const courses = await payload.find({ collection: 'courses', where: { driveFolderId: { exists: true } }, limit: 200, depth: 0, overrideAccess: true })
    for (const course of courses.docs as unknown as Array<{ slug: string }>) if (!targets.some((target) => target.slug === course.slug)) targets.push({ slug: course.slug })
  }
  if (!targets.length) {
    console.log('Usage: npm run captions:import -- --course <slug>[=<drive folder>] [--course ...] | --all [--force] [--dry-run]')
    process.exit(1)
  }
  console.log(execute ? 'IMPORTING captions.' : 'DRY RUN: nothing is written.')
  if (!serviceAccountDrive()) console.log('Note: no service account key here, so Drive is read through public links and durations are not filled in.')
  let failed = 0
  for (const target of targets) {
    try {
      if (!(await importCaptionsForCourse(payload, target.slug, { force, execute, folderId: target.folderId }))) failed++
    } catch (err) {
      failed++
      console.error(`\n### ${target.slug}: FAILED (${err instanceof Error ? err.message : String(err)})`)
    }
  }
  process.exit(failed ? 1 : 0)
}

// Run only when executed directly (the curriculum import imports importCaptionsForCourse).
if (process.argv[1] && /import-captions\.(ts|js)$/.test(process.argv[1])) void run()
