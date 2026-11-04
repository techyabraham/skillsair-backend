/**
 * How much of a lesson's video a learner must have watched before "Mark as Complete" is accepted,
 * and the video's real length from Drive when the stored one may be wrong.
 */
import { CACHE_KEYS, cachedJson } from './cache.js'
import { videoDurationSeconds } from './drive-folders.js'

/**
 * 90% of the video, and never more than all but its last 5 seconds. Watch time is counted on the
 * learner's device while the video plays; buffering, skipping the credits or a dropped heartbeat
 * mean a full viewing rarely counts to the exact second.
 */
export function requiredWatchSeconds(durationSeconds: number): number {
  if (!(durationSeconds > 0)) return 0
  return Math.max(0, Math.min(durationSeconds - 5, Math.floor(durationSeconds * 0.9)))
}

/** "about 2 minutes" / "about 40 seconds", for telling a learner how much is left. */
export function roughLength(seconds: number): string {
  if (seconds >= 90) return `about ${Math.round(seconds / 60)} minutes`
  if (seconds >= 60) return 'about a minute'
  return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`
}

/** The Drive video's length in seconds (cached for a day, including "unknown"), or null. */
export async function driveVideoSeconds(fileId: string): Promise<number | null> {
  const seconds = await cachedJson(CACHE_KEYS.videoLength(fileId), 24 * 60 * 60, async () => (await videoDurationSeconds(fileId)) ?? 0)
  return seconds > 0 ? seconds : null
}
