/**
 * Small Redis cache helpers. A cache miss or an unavailable Redis never fails a request: callers
 * fall back to the source of truth.
 */
import { redis } from './redis.js'
import { logger } from './logger.js'

export const CACHE_KEYS = {
  captions: (lessonId: number | string, lang: string) => `cache:captions:${lessonId}:${lang}`,
  transcript: (lessonId: number | string) => `cache:transcript:${lessonId}`,
  driveMeta: (fileId: string) => `cache:drive-meta:${fileId}`,
  curriculum: (courseId: number | string) => `cache:curriculum:${courseId}`,
  quizPool: (courseId: number | string) => `cache:quiz-pool:${courseId}`,
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await redis.get(key)
  } catch (err) {
    logger.warn({ err, key }, 'cache_get_failed')
    return null
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, value, 'EX', ttlSeconds)
  } catch (err) {
    logger.warn({ err, key }, 'cache_set_failed')
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (!keys.length) return
  try {
    await redis.del(...keys)
  } catch (err) {
    logger.warn({ err, keys }, 'cache_del_failed')
  }
}

/** Cached JSON: returns the cached value, or computes, stores and returns it. */
export async function cachedJson<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cacheGet(key)
  if (hit) {
    try {
      return JSON.parse(hit) as T
    } catch {
      // corrupt entry: recompute
    }
  }
  const value = await compute()
  await cacheSet(key, JSON.stringify(value), ttlSeconds)
  return value
}

/**
 * Per-programme cache generation. Curriculum and quiz-pool keys include it, so one INCR (from the
 * course, section, lesson, quiz and question hooks) retires every cached copy for that programme.
 */
const generationKey = (courseId: number | string) => `cache:course-gen:${courseId}`

export async function courseCacheGeneration(courseId: number | string): Promise<string> {
  return (await cacheGet(generationKey(courseId))) ?? '0'
}

export async function bumpCourseCache(courseId: number | string | null | undefined): Promise<void> {
  if (courseId === null || courseId === undefined || courseId === '') return
  try {
    await redis.incr(generationKey(courseId))
  } catch (err) {
    logger.warn({ err, courseId }, 'cache_bump_failed')
  }
}

/** Hook helper: bumps the programme of the changed document (its `course` field, or itself). */
export function bumpCourseCacheHook(field: 'course' | 'id' = 'course') {
  return async ({ doc }: { doc: Record<string, unknown> }): Promise<void> => {
    const value = doc[field]
    const id = value && typeof value === 'object' ? (value as { id?: number | string }).id : (value as number | string | undefined)
    await bumpCourseCache(id)
  }
}
