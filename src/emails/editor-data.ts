import type { Payload } from 'payload'
import { maxLengthOf, overrideFields, type EmailOverride } from './copy.js'
import { editableEntries, entryById, GROUP_LABEL, renderPreview, type EditableEntry } from './catalog.js'
import { SETTINGS_ID, SHARED_ID } from './override-store.js'
import { SCENARIOS } from './scenarios.js'
import { LIFECYCLE_TEMPLATES } from './lifecycle/index.js'
import { findRow, type OverrideRow } from './override-service.js'

/**
 * What the Studio email editor shows: the list of editable emails with their status, and one
 * email's slots, placeholders, draft, published wording and history. Used by the editor API and
 * the server-rendered Studio view (src/admin/views/emails).
 */
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

export function previewTemplateFor(entryId: string, requested?: string): string {
  if (entryId !== SHARED_ID && entryId !== SETTINGS_ID) return entryId
  if (requested && entryById(requested) && requested !== SHARED_ID && requested !== SETTINGS_ID) return requested
  return PREVIEW_DEFAULT[entryId]!
}

/** Fields in reading order: subject lines, preview texts, body, then button and P.S. */
export function orderedSlots(entry: EditableEntry) {
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

export type EditorListItem = Awaited<ReturnType<typeof listEditorItems>>[number]
export type EditorDetail = Awaited<ReturnType<typeof editorDetail>>

export async function listEditorItems(payload: Payload) {
    const rows = (await payload.find({ collection: 'email-overrides', pagination: false, limit: 0, depth: 1, overrideAccess: true })).docs as unknown as OverrideRow[]
    const byId = new Map(rows.map((row) => [row.templateId, row]))
    return editableEntries().map((entry) => {
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
}

export async function editorDetail(payload: Payload, entry: EditableEntry) {
    const row = await findRow(payload, entry.id)
    const history = await payload.find({ collection: 'email-override-history', where: { templateId: { equals: entry.id } }, sort: '-createdAt', limit: 100, depth: 1, overrideAccess: true })
    return {
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
    }
}
