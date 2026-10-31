import type { Payload } from 'payload'
import { relationId, type LeadDoc } from './leads.js'
import type { EmailAudience, EmailCategory } from './email-tokens.js'
import { leadAllowsMarketing, userAllowsMarketing } from './marketing-permission.js'

/**
 * Email preferences for the preference centre and one-click unsubscribe (NDPA 2023 / GAID 2025).
 *
 * - Account holders have two switches: "offers" (marketing; also needs marketing consent) and
 *   "learning reminders" (service emails such as inactivity nudges).
 * - Applicants without an account only have offers, held as the lead's marketing consent,
 *   which also covers WhatsApp marketing.
 * Receipts and account emails are never affected.
 */
export interface EmailPreferences {
  firstName: string
  /** e.g. "to***@gmail.com", so people can see which address the link is for. */
  email: string
  offers: boolean
  learningReminders: boolean
  /** False for applicants without an account (no learning emails to switch off). */
  hasLearningReminders: boolean
}

interface UserPrefsDoc {
  id: number
  email: string
  firstName?: string | null
  marketingConsent?: 'unknown' | 'opted_in' | 'opted_out' | null
  lifecycle?: { emailPrefs?: { offers?: boolean | null; learningReminders?: boolean | null } | null } | null
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(local.length - 2, 6)))}@${domain}`
}

async function findUser(payload: Payload, id: number): Promise<UserPrefsDoc | null> {
  return (await payload.findByID({ collection: 'users', id, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as UserPrefsDoc | null
}

async function findLead(payload: Payload, id: number): Promise<LeadDoc | null> {
  return (await payload.findByID({ collection: 'leads', id, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as LeadDoc | null
}

/** A lead who has since created an account is managed through the account. */
async function resolve(payload: Payload, audience: EmailAudience): Promise<{ user: UserPrefsDoc | null; lead: LeadDoc | null }> {
  if (audience.type === 'user') return { user: await findUser(payload, audience.id), lead: null }
  const lead = await findLead(payload, audience.id)
  const userId = lead ? relationId(lead.user) : undefined
  return { user: userId ? await findUser(payload, userId) : null, lead }
}

export async function loadEmailPreferences(payload: Payload, audience: EmailAudience): Promise<EmailPreferences | null> {
  const { user, lead } = await resolve(payload, audience)
  if (user) {
    const prefs = user.lifecycle?.emailPrefs ?? {}
    return {
      firstName: user.firstName ?? '',
      email: maskEmail(user.email),
      offers: userAllowsMarketing(user, lead),
      learningReminders: prefs.learningReminders !== false,
      hasLearningReminders: true,
    }
  }
  if (!lead) return null
  return {
    firstName: lead.firstName ?? '',
    email: maskEmail(lead.email),
    offers: leadAllowsMarketing(lead),
    learningReminders: false,
    hasLearningReminders: false,
  }
}

export interface PreferenceChange {
  offers?: boolean
  learningReminders?: boolean
  /** Withdraws marketing consent entirely: email and WhatsApp marketing, and learning reminders. */
  unsubscribeAll?: boolean
}

async function withdrawLeadConsent(payload: Payload, leadIds: number[], now: string): Promise<void> {
  for (const id of leadIds) {
    await payload.update({ collection: 'leads', id, data: { marketingConsent: false, optedOutAt: now }, depth: 0, overrideAccess: true })
  }
}

async function leadIdsForUser(payload: Payload, userId: number): Promise<number[]> {
  const result = await payload.find({ collection: 'leads', where: { user: { equals: userId } }, limit: 20, depth: 0, overrideAccess: true })
  return result.docs.map((doc) => Number(doc.id))
}

/**
 * Applies a change and returns the new preferences. Turning offers on is a fresh, express
 * opt-in (recorded with its source); turning everything off is recorded as an opt-out.
 */
export async function saveEmailPreferences(
  payload: Payload,
  audience: EmailAudience,
  change: PreferenceChange,
  source: 'preference_centre' | 'one_click_unsubscribe' | 'email_unsubscribe',
): Promise<EmailPreferences | null> {
  const { user, lead } = await resolve(payload, audience)
  const now = new Date().toISOString()

  if (user) {
    const current = await loadEmailPreferences(payload, { type: 'user', id: user.id })
    if (!current) return null
    const offers = change.unsubscribeAll ? false : change.offers ?? current.offers
    const learningReminders = change.unsubscribeAll ? false : change.learningReminders ?? current.learningReminders
    const data: Record<string, unknown> = { lifecycle: { emailPrefs: { offers, learningReminders } } }
    if (offers && user.marketingConsent !== 'opted_in') {
      Object.assign(data, { marketingConsent: 'opted_in', marketingConsentAt: now, marketingConsentSource: source })
    }
    // Turning offers back on undoes an earlier opt-out on their application too.
    if (change.offers === true) {
      for (const id of await leadIdsForUser(payload, user.id)) {
        await payload.update({ collection: 'leads', id, data: { optedOutAt: null }, depth: 0, overrideAccess: true })
      }
    }
    // Offers off, by any route, is an opt-out: on-by-default means nothing else would record it.
    if (!offers) {
      Object.assign(data, { marketingConsent: 'opted_out', marketingConsentAt: now, marketingConsentSource: source })
      await withdrawLeadConsent(payload, await leadIdsForUser(payload, user.id), now)
    }
    await payload.update({ collection: 'users', id: user.id, data, depth: 0, overrideAccess: true })
    return loadEmailPreferences(payload, { type: 'user', id: user.id })
  }

  if (!lead) return null
  const offers = change.unsubscribeAll ? false : change.offers ?? leadAllowsMarketing(lead)
  if (offers && !leadAllowsMarketing(lead)) {
    await payload.update({
      collection: 'leads',
      id: lead.id,
      data: { marketingConsent: true, marketingConsentAt: now, marketingConsentText: `Turned on in the email preference centre (${source}).`, optedOutAt: null },
      depth: 0,
      overrideAccess: true,
    })
  } else if (!offers) {
    await withdrawLeadConsent(payload, [lead.id], now)
  }
  return loadEmailPreferences(payload, { type: 'lead', id: lead.id })
}

/** One-click unsubscribe from the category named in the token. */
export function changeForCategory(category: EmailCategory): PreferenceChange {
  if (category === 'learning') return { learningReminders: false }
  if (category === 'offers') return { offers: false }
  return { unsubscribeAll: true }
}
