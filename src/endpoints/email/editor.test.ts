import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Payload, PayloadRequest } from 'payload'

/**
 * Brief section 9, without a database: the whole Studio flow through the endpoint handlers against
 * an in-memory Payload. Edit A1's opening line, save a draft (preview changes, the published email
 * doesn't), send a test, publish, check GET /api/email/preview/A1, restore the earlier version as
 * a draft and publish it, then reset to the original and check the baseline still matches.
 */
process.env.FRONTEND_URL = 'https://skillsair.com'
process.env.EMAIL_TEST_RECIPIENTS = 'team@skillsair.com'
const editor = await import('./editor.js')
const { emailPreviewEndpoint } = await import('./preview.js')
const { serviceDeps } = await import('../../emails/override-service.js')
const { ensureOverrideStore, stopOverrideStore, resetStore } = await import('../../emails/override-store.js')
const { renderBaseline } = await import('../../emails/baseline-cases.js')

type Doc = Record<string, unknown> & { id: number }

function memoryPayload() {
  const tables: Record<string, Doc[]> = { 'email-overrides': [], 'email-override-history': [] }
  let global: Record<string, unknown> = { founderAnecdote: null, proofItems: [], emailSettings: {} }
  let nextId = 1
  let clock = Date.parse('2026-10-25T10:00:00Z')
  const matches = (doc: Doc, where?: Record<string, { equals?: unknown }>) => !where || Object.entries(where).every(([field, rule]) => doc[field] === rule.equals)
  const payload = {
    find: async ({ collection, where, sort, limit }: { collection: string; where?: Record<string, { equals?: unknown }>; sort?: string; limit?: number }) => {
      let docs = (tables[collection] ?? []).filter((doc) => matches(doc, where))
      if (sort === '-createdAt') docs = [...docs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id - a.id)
      if (limit) docs = docs.slice(0, limit)
      return { docs: docs.map((doc) => structuredClone(doc)), totalDocs: docs.length }
    },
    findByID: async ({ collection, id }: { collection: string; id: number }) => {
      const doc = tables[collection]?.find((item) => item.id === Number(id))
      if (!doc) throw new Error('Not Found')
      return structuredClone(doc)
    },
    create: async ({ collection, data }: { collection: string; data: Record<string, unknown> }) => {
      const now = new Date((clock += 1000)).toISOString()
      const doc = { ...structuredClone(data), id: nextId++, createdAt: now, updatedAt: now } as Doc
      tables[collection]!.push(doc)
      return structuredClone(doc)
    },
    update: async ({ collection, id, data }: { collection: string; id: number; data: Record<string, unknown> }) => {
      const doc = tables[collection]!.find((item) => item.id === Number(id))!
      Object.assign(doc, structuredClone(data), { updatedAt: new Date((clock += 1000)).toISOString() })
      return structuredClone(doc)
    },
    findGlobal: async () => structuredClone(global),
    updateGlobal: async ({ data }: { data: Record<string, unknown> }) => {
      global = { ...global, ...structuredClone(data) }
      return structuredClone(global)
    },
  }
  return { payload: payload as unknown as Payload, tables, global: () => global }
}

const { payload, tables, global } = memoryPayload()
const admin = { id: 7, email: 'imisi@skillsair.com', role: 'admin' }
const sent: Array<{ to: string; subject: string; tags?: Record<string, string> }> = []
editor.editorDeps.editorLimiter = { check: async () => undefined }
let testSends = 0
editor.editorDeps.testLimiter = {
  check: async () => {
    if (++testSends > 10) throw new Error('rate limited')
  },
}
editor.editorDeps.sendEmail = async (to, content, options) => {
  sent.push({ to, subject: content.subject, tags: options?.tags })
  return 'test-id'
}
serviceDeps.bumpVersion = async () => undefined
resetStore()
await ensureOverrideStore(payload, { redis: { get: async () => '1' }, pollMs: 0 })

async function call(endpoint: { handler: (req: PayloadRequest) => Promise<Response> | Response }, params: Record<string, string> = {}, body?: unknown, user: unknown = admin) {
  const req = {
    payload,
    user,
    routeParams: params,
    url: `http://localhost/api/x${params.format ? `?format=${params.format}` : ''}`,
    headers: new Headers(),
    json: async () => body ?? {},
  } as unknown as PayloadRequest
  const response = await endpoint.handler(req)
  const type = response.headers.get('content-type') ?? ''
  return { status: response.status, body: type.includes('json') ? ((await response.json()) as { success: boolean; data: any; error?: { code: string; message: string; fields?: Record<string, string> } }) : null, text: type.includes('json') ? '' : await response.text() }
}

const NEW_INTRO = 'Imisi here. I answer your WhatsApp messages, so you’ll hear from me this week.'
const SECOND_INTRO = 'Imisi again. Short and useful, I promise.'
const ORIGINAL_INTRO = "Imisi here again. I'm the person who answers"

test('non-admins are refused', async () => {
  const result = await call(editor.listEmailTemplatesEndpoint, {}, undefined, { id: 2, role: 'student', email: 's@x.com' })
  assert.equal(result.status, 401)
})

test('the list shows every template, Shared phrases and Email settings, all at their defaults', async () => {
  const result = await call(editor.listEmailTemplatesEndpoint)
  assert.equal(result.status, 200)
  const items = result.body!.data as Array<{ id: string; status: string; whenSent: string; subject: string | null; group: string }>
  assert.ok(items.length >= 60)
  assert.ok(items.every((item) => item.status === 'default'))
  const a1 = items.find((item) => item.id === 'A1')!
  assert.equal(a1.subject, 'Two questions everyone asks me')
  assert.match(a1.whenSent, /1 hour after they apply/)
  assert.ok(items.some((item) => item.id === '_shared' && item.group === 'shared'))
  assert.ok(items.some((item) => item.id === '_settings' && item.group === 'settings'))
})

test('the editor flow: draft, preview, test, publish, restore, reset', async () => {
  // Template detail: slots in reading order, placeholders and no history yet.
  const detail = await call(editor.getEmailTemplateEndpoint, { id: 'A1' })
  assert.equal(detail.body!.data.slots[0].key, 'subject')
  assert.ok(detail.body!.data.slots.some((slot: { key: string }) => slot.key === 'intro'))
  assert.ok(detail.body!.data.placeholders.some((item: { name: string }) => item.name === 'monthly'))
  assert.equal(detail.body!.data.variantCount, 2)

  // Save a draft: the live preview changes, the published email doesn't.
  const draft = await call(editor.saveEmailDraftEndpoint, { id: 'A1' }, { override: { slots: { intro: NEW_INTRO } } })
  assert.equal(draft.status, 200)
  assert.deepEqual(draft.body!.data.validation.errors, [])
  const preview = await call(editor.previewEmailOverrideEndpoint, { id: 'A1' }, { override: { slots: { intro: NEW_INTRO } }, format: 'json' })
  assert.ok(preview.body!.data.text.includes(NEW_INTRO))
  const live = await call(emailPreviewEndpoint, { template: 'A1', format: 'text' })
  assert.ok(live.text.includes(ORIGINAL_INTRO), 'a draft never reaches learners')
  const list = await call(editor.listEmailTemplatesEndpoint)
  assert.equal(list.body!.data.find((item: { id: string }) => item.id === 'A1').status, 'draft pending')

  // Send a test: to the admin, [TEST] subject, tagged; other addresses only from the allowlist.
  const testSend = await call(editor.sendTestEmailEndpoint, { id: 'A1' }, {})
  assert.equal(testSend.status, 200)
  assert.equal(sent.at(-1)!.to, 'imisi@skillsair.com')
  assert.match(sent.at(-1)!.subject, /^\[TEST\] /)
  assert.equal(sent.at(-1)!.tags?.test, 'true')
  assert.equal((await call(editor.sendTestEmailEndpoint, { id: 'A1' }, { to: 'team@skillsair.com' })).status, 200)
  assert.equal((await call(editor.sendTestEmailEndpoint, { id: 'A1' }, { to: 'someone@else.com' })).status, 403)

  // Publish: the preview endpoint now shows the new wording.
  const published = await call(editor.publishEmailEndpoint, { id: 'A1' })
  assert.equal(published.status, 200)
  assert.ok((await call(emailPreviewEndpoint, { template: 'A1', format: 'text' })).text.includes(NEW_INTRO))

  // A second edit, published.
  await call(editor.saveEmailDraftEndpoint, { id: 'A1' }, { override: { slots: { intro: SECOND_INTRO } } })
  await call(editor.publishEmailEndpoint, { id: 'A1' })
  assert.ok((await call(emailPreviewEndpoint, { template: 'A1', format: 'text' })).text.includes(SECOND_INTRO))

  // Restore the first version as a draft (never published automatically), then publish it.
  const history = (await call(editor.getEmailTemplateEndpoint, { id: 'A1' })).body!.data.history as Array<{ id: number; action: string; snapshot: { slots?: Record<string, string> } | null }>
  assert.deepEqual(history.map((row) => row.action), ['publish', 'publish'])
  const first = history.find((row) => row.snapshot?.slots?.intro === NEW_INTRO)!
  const restored = await call(editor.restoreEmailEndpoint, { id: 'A1', historyId: String(first.id) })
  assert.equal(restored.status, 200)
  assert.ok((await call(emailPreviewEndpoint, { template: 'A1', format: 'text' })).text.includes(SECOND_INTRO), 'restore only fills the draft')
  await call(editor.publishEmailEndpoint, { id: 'A1' })
  assert.ok((await call(emailPreviewEndpoint, { template: 'A1', format: 'text' })).text.includes(NEW_INTRO))

  // Reset to the original: every email is byte-for-byte the baseline again.
  const reset = await call(editor.resetEmailEndpoint, { id: 'A1' })
  assert.equal(reset.status, 200)
  assert.ok((await call(emailPreviewEndpoint, { template: 'A1', format: 'text' })).text.includes(ORIGINAL_INTRO))
  const baseline = JSON.parse(readFileSync('src/emails/__baseline__/baseline.json', 'utf8'))
  assert.deepEqual(renderBaseline(), baseline)
  const actions = (await call(editor.getEmailTemplateEndpoint, { id: 'A1' })).body!.data.history.map((row: { action: string }) => row.action)
  assert.deepEqual(actions, ['reset', 'publish', 'restore_to_draft', 'publish', 'publish'])
})

test('publishing is refused while the draft has errors', async () => {
  await call(editor.saveEmailDraftEndpoint, { id: 'A2' }, { override: { slots: { intro: 'Hurry, limited seats.' } } })
  const result = await call(editor.publishEmailEndpoint, { id: 'A2' })
  assert.equal(result.status, 400)
  assert.match(result.body!.error!.fields!.intro!, /limited seats/)
  assert.equal(tables['email-overrides']!.find((row) => row.templateId === 'A2')!.published ?? null, null)
  const discarded = await call(editor.discardEmailDraftEndpoint, { id: 'A2' })
  assert.equal(discarded.status, 200)
  assert.equal(tables['email-overrides']!.find((row) => row.templateId === 'A2')!.draft, null)
})

test('email settings publish to the Email content global and change every email’s sign-off', async () => {
  await call(editor.saveEmailDraftEndpoint, { id: '_settings' }, { override: { slots: { signOffName: 'Imisi at SkillsAir' } } })
  assert.equal((await call(editor.publishEmailEndpoint, { id: '_settings' })).status, 200)
  assert.equal((global().emailSettings as Record<string, unknown>).signOffName, 'Imisi at SkillsAir')
  assert.ok((await call(emailPreviewEndpoint, { template: 'T1', format: 'text' })).text.includes('Imisi at SkillsAir'))
  await call(editor.resetEmailEndpoint, { id: '_settings' })
  assert.equal((global().emailSettings as Record<string, unknown>).signOffName, null)
  assert.deepEqual(renderBaseline(), JSON.parse(readFileSync('src/emails/__baseline__/baseline.json', 'utf8')))
})

test('the preview endpoint validates without saving', async () => {
  const before = tables['email-overrides']!.length
  const result = await call(editor.previewEmailOverrideEndpoint, { id: 'A1' }, { override: { subject: '<b>Hi</b>' }, format: 'html' })
  assert.equal(result.status, 200)
  assert.ok(result.body!.data.validation.errors.some((issue: { field: string }) => issue.field === 'subject'))
  assert.equal(result.body!.data.text, undefined)
  assert.equal(tables['email-overrides']!.length, before)
  stopOverrideStore()
  resetStore()
})
