import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { describeWithDb, getTestPayload, truncate } from '../test/payload-harness.js'
import { resetFakeRedis } from '../test/fake-redis.js'

const lengths = vi.hoisted(() => new Map<string, number>())
vi.mock('../lib/drive-folders.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/drive-folders.js')>()),
  videoDurationSeconds: vi.fn(async (fileId: string) => lengths.get(fileId) ?? null),
}))

const { syncCourseDurations } = await import('./sync-lesson-durations.js')

describeWithDb('lessons:sync-durations', () => {
  let payload: Payload
  let courseId: number
  const lessonIds: Record<string, number> = {}

  beforeAll(async () => { payload = await getTestPayload() })
  beforeEach(async () => {
    await truncate(payload, ['lessons', 'sections', 'courses'])
    resetFakeRedis()
    lengths.clear()
    courseId = Number((await payload.create({ collection: 'courses', data: { title: 'UI/UX', slug: 'uiux-sync', status: 'published', price: 50000 } as never, overrideAccess: true, context: { skipCache: true } })).id)
    const section = await payload.create({ collection: 'sections', data: { title: 'Introduction', order: 1, course: courseId } as never, overrideAccess: true })
    const add = async (key: string, data: Record<string, unknown>, order: number) => {
      lessonIds[key] = Number((await payload.create({ collection: 'lessons', data: { title: key, order, section: section.id, isPublished: true, ...data } as never, overrideAccess: true })).id)
    }
    await add('wrong', { driveFileId: 'f1', duration: 9000 }, 1)
    await add('right', { driveFileId: 'f2', duration: 300 }, 2)
    await add('missing', { driveFileId: 'f3', duration: 0 }, 3)
    await add('unknown', { driveFileId: 'f4', duration: 45 }, 4)
    await add('reading', { duration: 0 }, 5)
    lengths.set('f1', 70).set('f2', 301).set('f3', 512)
  })

  const durations = async () => Object.fromEntries(await Promise.all(Object.entries(lessonIds).map(async ([key, id]) => [key, (await payload.findByID({ collection: 'lessons', id, depth: 0, overrideAccess: true })).duration])))

  it('a dry run reports the corrections and writes nothing', async () => {
    const report = await syncCourseDurations(payload, 'uiux-sync', false)
    expect(report!.changed.map((item) => [item.title, item.from, item.to])).toEqual([['wrong', 9000, 70], ['missing', 0, 512]])
    expect(report!.unknown).toEqual(['unknown'])
    expect((await durations()).wrong).toBe(9000)
  })

  it('--execute sets each lesson to its Drive length and updates the programme total', async () => {
    await syncCourseDurations(payload, 'uiux-sync', true)
    expect(await durations()).toEqual({ wrong: 70, right: 300, missing: 512, unknown: 45, reading: 0 })
    expect((await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true })).totalDuration).toBe(70 + 300 + 512 + 45)
  })
})
