/**
 * Runs work once the current hook has returned, outside its database transaction.
 *
 * Collection hooks run inside the transaction of the save that triggered them, which is holding a
 * pooled connection. Anything slow or deep called from a hook (lifecycle events, emails, course
 * stats) asks the pool for more connections while that one stays held; enough saves at once then
 * wait on each other forever. Queries a hook needs for itself pass `req` and share the
 * transaction's connection; everything else goes through here.
 *
 * A failure is logged and reported. It can't fail the save that triggered it.
 */
import { logger } from './logger.js'
import { captureError } from './observability.js'

export function afterCommit(label: string, work: () => Promise<unknown>): void {
  setImmediate(() => {
    void work().catch((err: unknown) => {
      logger.error({ err, label }, 'after_commit_failed')
      captureError(err, { source: 'after-commit', label })
    })
  })
}
