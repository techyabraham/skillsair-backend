import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload, PayloadRequest } from 'payload'
import { createTestUser, describeWithDb, getTestPayload, truncate } from '../../test/payload-harness.js'
import { resetFakeRedis } from '../../test/fake-redis.js'
import { requiredWatchSeconds, roughLength } from '../../lib/lesson-viewing.js'

const auth = vi.hoisted(() => ({ userId: 0 }))
const drive = vi.hoisted(() => ({ seconds: null as number | null }))

vi.mock('../../middleware/authenticate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../middleware/authenticate.js')>()),
  requireAuth: vi.fn(async () => ({ id: auth.userId, email: 'learner@example.com', role: 'student' })),
}))
vi.mock('../../lib/lesson-viewing.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/lesson-viewing.js')>()),
  driveVideoSeconds: vi.fn(async () => drive.seconds),
}))

const { progressEndpoint } = await import('./progress.js')

describe('how much of a video counts as watched', () => {
  it('asks for 90% of the video, never more than all but the last 5 seconds', () => {
    expect(requiredWatchSeconds(0)).toBe(0)
    expect(requiredWatchSeconds(10)).toBe(5)
    expect(requiredWatchSeconds(150)).toBe(135)
    expect(requiredWatchSeconds(600)).toBe(540)
    expect(roughLength(40)).toBe('about 40 seconds')
    expect(roughLength(150)).toBe('about 3 minutes')
  })
})

describeWithDb('POST /courses/:courseId/lessons/:lessonId/progress', () => {
  let payload: Payload
  let courseId: number
  let serial = 0

  const lesson = async (data: Record<string, unknown>) => {
    const section = await payload.create({ collection: 'sections', data: { title: `Chapter ${++serial}`, order: serial, course: courseId } as never, overrideAccess: true })
    return Number((await payload.create({ collection: 'lessons', data: { title: `Lesson ${serial}`, order: 1, section: section.id, isPublished: true, ...data } as never, overrideAccess: true })).id)
  }
  const post = async (lessonId: number, body: Record<string, unknown>) => {
    const req = { payload, routeParams: { courseId: String(courseId), lessonId: String(lessonId) }, json: async () => body } as unknown as PayloadRequest
    const response = await progressEndpoint.handler(req)
    return { status: response.status, body: (await response.json()) as { success: boolean; error?: { message: string } } }
  }
  const watched = async (lessonId: number) => {
    const docs = (await payload.find({ collection: 'lesson-progress', where: { and: [{ student: { equals: auth.userId } }, { lesson: { equals: lessonId } }] }, depth: 0, overrideAccess: true })).docs
    return docs[0] ? { seconds: Number(docs[0].watchedSeconds), completed: Boolean(docs[0].isCompleted) } : null
  }

  beforeAll(async () => { payload = await getTestPayload() })
  beforeEach(async () => {
    await truncate(payload, ['lesson_progress', 'lessons', 'sections', 'enrollments', 'courses', 'users'])
    resetFakeRedis()
    drive.seconds = null
    courseId = Number((await payload.create({ collection: 'courses', data: { title: 'Cyber Security', slug: `cyber-${++serial}`, status: 'published', price: 50000 } as never, overrideAccess: true, context: { skipCache: true } })).id)
    auth.userId = (await createTestUser(payload)).id
    await payload.create({ collection: 'enrollments', data: { student: auth.userId, course: courseId, status: 'active', orderId: `pay-${serial}` }, overrideAccess: true })
  })

  it('adds up watch time from separate visits, so a video watched in two halves completes', async () => {
    const id = await lesson({ duration: 200, driveFileId: 'file-a' })
    expect((await post(id, { watchedDelta: 100, isCompleted: false })).status).toBe(200)
    const early = await post(id, { watchedDelta: 0, isCompleted: true })
    expect(early.status).toBe(400)
    expect(early.body.error?.message).toBe('Watch the rest of this video first (about a minute left), then mark it complete.')
    expect(await watched(id)).toEqual({ seconds: 100, completed: false })

    const done = await post(id, { watchedDelta: 90, isCompleted: true })
    expect(done.status).toBe(200)
    expect(await watched(id)).toEqual({ seconds: 190, completed: true })
  })

  it('saves the time watched even when the lesson isn’t accepted yet, and never counts past the video’s length', async () => {
    const id = await lesson({ duration: 120, driveFileId: 'file-b' })
    expect((await post(id, { watchedDelta: 30, isCompleted: true })).status).toBe(400)
    expect(await watched(id)).toEqual({ seconds: 30, completed: false })
    await post(id, { watchedDelta: 500, isCompleted: false })
    expect((await watched(id))!.seconds).toBe(120)
  })

  it('checks the real length on Drive before refusing, and corrects the lesson', async () => {
    // Stored as 2h 30m by an old import; the intro video is really 1:10.
    const id = await lesson({ duration: 9000, driveFileId: 'file-intro', isFree: true })
    drive.seconds = 70
    const response = await post(id, { watchedDelta: 68, isCompleted: true })
    expect(response.status).toBe(200)
    expect(await watched(id)).toEqual({ seconds: 68, completed: true })
    expect((await payload.findByID({ collection: 'lessons', id, depth: 0, overrideAccess: true })).duration).toBe(70)
  })

  it('completes lessons with no video length at once, and still takes the older watchedSeconds form', async () => {
    const reading = await lesson({ duration: 0 })
    expect((await post(reading, { watchedSeconds: 0, isCompleted: true })).status).toBe(200)
    const video = await lesson({ duration: 60, driveFileId: 'file-c' })
    expect((await post(video, { watchedSeconds: 58, isCompleted: true })).status).toBe(200)
    expect(await watched(video)).toEqual({ seconds: 58, completed: true })
  })
})
