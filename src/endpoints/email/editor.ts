import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { requireAdmin } from '../../middleware/authorize.js'
import { AppError } from '../../types/index.js'
import { createPayloadRateLimiterFor } from '../../lib/rate-limiter.js'
import { sendEmail } from '../../lib/resend.js'
import { logger } from '../../lib/logger.js'
import { entryById, renderPreview, type EditableEntry } from '../../emails/catalog.js'
import { validateOverride } from '../../emails/validate-override.js'
import { ensureOverrideStore, getOverride } from '../../emails/override-store.js'
import { discardDraft, findRow, normalise, publish, resetToOriginal, restoreToDraft, saveDraft } from '../../emails/override-service.js'
import { editorDetail, listEditorItems, previewTemplateFor } from '../../emails/editor-data.js'

/**
 * Studio email editor API (brief section 6), admins only and rate-limited. Studio calls these with
 * its session cookie; a bearer token works too. Writes go through override-service.ts.
 */
/** Replaceable in tests (no Redis, no Resend). */
export const editorDeps = {
  editorLimiter: createPayloadRateLimiterFor('email-editor', 600, 15 * 60),
  /** 10 test sends per admin per hour. */
  testLimiter: createPayloadRateLimiterFor('email-editor-test', 10, 60 * 60),
  sendEmail,
}

interface Editor {
  id: number
  email: string
}

async function requireEditor(req: PayloadRequest): Promise<Editor> {
  const sessionUser = req.user as { id?: number | string; email?: string; role?: string } | null | undefined
  const user = sessionUser?.role === 'admin' ? { id: Number(sessionUser.id), email: String(sessionUser.email ?? '') } : await requireAdmin(req)
  await editorDeps.editorLimiter.check(req, user.id)
  await ensureOverrideStore(req.payload)
  return { id: user.id, email: user.email }
}

const text = z.string().max(5000)
const overrideSchema = z
  .object({
    subject: text.optional(),
    preheader: text.optional(),
    variants: z.array(z.object({ subject: text.optional(), preheader: text.optional() }).strict()).max(5).optional(),
    slots: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).max(64), text).optional(),
  })
  .strict()
  .nullable()

function entryOr404(id: string): EditableEntry {
  const entry = entryById(id)
  if (!entry) throw new AppError('NOT_FOUND', 'No email with that name')
  return entry
}

/** GET /api/email/editor/templates */
export const listEmailTemplatesEndpoint: Endpoint = {
  path: '/email/editor/templates',
  method: 'get',
  handler: asyncHandler(async (req) => {
    await requireEditor(req)
    return sendSuccess(await listEditorItems(req.payload))
  }),
}

/** GET /api/email/editor/templates/:id */
export const getEmailTemplateEndpoint: Endpoint = {
  path: '/email/editor/templates/:id',
  method: 'get',
  handler: asyncHandler(async (req) => {
    await requireEditor(req)
    const entry = entryOr404(getParam(req, 'id'))
    return sendSuccess(await editorDetail(req.payload, entry))
  }),
}

const previewSchema = z.object({
  override: overrideSchema.optional(),
  dataVariant: z.string().max(40).optional(),
  abVariant: z.number().int().min(0).max(5).optional(),
  previewTemplate: z.string().max(60).optional(),
  format: z.enum(['html', 'text', 'json']).default('json'),
})

/** POST /api/email/editor/preview/:id: renders the posted override (not saved) and validates it. */
export const previewEmailOverrideEndpoint: Endpoint = {
  path: '/email/editor/preview/:id',
  method: 'post',
  handler: asyncHandler(async (req) => {
    await requireEditor(req)
    const entry = entryOr404(getParam(req, 'id'))
    const body = parseBody(previewSchema, await readJsonBody(req))
    const override = body.override === undefined ? getOverride(entry.id) : normalise(body.override)
    const templateId = previewTemplateFor(entry.id, body.previewTemplate)
    const rendered = renderPreview(templateId, { [entry.id]: override }, body.dataVariant, body.abVariant ?? 0)
    if (!rendered) throw new AppError('NOT_FOUND', 'No email with that name')
    const validation = validateOverride(entry.id, override)
    const out = {
      templateId,
      subject: rendered.subject,
      preheader: rendered.preheader,
      ...(body.format !== 'text' ? { html: rendered.html } : {}),
      ...(body.format !== 'html' ? { text: rendered.text } : {}),
      validation,
    }
    return sendSuccess(out)
  }),
}

/** Addresses an admin may send tests to, besides their own: EMAIL_TEST_RECIPIENTS (comma-separated). */
export function testRecipients(): string[] {
  return (process.env.EMAIL_TEST_RECIPIENTS ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
}

const testSchema = z.object({
  override: overrideSchema.optional(),
  to: z.string().email().max(200).optional(),
  dataVariant: z.string().max(40).optional(),
  abVariant: z.number().int().min(0).max(5).optional(),
  previewTemplate: z.string().max(60).optional(),
})

/** POST /api/email/editor/test/:id: sends a [TEST] copy to the signed-in admin (or an allowlisted address). */
export const sendTestEmailEndpoint: Endpoint = {
  path: '/email/editor/test/:id',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const editor = await requireEditor(req)
    const entry = entryOr404(getParam(req, 'id'))
    const body = parseBody(testSchema, await readJsonBody(req))
    const to = (body.to ?? editor.email).trim().toLowerCase()
    if (!to) throw new AppError('VALIDATION_ERROR', 'Your account has no email address to send the test to.')
    if (to !== editor.email.trim().toLowerCase() && !testRecipients().includes(to)) {
      throw new AppError('INSUFFICIENT_PERMISSION', 'Tests go to your own address, or one listed in EMAIL_TEST_RECIPIENTS.')
    }
    await editorDeps.testLimiter.check(req, editor.id)
    const row = await findRow(req.payload, entry.id)
    const override = body.override !== undefined ? normalise(body.override) : (row?.draft ?? row?.published ?? null)
    const templateId = previewTemplateFor(entry.id, body.previewTemplate)
    const rendered = renderPreview(templateId, { [entry.id]: override }, body.dataVariant, body.abVariant ?? 0)
    if (!rendered) throw new AppError('NOT_FOUND', 'No email with that name')
    const providerId = await editorDeps.sendEmail(to, { subject: `[TEST] ${rendered.subject}`, html: rendered.html, text: rendered.text }, { stream: 'transactional', tags: { test: 'true', template: templateId } })
    logger.info({ templateId, editor: editor.id }, 'email_editor_test_sent')
    return sendSuccess({ sent: true, to, providerId })
  }),
}

const draftSchema = z.object({ override: overrideSchema })

/** PUT /api/email/editor/templates/:id/draft */
export const saveEmailDraftEndpoint: Endpoint = {
  path: '/email/editor/templates/:id/draft',
  method: 'put',
  handler: asyncHandler(async (req) => {
    const editor = await requireEditor(req)
    const entry = entryOr404(getParam(req, 'id'))
    const body = parseBody(draftSchema, await readJsonBody(req))
    const { row, validation } = await saveDraft(req.payload, entry.id, body.override, editor)
    return sendSuccess({ draft: row.draft ?? null, draftUpdatedAt: row.draftUpdatedAt ?? null, validation })
  }),
}

/** DELETE /api/email/editor/templates/:id/draft */
export const discardEmailDraftEndpoint: Endpoint = {
  path: '/email/editor/templates/:id/draft',
  method: 'delete',
  handler: asyncHandler(async (req) => {
    const editor = await requireEditor(req)
    const entry = entryOr404(getParam(req, 'id'))
    await discardDraft(req.payload, entry.id, editor)
    return sendSuccess({ discarded: true })
  }),
}

/** POST /api/email/editor/templates/:id/publish */
export const publishEmailEndpoint: Endpoint = {
  path: '/email/editor/templates/:id/publish',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const editor = await requireEditor(req)
    const entry = entryOr404(getParam(req, 'id'))
    const { row, validation } = await publish(req.payload, entry.id, editor)
    return sendSuccess({ published: row.published ?? null, publishedAt: row.publishedAt ?? null, validation })
  }),
}

/** POST /api/email/editor/templates/:id/reset */
export const resetEmailEndpoint: Endpoint = {
  path: '/email/editor/templates/:id/reset',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const editor = await requireEditor(req)
    const entry = entryOr404(getParam(req, 'id'))
    const row = await resetToOriginal(req.payload, entry.id, editor)
    return sendSuccess({ published: null, publishedAt: row.publishedAt ?? null })
  }),
}

/** POST /api/email/editor/restore/:id/:historyId: copies an earlier version into the draft (never publishes). */
export const restoreEmailEndpoint: Endpoint = {
  path: '/email/editor/restore/:id/:historyId',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const editor = await requireEditor(req)
    const entry = entryOr404(getParam(req, 'id'))
    const historyId = Number(getParam(req, 'historyId'))
    if (!Number.isInteger(historyId) || historyId <= 0) throw new AppError('VALIDATION_ERROR', 'Invalid history entry')
    const { row, validation } = await restoreToDraft(req.payload, entry.id, historyId, editor)
    return sendSuccess({ draft: row.draft ?? null, validation })
  }),
}

export const emailEditorEndpoints: Endpoint[] = [
  listEmailTemplatesEndpoint,
  getEmailTemplateEndpoint,
  previewEmailOverrideEndpoint,
  sendTestEmailEndpoint,
  saveEmailDraftEndpoint,
  discardEmailDraftEndpoint,
  publishEmailEndpoint,
  resetEmailEndpoint,
  restoreEmailEndpoint,
]
