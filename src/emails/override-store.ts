import type { Payload } from 'payload'
import { logger } from '../lib/logger.js'
import { captureError } from '../lib/observability.js'
import type { EmailOverride } from './copy.js'

/**
 * The published email wording, held in memory so rendering stays synchronous (brief section 4.2).
 * Loaded at server start (and by the Studio process on first use); every 30 seconds the Redis key
 * `email-overrides:version` is read and a change triggers a reload. With Redis down it reloads
 * every 5 minutes anyway; with the database down it keeps the last good copy. Nothing here throws
 * into a render.
 *
 * Scripts and tests never start the store, so they render the code defaults.
 */
export const OVERRIDE_VERSION_KEY = 'email-overrides:version'
export const SHARED_ID = '_shared'
export const SETTINGS_ID = '_settings'

/** Shared settings from the Email content global (empty = the code constant). */
export interface EmailSettings {
  senderName?: string | null
  signOffName?: string | null
  signOffHelp?: string | null
  companyLine?: string | null
}

let overrides = new Map<string, EmailOverride>()
let settings: EmailSettings = {}
let loadedVersion: string | null = null
let preview: Record<string, EmailOverride | null> | null = null
const warned = new Set<string>()

/** The published override for a template id, `_shared` or `_settings`, or null (the defaults). Synchronous. */
export function getOverride(templateId: string): EmailOverride | null {
  if (preview && Object.prototype.hasOwnProperty.call(preview, templateId)) return preview[templateId] ?? null
  return overrides.get(templateId) ?? null
}

/** Shared settings (sender name, sign-off, company line). A previewed `_settings` override wins. Synchronous. */
export function getSettings(): EmailSettings {
  if (preview && Object.prototype.hasOwnProperty.call(preview, SETTINGS_ID)) return { ...settings, ...settingsFromOverride(preview[SETTINGS_ID] ?? null, true) }
  return settings
}

export function settingsFromOverride(override: EmailOverride | null, clearMissing = false): EmailSettings {
  const slots = override?.slots ?? {}
  const pick = (key: keyof EmailSettings) => (typeof slots[key] === 'string' && slots[key]!.trim() ? slots[key]! : clearMissing ? null : undefined)
  const result: EmailSettings = {}
  for (const key of ['senderName', 'signOffName', 'signOffHelp', 'companyLine'] as const) {
    const value = pick(key)
    if (value !== undefined) result[key] = value
  }
  return result
}

/**
 * Renders with these overrides in place of the published ones (Studio preview, test sends,
 * validation). Rendering is synchronous, so the substitution can't leak into another render.
 */
export function withOverrides<R>(substitute: Record<string, EmailOverride | null>, render: () => R): R {
  const previous = preview
  preview = { ...(previous ?? {}), ...substitute }
  try {
    return render()
  } finally {
    preview = previous
  }
}

/** Logs (and reports) a problem with a published override once per store version. */
export function warnOnce(key: string, details: Record<string, unknown>): void {
  const id = `${loadedVersion ?? 'none'}:${key}`
  if (warned.has(id)) return
  warned.add(id)
  logger.warn(details, 'email_override_ignored')
  captureError(new Error(`email_override_ignored: ${key}`), { source: 'email-override', key })
}

export function setStoreContents(rows: Array<{ templateId: string; published: EmailOverride | null }>, nextSettings: EmailSettings, version: string | null): void {
  const next = new Map<string, EmailOverride>()
  for (const row of rows) if (row.templateId && row.published && typeof row.published === 'object') next.set(row.templateId, row.published)
  overrides = next
  settings = nextSettings
  loadedVersion = version
}

/** Back to the code defaults (tests). */
export function resetStore(): void {
  overrides = new Map()
  settings = {}
  loadedVersion = null
  warned.clear()
}

export function storeVersion(): string | null {
  return loadedVersion
}

interface SettingsGlobal {
  emailSettings?: EmailSettings | null
}

/** One query for the overrides (templateId and published only) and one for the settings global. */
export async function readPublished(payload: Payload): Promise<{ rows: Array<{ templateId: string; published: EmailOverride | null }>; settings: EmailSettings }> {
  const result = await payload.find({
    collection: 'email-overrides',
    select: { templateId: true, published: true } as never,
    pagination: false,
    limit: 0,
    depth: 0,
    overrideAccess: true,
  })
  const global = (await payload.findGlobal({ slug: 'email-content', depth: 0, overrideAccess: true })) as unknown as SettingsGlobal
  const raw = global.emailSettings ?? {}
  const clean: EmailSettings = {}
  for (const key of ['senderName', 'signOffName', 'signOffHelp', 'companyLine'] as const) if (typeof raw[key] === 'string' && raw[key]!.trim()) clean[key] = raw[key]!.trim()
  return {
    rows: (result.docs as unknown as Array<{ templateId: string; published: EmailOverride | null }>).map((doc) => ({ templateId: String(doc.templateId), published: doc.published ?? null })),
    settings: clean,
  }
}

export interface VersionSource {
  get(key: string): Promise<string | null>
}

export interface StoreOptions {
  redis?: VersionSource
  pollMs?: number
  fallbackMs?: number
  now?: () => number
  read?: (payload: Payload) => ReturnType<typeof readPublished>
}

export interface StoreHandle {
  /** One poll: reloads when the Redis version changed (or, with Redis down, when the fallback interval passed). */
  tick(): Promise<void>
  /** Reloads now (after a publish in this process). */
  reload(): Promise<boolean>
  stop(): void
  ready: Promise<boolean>
}

export function createOverrideStore(payload: Payload, options: StoreOptions = {}): StoreHandle {
  const pollMs = options.pollMs ?? 30_000
  const fallbackMs = options.fallbackMs ?? 5 * 60_000
  const now = options.now ?? Date.now
  const read = options.read ?? readPublished
  let lastLoadAt = 0
  let seenVersion: string | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const versionSource = async (): Promise<VersionSource> => options.redis ?? (await import('../lib/redis.js')).redis

  const reload = async (version: string | null = seenVersion): Promise<boolean> => {
    try {
      const loaded = await read(payload)
      setStoreContents(loaded.rows, loaded.settings, version)
      lastLoadAt = now()
      return true
    } catch (err) {
      // Database down: keep the last good copy.
      lastLoadAt = now()
      logger.error({ err }, 'email_overrides_load_failed')
      return false
    }
  }

  const tick = async (): Promise<void> => {
    let version: string | null
    try {
      version = (await (await versionSource()).get(OVERRIDE_VERSION_KEY)) ?? '0'
    } catch (err) {
      if (now() - lastLoadAt >= fallbackMs) await reload()
      logger.debug({ err }, 'email_overrides_version_unavailable')
      return
    }
    if (version !== seenVersion) {
      seenVersion = version
      await reload(version)
    }
  }

  const ready = (async () => {
    try {
      seenVersion = (await (await versionSource()).get(OVERRIDE_VERSION_KEY)) ?? '0'
    } catch {
      seenVersion = null
    }
    return reload(seenVersion)
  })()

  if (pollMs > 0) {
    timer = setInterval(() => void tick().catch(() => undefined), pollMs)
    timer.unref?.()
  }
  return {
    tick,
    reload: () => reload(),
    stop: () => {
      if (timer) clearInterval(timer)
      timer = null
    },
    ready,
  }
}

let shared: StoreHandle | null = null

/** Starts the process-wide store once (server start, worker, the Studio process) and waits for the first load. */
export async function ensureOverrideStore(payload: Payload): Promise<StoreHandle> {
  if (!shared) shared = createOverrideStore(payload)
  await shared.ready
  return shared
}

/** The running store, if this process started one. */
export function currentOverrideStore(): StoreHandle | null {
  return shared
}
