/**
 * Exports what the content packs are written from, into content/sources/<course-slug>/:
 *   curriculum.json   chapters and lessons in order (database id, slug, title, Drive video id, duration,
 *                     whether captions/a subtitle file exist). The Drive video id is the stable key packs use.
 *   transcripts/<chapter>-<lesson>.txt   the lesson transcript, a [mm:ss] marker about every 30 seconds
 *   resources.json    worksheet, PDF and project file titles per lesson
 * Transcripts come from the stored captions (captions:import), or straight from the .srt in Drive.
 * Commit content/sources to the `content-sources` branch so the pack writer can read it.
 *
 * Usage:
 *   npm run content:export-sources -- --course <slug> [--course ...] | --all [--out <dir>]
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Payload } from 'payload'
import { convertSrt, findSubtitle } from '../lib/captions.js'
import { downloadText, flattenFiles, progress, walkFolder } from '../lib/drive-folders.js'
import { relationId } from '../lib/course-access.js'

interface LessonRow { id: number; slug?: string | null; title: string; order: number; section: unknown; driveFileId?: string | null; duration?: number | null; hasCaptions?: boolean | null; transcript?: string | null; resources?: Array<{ title: string; mimeType?: string | null }> | null; isPublished?: boolean | null }

export async function exportSources(payload: Payload, slug: string, outRoot: string): Promise<{ lessons: number; transcripts: number; missing: string[] } | null> {
  const course = (await payload.find({ collection: 'courses', where: { slug: { equals: slug } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as { id: number; title: string; driveFolderId?: string | null } | undefined
  if (!course) { console.log(`\n### ${slug}: no programme with this slug.`); return null }
  console.log(`\n### ${course.title} (${slug})`)
  const sections = (await payload.find({ collection: 'sections', where: { course: { equals: course.id } }, sort: 'order', limit: 1000, depth: 0, overrideAccess: true })).docs as unknown as Array<{ id: number; title: string; order: number }>
  const lessons = sections.length ? (await payload.find({ collection: 'lessons', where: { section: { in: sections.map((s) => s.id) } }, sort: 'order', limit: 10000, depth: 0, overrideAccess: true })).docs as unknown as LessonRow[] : []

  // Subtitle files in Drive for lessons without stored captions.
  let byVideo = new Map<string, { name: string; siblings: Array<{ id: string; name: string }> }>()
  if (course.driveFolderId && lessons.some((lesson) => lesson.driveFileId && !lesson.transcript)) {
    progress('reading the Drive folder for subtitle files...')
    byVideo = new Map(flattenFiles(await walkFolder(course.driveFolderId)).map((file) => [file.id, file]))
  }

  const dir = path.join(outRoot, slug)
  fs.rmSync(path.join(dir, 'transcripts'), { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'transcripts'), { recursive: true })
  const missing: string[] = []
  let transcripts = 0
  const chapters = []
  const resources: Array<{ chapterOrder: number; lessonOrder: number; lessonTitle: string; files: string[] }> = []
  for (const section of sections) {
    const own = lessons.filter((lesson) => Number(relationId(lesson.section)) === section.id && lesson.isPublished !== false).sort((a, b) => a.order - b.order)
    const rows = []
    for (const lesson of own) {
      let text = lesson.transcript ?? ''
      if (!text && lesson.driveFileId) {
        const video = byVideo.get(lesson.driveFileId)
        const subtitle = video ? findSubtitle(video.name, video.siblings) : undefined
        if (subtitle) {
          try { text = convertSrt(await downloadText(subtitle.id))?.transcript ?? '' } catch { /* listed as missing */ }
        }
      }
      const file = `${section.order}-${lesson.order}.txt`
      if (text) { fs.writeFileSync(path.join(dir, 'transcripts', file), `# ${section.title} / ${lesson.title}\n# driveFileId: ${lesson.driveFileId ?? ''}\n\n${text}\n`); transcripts++ }
      else if (lesson.driveFileId) missing.push(`${section.title} / ${lesson.title}`)
      if (lesson.resources?.length) resources.push({ chapterOrder: section.order, lessonOrder: lesson.order, lessonTitle: lesson.title, files: lesson.resources.map((resource) => resource.title) })
      rows.push({ id: lesson.id, slug: lesson.slug ?? null, title: lesson.title, order: lesson.order, driveFileId: lesson.driveFileId ?? null, duration: Number(lesson.duration ?? 0), hasVideo: Boolean(lesson.driveFileId), hasSubtitle: Boolean(text), transcriptFile: text ? `transcripts/${file}` : null })
    }
    chapters.push({ order: section.order, id: section.id, title: section.title, lessons: rows })
  }
  fs.writeFileSync(path.join(dir, 'curriculum.json'), `${JSON.stringify({ course: { id: course.id, slug, title: course.title }, exportedAt: new Date().toISOString(), chapters }, null, 2)}\n`)
  fs.writeFileSync(path.join(dir, 'resources.json'), `${JSON.stringify(resources, null, 2)}\n`)
  const videoLessons = lessons.filter((lesson) => lesson.driveFileId).length
  console.log(`  ${transcripts} transcripts for ${videoLessons} video lessons; ${missing.length} without a subtitle file.`)
  if (missing.length) fs.writeFileSync(path.join(dir, 'missing-subtitles.txt'), `${missing.join('\n')}\n`)
  return { lessons: videoLessons, transcripts, missing }
}

async function run(): Promise<void> {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf('--out')
  const outRoot = path.resolve(outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] as string : 'content/sources')
  const { loadEnv } = await import('payload/node')
  const { getPayload } = await import('payload')
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  const slugs: string[] = []
  args.forEach((arg, index) => { if (arg === '--course' && args[index + 1]) slugs.push((args[index + 1] as string).trim()) })
  if (args.includes('--all')) {
    const courses = await payload.find({ collection: 'courses', where: { and: [{ status: { equals: 'published' } }, { driveFolderId: { exists: true } }] }, limit: 200, depth: 0, overrideAccess: true })
    for (const course of courses.docs as unknown as Array<{ slug: string }>) if (!slugs.includes(course.slug)) slugs.push(course.slug)
  }
  if (!slugs.length) { console.log('Usage: npm run content:export-sources -- --course <slug> [--course ...] | --all [--out <dir>]'); process.exit(1) }
  const totals: string[] = []
  for (const slug of slugs) {
    const result = await exportSources(payload, slug, outRoot)
    if (result) totals.push(`${slug}: ${result.transcripts}/${result.lessons} lessons with transcripts`)
  }
  console.log(`\nExported to ${outRoot}\n${totals.map((line) => `  - ${line}`).join('\n')}`)
  process.exit(0)
}

if (process.argv[1] && /content-export-sources\.(ts|js)$/.test(process.argv[1])) void run()
