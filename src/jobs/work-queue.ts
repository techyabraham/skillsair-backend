import type { SanitizedConfig } from 'payload'
import { getPayload } from 'payload'
import { jobScheduler } from './scheduler.js'
import { logger } from '../lib/logger.js'
import { processQueue } from '../lib/work-queue.js'
import { importCaptionsForCourse } from '../migrations/import-captions.js'

const cron = jobScheduler('work-queue')

/** Every minute: slow tasks queued from Studio (caption re-imports), never inside an API request. */
export function registerWorkQueueJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule('* * * * *', async () => {
    const payload = await getPayload({ config })
    const processed = await processQueue({
      'captions-import': async (task) => {
        const slug = String(task.payload.slug ?? '')
        const report = await importCaptionsForCourse(payload, slug, { force: Boolean(task.payload.force) })
        if (!report) throw new Error(`Captions could not be imported for ${slug} (no Drive folder recorded?)`)
      },
    })
    if (processed) logger.info({ processed }, 'work_queue_processed')
  })
}
