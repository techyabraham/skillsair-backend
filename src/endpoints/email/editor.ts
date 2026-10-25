import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { requireAdmin } from '../../middleware/authorize.js'
import { AppError } from '../../types/index.js'
import { createPayloadRateLimiterFor } from '../../lib/rate-limiter.js'
import { sendEmail } from '../../lib/resend.js'
import { logger } from '../../lib/logger.js'
import { maxLengthOf, overrideFields, type EmailOverride } from '../../emails/copy.js'
import { editableEntries, entryById, GROUP_LABEL, renderPreview, type EditableEntry } from '../../emails/catalog.js'
import { validateOverride } from '../../emails/validate-override.js'
import { ensureOverrideStore, getOverride, SETTINGS_ID, SHARED_ID } from '../../emails/override-store.js'
import { SCENARIOS } from '../../emails/scenarios.js'
import { LIFECYCLE_TEMPLATES } from '../../emails/lifecycle/index.js'
import { discardDraft, findRow, normalise, publish, resetToOriginal, restoreToDraft, saveDraft, type OverrideRow } from '../../emails/override-service.js'

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

interface UserDoc {
  id: number
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}

const personName = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null
  const user = value as UserDoc
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || `User ${user.id}`
}

function statusOf(row: OverrideRow | undefined): 'default' | 'edited' | 'draft pending' {
  if (row?.draft) return 'draft pending'
  if (row?.published) return 'edited'
  return 'default'
}

/** The template a `_shared` or `_settings` preview shows by default. */
const PREVIEW_DEFAULT: Record<string, string> = { [SHARED_ID]: 'T1', [SETTINGS_ID]: 'A1' }

function previewTemplateFor(entryId: string, requested?: string): string {
  if (entryId !== SHARED_ID && entryId !== SETTINGS_ID) return entryId
  if (requested && entryById(requested) && requested !== SHARED_ID && requested !== SETTINGS_ID) return requested
  return PREVIEW_DEFAULT[entryId]!
}

/** Fields in reading order: subject lines, preview texts, body, then button and P.S. */
function orderedSlots(entry: EditableEntry) {
  const rank = (kind: string) => ({ subject: 0, preheader: 1, text: 2, list: 2, button: 3, ps: 4 })[kind] ?? 2
  return Object.entries(entry.copy)
    .map(([key, slot], index) => ({ key, index, slot }))
    .sort((a, b) => rank(a.slot.kind ?? 'text') - rank(b.slot.kind ?? 'text') || a.index - b.index)
    .map(({ key, slot }) => ({
      key,
      label: slot.label,
      kind: slot.kind ?? 'text',
      default: slot.default,
      required: slot.required ?? [],
      maxLength: maxLengthOf(slot) ?? null,
      help: slot.help ?? null,
      vars: slot.vars ?? {},
    }))
}

/** GET /api/email/editor/templates */
export const listEmailTemplatesEndpoint: Endpoint = {
  path: '/email/editor/templates',
  method: 'get',
  handler: asyncHandler(async (req) => {
    await requireEditor(req)
    const rows = (await req.payload.find({ collection: 'email-overrides', pagination: false, limit: 0, depth: 1, overrideAccess: true })).docs as unknown as OverrideRow[]
    const byId = new Map(rows.map((row) => [row.templateId, row]))
    const items = editableEntries().map((entry) => {
      const row = byId.get(entry.id)
      const rendered = entry.id === SHARED_ID || entry.id === SETTINGS_ID ? null : renderPreview(entry.id, {})
      const draftNewer = row?.draftUpdatedAt && (!row.publishedAt || row.draftUpdatedAt > row.publishedAt)
      const published = overrideFields(row?.published ?? null)
      return {
        id: entry.id,
        name: entry.name,
        group: entry.group,
        groupLabel: GROUP_LABEL[entry.group],
        track: entry.track,
        kind: entry.kind,
        stepId: entry.stepId,
        whenSent: entry.whenSent,
        subject: rendered?.subject ?? null,
        status: statusOf(row),
        updatedAt: (draftNewer ? row?.draftUpdatedAt : row?.publishedAt) ?? null,
        updatedBy: personName(draftNewer ? row?.draftUpdatedBy : row?.publishedBy),
        searchText: [entry.id, entry.name, rendered?.subject ?? '', ...Object.values(entry.copy).map((slot) => slot.default), ...Object.values(published)].join(' \n ').toLowerCase(),
      }
    })
    return sendSuccess(items)
  }),
}

/** GET /api/email/editor/templates/:id */
export const getEmailTemplateEndpoint: Endpoint = {
  path: '/email/editor/templates/:id',
  method: 'get',
  handler: asyncHandler(async (req) => {
    await requireEditor(req)
    const entry = entryOr404(getParam(req, 'id'))
    const row = await findRow(req.payload, entry.id)
    const history = await req.payload.find({ collection: 'email-override-history', where: { templateId: { equals: entry.id } }, sort: '-createdAt', limit: 100, depth: 1, overrideAccess: true })
    return sendSuccess({
      id: entry.id,
      name: entry.name,
      group: entry.group,
      kind: entry.kind,
      whenSent: entry.whenSent,
      slots: orderedSlots(entry),
      placeholders: Object.entries(entry.varDocs).map(([name, description]) => ({ name, description })),
      variantCount: entry.variantCount,
      published: row?.published ?? null,
      draft: row?.draft ?? null,
      publishedAt: row?.publishedAt ?? null,
      publishedBy: personName(row?.publishedBy),
      draftUpdatedAt: row?.draftUpdatedAt ?? null,
      draftUpdatedBy: personName(row?.draftUpdatedBy),
      scenarios: LIFECYCLE_TEMPLATES[previewTemplateFor(entry.id)] ? SCENARIOS.map(({ id, label }) => ({ id, label })) : [],
      previewTemplates: entry.id === SHARED_ID || entry.id === SETTINGS_ID ? editableEntries().filter((item) => item.id !== SHARED_ID && item.id !== SETTINGS_ID && (entry.id === SETTINGS_ID || LIFECYCLE_TEMPLATES[item.id])).map(({ id, name }) => ({ id, name })) : [],
      previewTemplate: previewTemplateFor(entry.id),
      history: (history.docs as unknown as Array<{ id: number; createdAt: string; author?: unknown; action: string; snapshot: EmailOverride | null }>).map((doc) => ({
        id: doc.id,
        createdAt: doc.createdAt,
        author: personName(doc.author),
        action: doc.action,
        snapshot: doc.snapshot ?? null,
      })),
    })
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
