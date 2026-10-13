/**
 * Imports courses, sections, and lessons from a WordPress/TutorLMS CSV export.
 *
 * Expected CSV columns (one row per lesson, or one course-only row for an empty course):
 *   course_title, course_slug (optional), instructor_email (optional),
 *   price (optional, default 0), level (optional: beginner|intermediate|advanced, default beginner),
 *   status (optional: draft|published, default draft), category (optional),
 *   section_title, section_order,
 *   lesson_title, lesson_order, lesson_duration (optional seconds), lesson_drive_file_id (optional),
 *   is_free (optional: true|false, default false)
 *   is_published (optional: true|false, defaults to course status)
 *   course_short_description, course_description_json, course_thumbnail_source_url,
 *   course_preview_video, lesson_content_json, lesson_attachment_source_urls_json (optional)
 *
 * Courses/sections are created once and reused across rows that share the same course/section.
 *
 * Usage:
 *   node --loader ts-node/esm src/migrations/import-courses.ts <csv-path> [--execute]
 */
import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'

import { slugify } from '../utils/slugify.js'
import { sanitizeText } from '../utils/sanitize.js'

interface CourseCsvRow {
  course_title: string
  course_slug?: string
  instructor_email?: string
  price?: string
  level?: string
  status?: string
  category?: string
  section_title: string
  section_order: string
  lesson_title: string
  lesson_order: string
  lesson_duration?: string
  lesson_drive_file_id?: string
  is_free?: string
  is_published?: string
  course_short_description?: string
  course_description_json?: string
  course_thumbnail_source_url?: string
  course_preview_video?: string
  lesson_content_json?: string
  lesson_attachment_source_urls_json?: string
}

const VALID_LEVELS = new Set(['beginner', 'intermediate', 'advanced'])
const VALID_STATUSES = new Set(['draft', 'published'])

interface Summary {
  total: number
  coursesCreated: number
  sectionsCreated: number
  lessonsCreated: number
  lessonsSkipped: number
  failed: number
}

async function run(): Promise<void> {
  const csvPath = process.argv[2]
  const execute = process.argv.includes('--execute')

  if (!csvPath) {
    console.error('Usage: import-courses.ts <csv-path> [--execute]')
    process.exitCode = 1
    return
  }

  const rows = parse(readFileSync(csvPath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CourseCsvRow[]

  // Lessons use slugs that are unique across a whole course, not only within
  // a section. Tutor exports often repeat generic titles such as "Introduction"
  // in multiple sections, so count collisions before importing and give only
  // those repeated titles a stable section/order/row suffix.
  const lessonSlugCounts = new Map<string, number>()
  for (const row of rows) {
    const courseTitle = sanitizeText(row.course_title)
    const lessonTitle = sanitizeText(row.lesson_title)
    if (!courseTitle || !lessonTitle) continue
    const courseSlug = row.course_slug?.trim() || slugify(courseTitle)
    const lessonSlug = slugify(lessonTitle) || 'lesson'
    const key = `${courseSlug}::${lessonSlug}`
    lessonSlugCounts.set(key, (lessonSlugCounts.get(key) ?? 0) + 1)
  }

  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })

  const summary: Summary = {
    total: rows.length,
    coursesCreated: 0,
    sectionsCreated: 0,
    lessonsCreated: 0,
    lessonsSkipped: 0,
    failed: 0,
  }

  const courseIdBySlug = new Map<string, number | string>()
  const sectionIdByKey = new Map<string, number | string>()
  const categoryIdByName = new Map<string, number | string>()
  const mediaIdByUrl = new Map<string, number | string>()

  async function mediaId(url: string): Promise<number | string> {
    const cached = mediaIdByUrl.get(url)
    if (cached !== undefined) return cached
    const media = await payload.find({ collection: 'media', where: { sourceUrl: { equals: url } }, limit: 1, depth: 0, overrideAccess: true })
    if (!media.docs[0]) throw new Error(`media not imported: ${url}`)
    mediaIdByUrl.set(url, media.docs[0].id)
    return media.docs[0].id
  }

  for (const [index, row] of rows.entries()) {
    const rowLabel = `row ${index + 2}`
    try {
      const courseTitle = sanitizeText(row.course_title)
      if (!courseTitle) throw new Error('missing course_title')
      const courseSlug = row.course_slug?.trim() || slugify(courseTitle)

      const sectionTitle = sanitizeText(row.section_title)
      const sectionOrder = Number(row.section_order)
      const lessonTitle = sanitizeText(row.lesson_title)
      const lessonOrder = Number(row.lesson_order)
      const hasLesson = Boolean(lessonTitle)
      if (hasLesson && !sectionTitle) throw new Error('missing section_title')
      if (hasLesson && !Number.isFinite(sectionOrder)) throw new Error('invalid section_order')
      if (hasLesson && !Number.isFinite(lessonOrder)) throw new Error('invalid lesson_order')
      if (!hasLesson && sectionTitle) throw new Error('section_title requires lesson_title')

      const level = row.level?.trim().toLowerCase() || 'beginner'
      if (!VALID_LEVELS.has(level)) throw new Error(`invalid level: "${row.level ?? ''}"`)
      const status = row.status?.trim().toLowerCase() || 'draft'
      if (!VALID_STATUSES.has(status)) throw new Error(`invalid status: "${row.status ?? ''}"`)
      const price = row.price ? Number(row.price) : 0
      if (!Number.isFinite(price) || price < 0) throw new Error(`invalid price: "${row.price ?? ''}"`)
      const isFree = row.is_free?.trim().toLowerCase() === 'true'
      const isPublished = row.is_published ? row.is_published.trim().toLowerCase() === 'true' : status === 'published'
      const duration = row.lesson_duration ? Number(row.lesson_duration) : 0
      if (!Number.isFinite(duration) || duration < 0) throw new Error('invalid lesson_duration')
      const courseDescription = row.course_description_json ? JSON.parse(row.course_description_json) : undefined
      const lessonContent = row.lesson_content_json ? JSON.parse(row.lesson_content_json) : undefined
      const attachmentUrls = row.lesson_attachment_source_urls_json ? JSON.parse(row.lesson_attachment_source_urls_json) as string[] : []
      if (!Array.isArray(attachmentUrls) || attachmentUrls.some((url) => typeof url !== 'string')) throw new Error('invalid lesson_attachment_source_urls_json')

      let courseId = courseIdBySlug.get(courseSlug)
      if (courseId === undefined) {
        const existingCourse = await payload.find({
          collection: 'courses',
          where: { slug: { equals: courseSlug } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        if (existingCourse.docs.length > 0) {
          courseId = existingCourse.docs[0]!.id as number | string
        } else if (execute) {
          let instructorId: number | string | undefined
          if (row.instructor_email) {
            const instructor = await payload.find({
              collection: 'users',
              where: { email: { equals: row.instructor_email.trim().toLowerCase() } },
              limit: 1,
              depth: 0,
              overrideAccess: true,
            })
            instructorId = instructor.docs[0]?.id as number | string | undefined
          }

          let categoryIds: Array<number | string> = []
          if (row.category) {
            const categoryName = sanitizeText(row.category)
            let categoryId = categoryIdByName.get(categoryName)
            if (categoryId === undefined) {
              const existingCategory = await payload.find({
                collection: 'categories',
                where: { name: { equals: categoryName } },
                limit: 1,
                depth: 0,
                overrideAccess: true,
              })
              if (existingCategory.docs.length > 0) {
                categoryId = existingCategory.docs[0]!.id as number | string
              } else {
                const created = await payload.create({
                  collection: 'categories',
                  data: { name: categoryName },
                  overrideAccess: true,
                })
                categoryId = created.id
              }
              categoryIdByName.set(categoryName, categoryId)
            }
            categoryIds = [categoryId]
          }

          const created = await payload.create({
            collection: 'courses',
            data: {
              title: courseTitle,
              slug: courseSlug,
              price,
              level: level as 'beginner' | 'intermediate' | 'advanced',
              status: status as 'draft' | 'published',
              ...(row.course_short_description ? { shortDescription: sanitizeText(row.course_short_description) } : {}),
              ...(courseDescription ? { description: courseDescription } : {}),
              ...(row.course_thumbnail_source_url ? { thumbnail: await mediaId(row.course_thumbnail_source_url) } : {}),
              ...(row.course_preview_video ? { previewVideo: row.course_preview_video.trim() } : {}),
              ...(instructorId !== undefined ? { instructor: instructorId } : {}),
              ...(categoryIds.length > 0 ? { categories: categoryIds } : {}),
            },
            overrideAccess: true,
          })
          courseId = created.id
          summary.coursesCreated += 1
        } else {
          console.log(`WOULD CREATE COURSE  ${courseTitle}`)
          summary.coursesCreated += 1
        }
        if (courseId !== undefined) courseIdBySlug.set(courseSlug, courseId)
      }

      // A course with no lessons still needs a row so its metadata can be imported.
      if (!hasLesson) continue

      const sectionKey = `${courseSlug}::${sectionTitle}`
      let sectionId = sectionIdByKey.get(sectionKey)
      if (sectionId === undefined) {
        if (courseId !== undefined) {
          const existingSection = await payload.find({
            collection: 'sections',
            where: { and: [{ course: { equals: courseId } }, { title: { equals: sectionTitle } }] },
            limit: 1,
            depth: 0,
            overrideAccess: true,
          })
          if (existingSection.docs.length > 0) {
            sectionId = existingSection.docs[0]!.id as number | string
          }
        }
        if (sectionId === undefined && execute && courseId !== undefined) {
          const created = await payload.create({
            collection: 'sections',
            data: { title: sectionTitle, order: sectionOrder, course: courseId },
            overrideAccess: true,
          })
          sectionId = created.id
          summary.sectionsCreated += 1
        } else if (sectionId === undefined && !execute) {
          console.log(`WOULD CREATE SECTION  ${courseTitle} / ${sectionTitle}`)
          summary.sectionsCreated += 1
        }
        if (sectionId !== undefined) sectionIdByKey.set(sectionKey, sectionId)
      }

      if (!execute) {
        console.log(`WOULD CREATE LESSON  ${courseTitle} / ${sectionTitle} / ${lessonTitle}`)
        summary.lessonsCreated += 1
        continue
      }

      if (sectionId === undefined) throw new Error('section was not created/found')

      const existingLesson = await payload.find({
        collection: 'lessons',
        where: { and: [{ section: { equals: sectionId } }, { title: { equals: lessonTitle } }] },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      if (existingLesson.docs.length > 0) {
        console.log(`SKIP LESSON  ${courseTitle} / ${sectionTitle} / ${lessonTitle} (already exists)`)
        summary.lessonsSkipped += 1
        continue
      }

      const baseLessonSlug = slugify(lessonTitle) || 'lesson'
      const lessonSlugKey = `${courseSlug}::${baseLessonSlug}`
      const lessonSlug = (lessonSlugCounts.get(lessonSlugKey) ?? 0) > 1
        ? slugify(`${baseLessonSlug}-${sectionOrder}-${lessonOrder}-${index + 2}`)
        : baseLessonSlug

      await payload.create({
        collection: 'lessons',
        data: {
          title: lessonTitle,
          slug: lessonSlug,
          order: lessonOrder,
          duration,
          isFree,
          isPublished,
          section: sectionId,
          ...(row.lesson_drive_file_id ? { driveFileId: row.lesson_drive_file_id.trim() } : {}),
          ...(lessonContent ? { content: lessonContent } : {}),
          ...(attachmentUrls.length ? { attachments: await Promise.all(attachmentUrls.map(mediaId)) } : {}),
        },
        overrideAccess: true,
      })
      console.log(`CREATED LESSON  ${courseTitle} / ${sectionTitle} / ${lessonTitle}`)
      summary.lessonsCreated += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`FAILED  ${rowLabel}: ${message}`)
      summary.failed += 1
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`)
  console.log(`Total rows: ${summary.total}`)
  console.log(`Courses created: ${summary.coursesCreated}`)
  console.log(`Sections created: ${summary.sectionsCreated}`)
  console.log(`Lessons created: ${summary.lessonsCreated}`)
  console.log(`Lessons skipped (existing): ${summary.lessonsSkipped}`)
  console.log(`Failed: ${summary.failed}`)

  await payload.destroy()
}

run().catch((err: unknown) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
