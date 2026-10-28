/**
 * Ambassador programme settings: the ambassador-settings global with every default from
 * AMBASSADORS.md applied to empty fields. Cached in memory for 60 seconds; the global's
 * afterChange hook clears the cache, so a save in Studio applies at once on that instance.
 */
import type { Payload } from 'payload'
import type { AmbassadorSettings, CommissionableType } from './types.js'

export const AMBASSADOR_SETTINGS_DEFAULTS: Readonly<AmbassadorSettings> = Object.freeze<AmbassadorSettings>({
  programOpen: true,
  defaultApplicationStatus: 'pending',
  commissionRateBps: 5000,
  commissionableTypes: ['course', 'subscription', 'renewal'],
  approvalDelayDays: 7,
  cookieDays: 30,
  attributionModel: 'first_click',
  attributionLifetimeDays: null,
  minPayoutKobo: 500_000,
  payoutsEnabled: true,
  payoutMode: 'manual_review',
  perTransferCapKobo: 20_000_000,
  dailyCapKobo: 100_000_000,
  newBankHoldHours: 48,
  showReferredEmails: true,
  heardAboutOptions: ['Instagram', 'Facebook', 'WhatsApp', 'X (Twitter)', 'TikTok', 'YouTube', 'A friend', 'Other'],
  shareMessage: "I'm learning job-ready tech skills on SkillsAir. Start here: {link}",
})

const CACHE_MS = 60_000
const COMMISSIONABLE: readonly CommissionableType[] = ['course', 'subscription', 'renewal', 'certificate']

let cache: { value: AmbassadorSettings; expiresAt: number } | null = null

export function clearAmbassadorSettingsCache(): void {
  cache = null
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function int(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Applies the defaults to a raw global document (empty or invalid fields take the default). */
export function withAmbassadorDefaults(raw: Record<string, unknown> | null | undefined): AmbassadorSettings {
  const doc = raw ?? {}
  const D = AMBASSADOR_SETTINGS_DEFAULTS
  const types = Array.isArray(doc.commissionableTypes)
    ? doc.commissionableTypes.filter((t): t is CommissionableType => COMMISSIONABLE.includes(t as CommissionableType))
    : []
  const heard = Array.isArray(doc.heardAboutOptions)
    ? doc.heardAboutOptions
        .map((row) => (typeof row === 'string' ? row : (row as { option?: unknown } | null)?.option))
        .filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
    : []
  const lifetime = doc.attributionLifetimeDays
  return {
    programOpen: bool(doc.programOpen, D.programOpen),
    defaultApplicationStatus: oneOf(doc.defaultApplicationStatus, ['pending', 'active'], D.defaultApplicationStatus),
    commissionRateBps: int(doc.commissionRateBps, D.commissionRateBps, 0, 10_000),
    // An empty list means "not set": to stop paying commission, set the rate to 0.
    commissionableTypes: types.length ? [...new Set(types)] : [...D.commissionableTypes],
    approvalDelayDays: int(doc.approvalDelayDays, D.approvalDelayDays, 0, 60),
    cookieDays: int(doc.cookieDays, D.cookieDays, 1, 365),
    attributionModel: oneOf(doc.attributionModel, ['first_click', 'last_click'], D.attributionModel),
    attributionLifetimeDays: lifetime === null || lifetime === undefined || lifetime === '' ? null : int(lifetime, 0, 1) || null,
    minPayoutKobo: int(doc.minPayoutKobo, D.minPayoutKobo, 0),
    payoutsEnabled: bool(doc.payoutsEnabled, D.payoutsEnabled),
    payoutMode: oneOf(doc.payoutMode, ['manual_review', 'automatic'], D.payoutMode),
    perTransferCapKobo: int(doc.perTransferCapKobo, D.perTransferCapKobo, 0),
    dailyCapKobo: int(doc.dailyCapKobo, D.dailyCapKobo, 0),
    newBankHoldHours: int(doc.newBankHoldHours, D.newBankHoldHours, 0),
    showReferredEmails: bool(doc.showReferredEmails, D.showReferredEmails),
    heardAboutOptions: heard.length ? heard : [...D.heardAboutOptions],
    shareMessage: typeof doc.shareMessage === 'string' && doc.shareMessage.trim() ? doc.shareMessage : D.shareMessage,
  }
}

export async function getAmbassadorSettings(payload: Payload): Promise<AmbassadorSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value
  const raw = await payload.findGlobal({ slug: 'ambassador-settings', depth: 0, overrideAccess: true })
  const value = withAmbassadorDefaults(raw as unknown as Record<string, unknown>)
  cache = { value, expiresAt: Date.now() + CACHE_MS }
  return value
}
