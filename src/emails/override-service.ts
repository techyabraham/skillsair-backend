import type { Payload } from 'payload'
import { AppError } from '../types/index.js'
import { fromFields, overrideFields, type EmailOverride } from './copy.js'
import { entryById } from './catalog.js'
import { validateOverride, type ValidationResult } from './validate-override.js'
import { currentOverrideStore, SETTINGS_ID, settingsFromOverride } from './override-store.js'
import { bumpOverrideVersion } from './override-version.js'

/**
 * Every write to the email wording goes through here (brief section 4.1): drafts, publishing,
 * reset and restore. Publishing validates (errors refuse it), writes a history row, bumps
 * `email-overrides:version` in Redis so every process reloads, and refreshes this process's store.
 */
export interface EditorUser {
  id: number | string
}

export interface OverrideRow {
  id: number | string
  templateId: string
  published: EmailOverride | null
  draft: EmailOverride | null
  publishedAt?: string | null
  publishedBy?: unknown
  draftUpdatedAt?: string | null
  draftUpdatedBy?: unknown
}

const CONTEXT = { emailOverrideService: true }

/** Drops empty fields; null when nothing is left (= the original wording). */
export function normalise(override: EmailOverride | null | undefined): EmailOverride | null {
  return override ? fromFields(overrideFields(override)) : null
}

function requireEntry(templateId: string): void {
  if (!entryById(templateId)) throw new AppError('NOT_FOUND', 'No email with that name')
}

export async function findRow(payload: Payload, templateId: string): Promise<OverrideRow | null> {
  const result = await payload.find({ collection: 'email-overrides', where: { templateId: { equals: templateId } }, limit: 1, depth: 0, overrideAccess: true })
  return (result.docs[0] as unknown as OverrideRow | undefined) ?? null
}

async function upsert(payload: Payload, templateId: string, data: Record<string, unknown>): Promise<OverrideRow> {
  const row = await findRow(payload, templateId)
  const doc = row
    ? await payload.update({ collection: 'email-overrides', id: row.id, data: data as never, depth: 0, overrideAccess: true, context: CONTEXT })
    : await payload.create({ collection: 'email-overrides', data: { templateId, ...data } as never, depth: 0, overrideAccess: true, context: CONTEXT })
  return doc as unknown as OverrideRow
}

async function history(payload: Payload, templateId: string, action: 'publish' | 'reset' | 'restore_to_draft', snapshot: EmailOverride | null, user: EditorUser): Promise<void> {
  await payload.create({ collection: 'email-override-history', data: { templateId, action, snapshot, author: user.id } as never, depth: 0, overrideAccess: true })
}

/** `_settings` lives on the Email content global: publishing it writes the global's Email settings group. */
async function writeSettings(payload: Payload, override: EmailOverride | null): Promise<void> {
  const values = settingsFromOverride(override, true)
  await payload.updateGlobal({ slug: 'email-content', data: { emailSettings: values } as never, depth: 0, overrideAccess: true })
}

async function afterPublish(): Promise<void> {
  await bumpOverrideVersion()
  await currentOverrideStore()?.reload()
}

export async function saveDraft(payload: Payload, templateId: string, override: EmailOverride | null, user: EditorUser): Promise<{ row: OverrideRow; validation: ValidationResult }> {
  requireEntry(templateId)
  const draft = normalise(override)
  // A draft is saved even with errors; publishing is what they block.
  const validation = validateOverride(templateId, draft)
  const row = await upsert(payload, templateId, { draft, draftUpdatedAt: new Date().toISOString(), draftUpdatedBy: user.id })
  return { row, validation }
}

export async function publish(payload: Payload, templateId: string, user: EditorUser): Promise<{ row: OverrideRow; validation: ValidationResult }> {
  requireEntry(templateId)
  const row = await findRow(payload, templateId)
  if (!row || row.draft === null || row.draft === undefined) throw new AppError('VALIDATION_ERROR', 'There’s no draft to publish. Save a draft first.')
  const next = normalise(row.draft)
  const validation = validateOverride(templateId, next)
  if (validation.errors.length) throw new AppError('VALIDATION_ERROR', 'Fix the errors before publishing.', Object.fromEntries(validation.errors.map((issue) => [issue.field, issue.message])))
  if (templateId === SETTINGS_ID) await writeSettings(payload, next)
  const updated = await upsert(payload, templateId, { published: next, draft: null, publishedAt: new Date().toISOString(), publishedBy: user.id })
  await history(payload, templateId, 'publish', next, user)
  await afterPublish()
  return { row: updated, validation }
}

export async function discardDraft(payload: Payload, templateId: string, user: EditorUser): Promise<OverrideRow | null> {
  requireEntry(templateId)
  const row = await findRow(payload, templateId)
  if (!row) return null
  return upsert(payload, templateId, { draft: null, draftUpdatedAt: new Date().toISOString(), draftUpdatedBy: user.id })
}

/** Publishes the original wording (null), with a history row. Clears any draft. */
export async function resetToOriginal(payload: Payload, templateId: string, user: EditorUser): Promise<OverrideRow> {
  requireEntry(templateId)
  if (templateId === SETTINGS_ID) await writeSettings(payload, null)
  const row = await upsert(payload, templateId, { published: null, draft: null, publishedAt: new Date().toISOString(), publishedBy: user.id })
  await history(payload, templateId, 'reset', null, user)
  await afterPublish()
  return row
}

/** Copies an earlier published version into the draft. Never publishes. */
export async function restoreToDraft(payload: Payload, templateId: string, historyId: number | string, user: EditorUser): Promise<{ row: OverrideRow; validation: ValidationResult }> {
  requireEntry(templateId)
  const entry = (await payload.findByID({ collection: 'email-override-history', id: historyId, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as {
    templateId: string
    snapshot: EmailOverride | null
  } | null
  if (!entry || entry.templateId !== templateId) throw new AppError('NOT_FOUND', 'History entry not found')
  const result = await saveDraft(payload, templateId, entry.snapshot ?? {}, user)
  // An empty snapshot (the original wording) still leaves a draft to publish: an empty override.
  const row = entry.snapshot ? result.row : await upsert(payload, templateId, { draft: {} })
  const current = await findRow(payload, templateId)
  await history(payload, templateId, 'restore_to_draft', current?.published ?? null, user)
  return { row, validation: result.validation }
}
