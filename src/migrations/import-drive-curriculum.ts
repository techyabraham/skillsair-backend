/**
 * Imports a course's chapters, lessons and documents from its Google Drive folder.
 *
 * The folder must be shared as "anyone with the link" (it is listed through Drive's public folder
 * view). When GOOGLE_SERVICE_ACCOUNT_KEY is set, every file is also checked through the Drive API
 * (the same access the video streaming uses) and video durations are filled in.
 *
 * Mapping:
 *   - a folder with videos             -> a section (sub-folders with videos: "Parent: Sub")
 *   - each video                       -> a lesson (driveFileId set, so it streams)
 *   - PDFs, Word, Excel, design files,
 *     images and zips in the chapter    -> resources on a final "Chapter resources" lesson
 *   - subtitles, saved web pages, .url/.txt files, audio, LUTs and __MACOSX -> skipped (reported)
 *
 * Existing sections and lessons are matched (by Drive file ID, then by title) and updated in place;
 * nothing is deleted. Existing titles are kept; names are only tidied where they carry clutter
 * ("Copy of", file extensions, download-site tags, other courses' ID numbers, doubled numbering).
 * Matched lessons that streamed from an old WordPress link get their Drive file ID set and the old
 * link removed from the lesson text. New lessons are published unless --unpublished is given.
 *
 * Dry run by default; nothing is written without --execute.
 *
 * Usage:
 *   npm run import:drive-curriculum -- --course graphics-design=<folderId> [--course slug=<folderId> ...] [--execute] [--unpublished]
 *
 * Prints progress as it reads Drive and checks files. Add --skip-drive-check to skip the per-file
 * service-account check (much faster; durations stay empty and access is not verified).
 */
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import type { drive_v3 } from 'googleapis'
import { progress, serviceAccountDrive, walkFolder as walk, type DriveItem } from '../lib/drive-folders.js'
import { slugify } from '../utils/slugify.js'
import { recalculateCourseStats } from '../collections/Lessons.js'
import { ext, leadingNumber, lessonKey, sectionKey, similar, tidyName, words } from '../lib/drive-names.js'
import { importCaptionsForCourse } from './import-captions.js'

const VIDEO = new Set(['mp4', 'mov', 'mkv', 'webm', 'm4v'])
const RESOURCE = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'ai', 'psd', 'eps', 'svg', 'jpg', 'jpeg', 'png', 'zip', 'fig', 'sketch', 'xd'])
const RESOURCES_LESSON_TITLE = 'Chapter resources'
const MIME: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', m4v: 'video/mp4',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ai: 'application/postscript', eps: 'application/postscript', psd: 'image/vnd.adobe.photoshop', svg: 'image/svg+xml',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', zip: 'application/zip',
}

interface PlannedLesson { title: string; rawName: string; order: number; driveFileId: string; mimeType: string }
interface PlannedResource { title: string; rawName: string; driveFileId: string; mimeType: string }
interface PlannedSection { title: string; rawName: string; key: string; lessons: PlannedLesson[]; resources: PlannedResource[] }
interface Skipped { path: string; reason: string }

interface SectionDoc { id: number; title: string; order: number }
interface LessonDoc {
  id: number
  title: string
  slug?: string | null
  order: number
  section: number | { id: number }
  driveFileId?: string | null
  duration?: number | null
  content?: unknown
  isPublished?: boolean | null
  resources?: Array<{ title: string; driveFileId: string; mimeType?: string | null }> | null
}

// ---------- Drive ----------

/** Checks each file through the Drive API (the access streaming uses) and reads video durations. */
async function checkFiles(drive: drive_v3.Drive, ids: string[]): Promise<{ durations: Map<string, number>; unreachable: Set<string> }> {
  const durations = new Map<string, number>()
  const unreachable = new Set<string>()
  const queue = [...ids]
  let done = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      if (++done % 100 === 0) progress(`checked ${done} of ${ids.length} files`)
      try {
        // 20 seconds per file at most; a file that doesn't answer is reported as not reachable.
        const { data } = await drive.files.get({ fileId: id, fields: 'id,videoMediaMetadata(durationMillis)', supportsAllDrives: true }, { timeout: 20_000 })
        const millis = Number(data.videoMediaMetadata?.durationMillis ?? 0)
        if (millis > 0) durations.set(id, Math.round(millis / 1000))
      } catch {
        unreachable.add(id)
      }
    }
  }))
  return { durations, unreachable }
}

// ---------- plan ----------

function planCourse(tree: DriveItem[]): { sections: PlannedSection[]; skipped: Skipped[] } {
  const sections: PlannedSection[] = []
  const skipped: Skipped[] = []

  const classify = (item: DriveItem, path: string): 'video' | 'resource' | null => {
    const extension = ext(item.name)
    if (VIDEO.has(extension)) return 'video'
    if (RESOURCE.has(extension)) return 'resource'
    skipped.push({ path: `${path}/${item.name}`, reason: extension ? `.${extension}` : 'no extension' })
    return null
  }
  const asResource = (item: DriveItem): PlannedResource => ({ title: tidyName(item.name, true), rawName: item.name, driveFileId: item.id, mimeType: MIME[ext(item.name)] ?? 'application/octet-stream' })

  /** Resources anywhere under a folder that has no videos of its own. */
  const collectResources = (folder: DriveItem, path: string, into: PlannedResource[]) => {
    for (const child of folder.children ?? []) {
      if (child.folder) {
        if (child.name === '__MACOSX') { skipped.push({ path: `${path}/${child.name}`, reason: 'macOS metadata folder' }); continue }
        collectResources(child, `${path}/${child.name}`, into)
      } else if (classify(child, path) === 'resource') into.push(asResource(child))
      else if (classify(child, path) === 'video') { /* counted by the caller */ }
    }
  }

  const hasVideos = (folder: DriveItem): boolean => (folder.children ?? []).some((child) => (child.folder ? child.name !== '__MACOSX' && hasVideos(child) : VIDEO.has(ext(child.name))))

  /** Folders with videos become sections; resource-only folders feed the nearest section. */
  const visit = (folder: DriveItem, titlePrefix: string, path: string) => {
    const direct = (folder.children ?? []).filter((child) => !child.folder)
    const videos = direct.filter((child) => VIDEO.has(ext(child.name)))
    const title = titlePrefix ? `${titlePrefix}: ${tidyName(folder.name, false)}` : tidyName(folder.name, false)
    let section: PlannedSection | undefined
    if (videos.length) {
      section = { title, rawName: folder.name, key: sectionKey(title), lessons: [], resources: [] }
      videos.forEach((video, index) => {
        section!.lessons.push({ title: tidyName(video.name, true), rawName: video.name, order: leadingNumber(video.name) ?? index + 1, driveFileId: video.id, mimeType: MIME[ext(video.name)] ?? 'video/mp4' })
      })
      sections.push(section)
    }
    for (const file of direct) if (!VIDEO.has(ext(file.name))) {
      const kind = classify(file, path)
      if (kind === 'resource') (section ?? sections[sections.length - 1] ?? pendingRoot).resources.push(asResource(file))
    }
    for (const child of (folder.children ?? []).filter((item) => item.folder)) {
      if (child.name === '__MACOSX') { skipped.push({ path: `${path}/${child.name}`, reason: 'macOS metadata folder' }); continue }
      if (hasVideos(child)) visit(child, title, `${path}/${child.name}`)
      else {
        const resources: PlannedResource[] = []
        collectResources(child, `${path}/${child.name}`, resources)
        const target = section ?? sections[sections.length - 1]
        if (target) target.resources.push(...resources)
        else if (resources.length) pendingRoot.resources.push(...resources)
        else skipped.push({ path: `${path}/${child.name}`, reason: 'folder with nothing to import' })
      }
    }
    if (!videos.length && !hasVideos(folder) && !titlePrefix) skipped.push({ path, reason: 'chapter folder with no videos' })
  }

  // Course-root files: videos make an opening section, documents go to the first chapter.
  const pendingRoot: PlannedSection = { title: 'Course introduction', rawName: '', key: sectionKey('Course introduction'), lessons: [], resources: [] }
  const rootVideos = tree.filter((item) => !item.folder && VIDEO.has(ext(item.name)))
  rootVideos.forEach((video, index) => pendingRoot.lessons.push({ title: tidyName(video.name, true), rawName: video.name, order: leadingNumber(video.name) ?? index + 1, driveFileId: video.id, mimeType: MIME[ext(video.name)] ?? 'video/mp4' }))
  for (const item of tree) {
    if (item.folder) {
      if (item.name === '__MACOSX') { skipped.push({ path: item.name, reason: 'macOS metadata folder' }); continue }
      if (hasVideos(item)) visit(item, '', item.name)
      else {
        const resources: PlannedResource[] = []
        collectResources(item, item.name, resources)
        if (resources.length) (sections[sections.length - 1] ?? pendingRoot).resources.push(...resources)
        else skipped.push({ path: item.name, reason: 'chapter folder with no videos' })
      }
    } else if (!VIDEO.has(ext(item.name))) {
      if (classify(item, '') === 'resource') pendingRoot.resources.push(asResource(item))
    }
  }
  if (pendingRoot.lessons.length) sections.unshift(pendingRoot)
  else if (pendingRoot.resources.length && sections[0]) sections[0].resources.unshift(...pendingRoot.resources)

  // One copy of each document per chapter.
  for (const section of sections) {
    const seen = new Set<string>()
    section.resources = section.resources.filter((resource) => {
      const key = resource.title.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  return { sections, skipped }
}

// ---------- content ----------

/** Removes paragraphs that only carried the old WordPress video link. */
function stripLegacyLink(content: unknown): { content: unknown; changed: boolean } {
  const root = (content as { root?: { children?: unknown[] } } | null)?.root
  if (!root?.children) return { content, changed: false }
  const kept = root.children.filter((node) => !JSON.stringify(node).includes('igd_stream'))
  if (kept.length === root.children.length) return { content, changed: false }
  if (!kept.length) return { content: null, changed: true }
  return { content: { ...(content as object), root: { ...root, children: kept } }, changed: true }
}

const hasLegacyLink = (content: unknown, fileId: string) => {
  const text = JSON.stringify(content ?? '')
  return text.includes('igd_stream') && text.includes(fileId)
}

// ---------- apply ----------

async function importCourse(payload: Payload, slug: string, folderId: string, options: { execute: boolean; publish: boolean; drive: drive_v3.Drive | null; captions: boolean }): Promise<boolean> {
  const out = (line = '') => console.log(line)
  const courses = await payload.find({ collection: 'courses', where: { slug: { equals: slug } }, limit: 1, depth: 0, overrideAccess: true })
  const course = courses.docs[0] as unknown as { id: number; title: string; driveFolderId?: string | null } | undefined
  if (!course) { out(`\n### ${slug}: no course with this slug. Skipped.`); return false }

  out(`\n### ${course.title} (${slug})`)
  progress('reading the Drive folder...')
  const tree = await walk(folderId)
  const { sections: planned, skipped } = planCourse(tree)

  const existingSections = (await payload.find({ collection: 'sections', where: { course: { equals: course.id } }, limit: 1000, depth: 0, sort: 'order', overrideAccess: true })).docs as unknown as SectionDoc[]
  const sectionIds = existingSections.map((section) => section.id)
  const existingLessons = sectionIds.length
    ? (await payload.find({ collection: 'lessons', where: { section: { in: sectionIds } }, limit: 10000, depth: 0, overrideAccess: true })).docs as unknown as LessonDoc[]
    : []
  const lessonSection = (lesson: LessonDoc) => (typeof lesson.section === 'object' ? lesson.section.id : lesson.section)
  const usedSlugs = new Set(existingLessons.map((lesson) => lesson.slug).filter(Boolean) as string[])
  const uniqueSlug = (title: string) => {
    const base = slugify(title) || 'lesson'
    let candidate = base
    for (let n = 2; usedSlugs.has(candidate); n++) candidate = `${base}-${n}`
    usedSlugs.add(candidate)
    return candidate
  }

  let check: { durations: Map<string, number>; unreachable: Set<string> } | null = null
  if (options.drive) {
    const ids = planned.flatMap((section) => [...section.lessons.map((lesson) => lesson.driveFileId), ...section.resources.map((resource) => resource.driveFileId)])
    progress(`checking ${ids.length} files with the service account (durations and access)...`)
    check = await checkFiles(options.drive, ids)
  }

  const counts = { newSections: 0, matchedSections: 0, newLessons: 0, linkedLessons: 0, unchangedLessons: 0, legacyLinksRemoved: 0, resources: 0, renamed: 0 }
  const renamed: string[] = []
  const notInDrive: string[] = []
  const context = { skipCourseStats: true }

  // Match chapters: exact wording first, then near spellings ("The Kits" / "The Kit").
  const sectionMatch = new Map<PlannedSection, SectionDoc>()
  const taken = new Set<number>()
  for (const pass of ['exact', 'similar'] as const) {
    for (const plan of planned) {
      if (sectionMatch.has(plan)) continue
      const found = existingSections.find((section) => !taken.has(section.id) && (pass === 'exact' ? sectionKey(section.title) === plan.key : similar(sectionKey(section.title), plan.key)))
      if (found) { sectionMatch.set(plan, found); taken.add(found.id) }
    }
  }
  // Final chapter order: Drive order, with site-only chapters kept after the chapter they followed.
  type Slot = { plan?: PlannedSection; existing?: SectionDoc }
  const slots: Slot[] = planned.map((plan) => ({ plan, existing: sectionMatch.get(plan) }))
  for (const section of existingSections.filter((item) => !taken.has(item.id))) {
    const before = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.existing && slot.existing.order < section.order).pop()
    slots.splice(before ? before.index + 1 : 0, 0, { existing: section })
    notInDrive.push(`chapter "${section.title}" (kept)`)
  }

  progress(options.execute ? 'writing chapters and lessons...' : 'planning (dry run)...')
  for (const [index, slot] of slots.entries()) {
    const order = index + 1
    const existing = slot.existing
    const plan = slot.plan
    if (!plan) {
      if (existing && existing.order !== order && options.execute) await payload.update({ collection: 'sections', id: existing.id, data: { order }, overrideAccess: true, context })
      out(`  . Chapter ${order}: ${existing?.title} (on the site only, kept)`)
      continue
    }
    let sectionId: number
    if (existing) {
      counts.matchedSections++
      const tidyTitle = tidyName(existing.title, false)
      const data: Record<string, unknown> = {}
      if (existing.order !== order) data.order = order
      if (tidyTitle !== existing.title) { data.title = tidyTitle; renamed.push(`chapter "${existing.title}" -> "${tidyTitle}"`) }
      if (options.execute && Object.keys(data).length) await payload.update({ collection: 'sections', id: existing.id, data, overrideAccess: true, context })
      sectionId = existing.id
      out(`  = Chapter ${order}: ${existing.title}${data.title ? ` (renamed "${data.title}")` : ''}${sectionKey(existing.title) !== plan.key ? ` (matched Drive folder "${plan.title}")` : ''}`)
    } else {
      counts.newSections++
      sectionId = options.execute
        ? Number(((await payload.create({ collection: 'sections', data: { title: plan.title, order, course: course.id }, overrideAccess: true, context })) as unknown as { id: number }).id)
        : -order
      out(`  + Chapter ${order}: ${plan.title} (new)`)
    }
    if (plan.rawName && tidyName(plan.rawName, false) !== plan.rawName.trim()) renamed.push(`chapter "${plan.rawName}" -> "${tidyName(plan.rawName, false)}"`)

    // Match lessons: Drive file (or old WordPress link to it), then number + wording, then wording alone when unique.
    const sectionLessons = existing ? existingLessons.filter((lesson) => lessonSection(lesson) === existing.id && lesson.title !== RESOURCES_LESSON_TITLE) : []
    const lessonMatch = new Map<PlannedLesson, LessonDoc>()
    const used = new Set<number>()
    const claim = (lesson: PlannedLesson, found: LessonDoc | undefined) => { if (found) { lessonMatch.set(lesson, found); used.add(found.id) } }
    for (const lesson of plan.lessons) claim(lesson, sectionLessons.find((item) => !used.has(item.id) && (item.driveFileId === lesson.driveFileId || hasLegacyLink(item.content, lesson.driveFileId))))
    for (const lesson of plan.lessons) if (!lessonMatch.has(lesson)) claim(lesson, sectionLessons.find((item) => !used.has(item.id) && lessonKey(item.title) === lessonKey(lesson.title)))
    for (const lesson of plan.lessons) {
      if (lessonMatch.has(lesson)) continue
      const key = words(lesson.title)
      const candidates = sectionLessons.filter((item) => !used.has(item.id) && words(item.title) === key)
      const sameInDrive = plan.lessons.filter((other) => !lessonMatch.has(other) && words(other.title) === key)
      if (candidates.length === 1 && sameInDrive.length === 1) claim(lesson, candidates[0])
    }

    // Lesson order: Drive order, site-only lessons before or after depending on where they were.
    const driveOrdered = [...plan.lessons].sort((a, b) => a.order - b.order)
    const matchedOrders = [...lessonMatch.values()].map((item) => item.order)
    const firstMatched = matchedOrders.length ? Math.min(...matchedOrders) : Infinity
    const kept = sectionLessons.filter((item) => !used.has(item.id)).sort((a, b) => a.order - b.order)
    const keptBefore = kept.filter((item) => item.order < firstMatched)
    const keptAfter = kept.filter((item) => item.order >= firstMatched)
    let position = 0
    for (const item of keptBefore) {
      position++
      notInDrive.push(`${existing?.title}: ${item.title}`)
      if (options.execute && item.order !== position) await payload.update({ collection: 'lessons', id: item.id, data: { order: position }, overrideAccess: true, context })
    }

    let added = 0
    let linked = 0
    for (const lesson of driveOrdered) {
      position++
      const duration = check?.durations.get(lesson.driveFileId)
      const match = lessonMatch.get(lesson)
      if (lesson.title !== lesson.rawName.replace(/\.[a-z0-9]{1,6}$/i, '').trim()) { counts.renamed++; renamed.push(`"${lesson.rawName}" -> "${lesson.title}"`) }
      if (match) {
        const data: Record<string, unknown> = {}
        if (match.driveFileId !== lesson.driveFileId) data.driveFileId = lesson.driveFileId
        if (match.order !== position) data.order = position
        if (duration && !match.duration) data.duration = duration
        const tidyTitle = tidyName(match.title, false)
        if (tidyTitle !== match.title) { data.title = tidyTitle; renamed.push(`lesson "${match.title}" -> "${tidyTitle}"`) }
        const stripped = stripLegacyLink(match.content)
        if (stripped.changed) { data.content = stripped.content; counts.legacyLinksRemoved++ }
        if (data.driveFileId) { counts.linkedLessons++; linked++ } else counts.unchangedLessons++
        if (options.execute && Object.keys(data).length) await payload.update({ collection: 'lessons', id: match.id, data, overrideAccess: true, context })
      } else {
        counts.newLessons++
        added++
        if (options.execute) {
          await payload.create({
            collection: 'lessons',
            data: { title: lesson.title, slug: uniqueSlug(lesson.title), order: position, section: sectionId, driveFileId: lesson.driveFileId, duration: duration ?? 0, isFree: false, isPublished: options.publish },
            overrideAccess: true,
            context,
          })
        }
      }
    }
    for (const item of keptAfter) {
      position++
      notInDrive.push(`${existing?.title}: ${item.title}`)
      if (options.execute && item.order !== position) await payload.update({ collection: 'lessons', id: item.id, data: { order: position }, overrideAccess: true, context })
    }

    if (plan.resources.length) {
      position++
      counts.resources += plan.resources.length
      const resourcesLesson = existing ? existingLessons.find((item) => lessonSection(item) === existing.id && item.title === RESOURCES_LESSON_TITLE) : undefined
      const resources = plan.resources.map((resource) => ({ title: resource.title, driveFileId: resource.driveFileId, mimeType: resource.mimeType }))
      if (options.execute) {
        if (resourcesLesson) await payload.update({ collection: 'lessons', id: resourcesLesson.id, data: { resources, order: position }, overrideAccess: true, context })
        else await payload.create({ collection: 'lessons', data: { title: RESOURCES_LESSON_TITLE, slug: uniqueSlug(`${plan.title} resources`), order: position, section: sectionId, resources, isFree: false, isPublished: options.publish }, overrideAccess: true, context })
      }
    }
    out(`      ${plan.lessons.length} videos: ${added} new, ${linked} linked to Drive${kept.length ? `; ${kept.length} site-only lessons kept` : ''}${plan.resources.length ? `; ${plan.resources.length} documents in "${RESOURCES_LESSON_TITLE}"` : ''}`)
  }

  if (options.execute) {
    if (course.driveFolderId !== folderId) await payload.update({ collection: 'courses', id: course.id, data: { driveFolderId: folderId }, overrideAccess: true })
    await recalculateCourseStats(course.id, payload as unknown as Parameters<typeof recalculateCourseStats>[1])
    // New lessons get their captions straight away (reuses the folder listing).
    if (options.captions) await importCaptionsForCourse(payload, slug, { execute: true, folderId, tree })
  }

  out(`\n  Summary: ${planned.length} chapters (${counts.newSections} new, ${counts.matchedSections} existing); lessons: ${counts.newLessons} new${counts.newLessons ? options.publish ? ' (published)' : ' (unpublished)' : ''}, ${counts.linkedLessons} existing linked to Drive, ${counts.unchangedLessons} existing already up to date; ${counts.legacyLinksRemoved} old WordPress links removed; ${counts.resources} documents.`)
  if (renamed.length) out(`  Tidied names (${renamed.length}):\n${[...new Set(renamed)].map((line) => `    - ${line}`).join('\n')}`)
  if (notInDrive.length) out(`  On the site but not in Drive (kept as they are) (${notInDrive.length}):\n${notInDrive.map((line) => `    - ${line}`).join('\n')}`)
  if (skipped.length) {
    const byReason = new Map<string, number>()
    for (const item of skipped) byReason.set(item.reason, (byReason.get(item.reason) ?? 0) + 1)
    out(`  Skipped files (${skipped.length}): ${[...byReason].map(([reason, count]) => `${reason} x${count}`).join(', ')}`)
    const folders = skipped.filter((item) => /folder/.test(item.reason))
    if (folders.length) out(folders.map((item) => `    - ${item.path} (${item.reason})`).join('\n'))
  }
  if (check) {
    out(`  Drive check (service account): ${check.unreachable.size ? `${check.unreachable.size} files NOT reachable; share the folder with the service account as Viewer` : 'every file reachable'}; durations found for ${check.durations.size} videos.`)
    if (check.unreachable.size) {
      const names = new Map(planned.flatMap((section) => [...section.lessons, ...section.resources].map((item) => [item.driveFileId, `${section.title} / ${item.title}`] as const)))
      out([...check.unreachable].slice(0, 30).map((id) => `    - ${names.get(id) ?? id}`).join('\n'))
    }
  } else out('  Drive check skipped: GOOGLE_SERVICE_ACCOUNT_KEY is not set here, so reachability and durations were not checked.')
  return true
}

async function run(): Promise<void> {
  const args = process.argv.slice(2)
  const execute = args.includes('--execute')
  const publish = !args.includes('--unpublished')
  // Skips the per-file service-account check: faster, but durations stay empty and access isn't verified.
  const skipDriveCheck = args.includes('--skip-drive-check')
  // Captions are imported after each course unless --skip-captions.
  const captions = !args.includes('--skip-captions')
  const courses: Array<[string, string]> = []
  args.forEach((arg, index) => {
    const value = args[index + 1]
    if (arg === '--course' && value) {
      const [slug, raw] = value.split('=')
      const folderId = /folders\/([A-Za-z0-9_-]+)/.exec(raw ?? '')?.[1] ?? raw
      if (slug && folderId) courses.push([slug.trim(), folderId.trim()])
    }
  })
  if (!courses.length) {
    console.log('Usage: npm run import:drive-curriculum -- --course <course-slug>=<drive-folder-id-or-link> [--course ...] [--execute] [--unpublished]')
    process.exit(1)
  }
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  const drive = skipDriveCheck ? null : serviceAccountDrive()
  if (!skipDriveCheck && !drive) console.log('Note: GOOGLE_SERVICE_ACCOUNT_KEY is missing or unreadable here, so files are not checked.')

  console.log(execute ? 'EXECUTING: changes will be written.' : 'DRY RUN: nothing is written. Re-run with --execute to apply.')
  let failed = 0
  for (const [slug, folderId] of courses) {
    try {
      if (!(await importCourse(payload, slug, folderId, { execute, publish, drive, captions }))) failed++
    } catch (err) {
      failed++
      console.error(`\n### ${slug}: FAILED (${err instanceof Error ? err.message : String(err)})`)
    }
  }
  process.exit(failed ? 1 : 0)
}

void run()
