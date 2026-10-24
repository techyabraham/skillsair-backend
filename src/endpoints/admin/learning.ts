import type { Endpoint, PayloadRequest } from 'payload'
import { asyncHandler, getParam, sendSuccess } from '../../middleware/validate.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'
import { enqueue, retryDead } from '../../lib/work-queue.js'

function requireStaff(req: PayloadRequest, adminOnly = false): void {
  const role = req.user?.role
  if (role === 'admin' || (!adminOnly && role === 'instructor')) return
  throw new AppError('INSUFFICIENT_PERMISSION', 'Studio staff only')
}

/** POST /api/studio/programmes/:id/captions-import: queues a caption re-import (the worker runs it). */
export const queueCaptionsImportEndpoint: Endpoint = {
  path: '/studio/programmes/:id/captions-import',
  method: 'post',
  handler: asyncHandler(async (req) => {
    requireStaff(req)
    const id = getParam(req, 'id')
    if (!isValidPayloadId(id)) throw new AppError('VALIDATION_ERROR', 'Invalid programme')
    const course = await req.payload.findByID({ collection: 'courses', id, depth: 0, overrideAccess: true }) as unknown as { slug: string; driveFolderId?: string | null }
    if (!course.driveFolderId) throw new AppError('VALIDATION_ERROR', 'Import this programme from Google Drive first (import:drive-curriculum).')
    const taskId = await enqueue('captions-import', { slug: course.slug, force: true })
    return sendSuccess({ queued: true, taskId })
  }),
}

/** POST /api/studio/programmes/:id/history/:index/restore: puts an earlier version of the programme copy back. */
export const restoreContentHistoryEndpoint: Endpoint = {
  path: '/studio/programmes/:id/history/:index/restore',
  method: 'post',
  handler: asyncHandler(async (req) => {
    requireStaff(req, true)
    const id = getParam(req, 'id')
    const index = Number(getParam(req, 'index'))
    if (!isValidPayloadId(id) || !Number.isInteger(index) || index < 0) throw new AppError('VALIDATION_ERROR', 'Invalid history entry')
    const course = await req.payload.findByID({ collection: 'courses', id, depth: 0, overrideAccess: true }) as unknown as Record<string, unknown> & { contentHistory?: Array<{ savedAt: string; source?: string; snapshot: Record<string, unknown> }> | null; meta?: Record<string, unknown> | null }
    const history = course.contentHistory ?? []
    const entry = history[index]
    if (!entry?.snapshot) throw new AppError('NOT_FOUND', 'History entry not found')
    const strip = (rows: unknown) => (Array.isArray(rows) ? rows.map((row) => { const { id: _id, ...rest } = row as Record<string, unknown>; return rest }) : [])
    const current = {
      meta: { title: course.meta?.title ?? null, description: course.meta?.description ?? null },
      shortDescription: course.shortDescription ?? null, description: course.description ?? null,
      objectives: strip(course.objectives), requirements: strip(course.requirements), whoItsFor: strip(course.whoItsFor),
      toolsCovered: strip(course.toolsCovered), careerPaths: strip(course.careerPaths), faq: strip(course.faq),
      primaryKeyword: course.primaryKeyword ?? null, secondaryKeywords: strip(course.secondaryKeywords),
    }
    const snapshot = entry.snapshot as Record<string, unknown> & { meta?: Record<string, unknown> }
    const nextHistory = [...strip(history), { savedAt: new Date().toISOString(), source: `before restoring ${entry.savedAt}`, snapshot: current }].slice(-20)
    await req.payload.update({
      collection: 'courses',
      id,
      data: { ...snapshot, meta: { ...(course.meta ?? {}), ...(snapshot.meta ?? {}) }, contentHistory: nextHistory } as never,
      overrideAccess: true,
      context: { skipContentLint: true },
    })
    return sendSuccess({ restored: entry.savedAt })
  }),
}

/** POST /api/studio/work-queue/:taskId/retry: retries a task from the dead-letter list. */
export const retryWorkTaskEndpoint: Endpoint = {
  path: '/studio/work-queue/:taskId/retry',
  method: 'post',
  handler: asyncHandler(async (req) => {
    requireStaff(req, true)
    const taskId = getParam(req, 'taskId')
    if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new AppError('VALIDATION_ERROR', 'Invalid task')
    return sendSuccess({ retried: await retryDead(taskId) })
  }),
}
