import crypto from 'node:crypto'
import type { Payload, PayloadRequest } from 'payload'
import { verifyLeadToken } from './jwt.js'
import { resolveAuthUser } from '../middleware/authenticate.js'
import { isValidE164Phone } from '../utils/sanitize.js'
import type { AuthUser } from '../types/index.js'

export const LEAD_STATUSES = ['new', 'contacted', 'offer_viewed', 'account_created', 'paid', 'lost'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export const LEAD_SOURCES = ['apply', 'quiz', 'curriculum_request', 'contact', 'employer', 'other'] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

export interface LeadLogEntry {
  direction: 'in' | 'out'
  type: string
  template?: string | null
  body?: string | null
  at: string
}

export interface LeadFollowUp {
  key: string
  sentAt: string
}

export interface LeadDoc {
  id: number
  firstName: string
  email: string
  phone: string
  phoneHash?: string | null
  school?: number | { id: number; name?: string; slug?: string } | null
  course?: number | { id: number; title?: string; slug?: string } | null
  currentStatus?: string | null
  device?: 'laptop' | 'phone_only' | 'both' | null
  weeklyHours?: 'under_5' | '5_8' | '8_plus' | null
  source: LeadSource
  marketingConsent?: boolean | null
  marketingConsentAt?: string | null
  marketingConsentText?: string | null
  optedOutAt?: string | null
  status: LeadStatus
  waitlist?: boolean | null
  score?: number | null
  needsHuman?: boolean | null
  lastEventAt?: string | null
  lastEngagedAt?: string | null
  offerViewCount?: number | null
  resumeCode: string
  lastInboundAt?: string | null
  whatsappLog?: LeadLogEntry[] | null
  followUpsSent?: LeadFollowUp[] | null
  user?: number | { id: number } | null
  createdAt: string
  updatedAt: string
}

const RESUME_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** 10 URL-safe characters for the personal https://skillsair.com/r/<code> link. */
export function generateResumeCode(): string {
  const bytes = crypto.randomBytes(10)
  let code = ''
  for (let i = 0; i < 10; i++) code += RESUME_ALPHABET[bytes[i]! % RESUME_ALPHABET.length]
  return code
}

/** SHA-256 of the E.164 number, so inbound WhatsApp messages can be matched without decrypting every lead. */
export function hashPhone(e164: string): string {
  return crypto.createHash('sha256').update(e164).digest('hex')
}

/**
 * Accepts Nigerian numbers as 0818…, 818…, 234818… or +234818… (spaces, dashes and
 * brackets allowed) and other countries in full international format. Returns E.164 or null.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/[^\d]/g, '')
  let e164: string
  if (hasPlus) e164 = `+${digits}`
  else if (digits.startsWith('234')) e164 = `+${digits}`
  else if (digits.startsWith('0') && digits.length === 11) e164 = `+234${digits.slice(1)}`
  else if (/^[789]\d{9}$/.test(digits)) e164 = `+234${digits}`
  else return null
  if (e164.startsWith('+234') && e164.length !== 14) return null
  return isValidE164Phone(e164) ? e164 : null
}

export function relationId(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return Number((value as { id: number | string }).id)
  }
  return Number(value)
}

export function appendLog(lead: Pick<LeadDoc, 'whatsappLog'>, entry: LeadLogEntry): LeadLogEntry[] {
  return [...(lead.whatsappLog ?? []), entry].slice(-50)
}

export function hasFollowUp(lead: Pick<LeadDoc, 'followUpsSent'>, key: string): boolean {
  return (lead.followUpsSent ?? []).some((item) => item.key === key)
}

export function lastFollowUpAt(lead: Pick<LeadDoc, 'followUpsSent'>, key: string): number {
  return (lead.followUpsSent ?? [])
    .filter((item) => item.key === key)
    .reduce((latest, item) => Math.max(latest, new Date(item.sentAt).getTime()), 0)
}

export type LeadEvent =
  | { type: 'talk' }
  | { type: 'free_text' }
  | { type: 'offer_viewed' }
  | { type: 'account_created' }
  | { type: 'account_no_payment' }
  | { type: 'payment_failed' }
  | { type: 'window_closing_viewed' }
  | { type: 'paid' }

const clampScore = (value: number) => Math.max(0, Math.min(100, value))

/** Applies one scoring event (Section 7.4 of the rebuild brief) and returns the fields to update. */
export function scoreLeadEvent(lead: LeadDoc, event: LeadEvent): Partial<LeadDoc> {
  const score = Number(lead.score ?? 0)
  const now = new Date().toISOString()
  const base: Partial<LeadDoc> = { lastEventAt: now }
  if (lead.status === 'paid' && event.type !== 'paid') return base
  switch (event.type) {
    case 'talk':
    case 'free_text':
      return { ...base, lastEngagedAt: now, score: clampScore(score + 40), needsHuman: true }
    case 'offer_viewed': {
      const offerViewCount = Number(lead.offerViewCount ?? 0) + 1
      const advance = lead.status === 'new' || lead.status === 'contacted'
      return {
        ...base,
        lastEngagedAt: now,
        offerViewCount,
        ...(offerViewCount === 2 ? { score: clampScore(score + 20) } : {}),
        ...(advance ? { status: 'offer_viewed' as const } : {}),
      }
    }
    case 'account_created':
      return { ...base, status: 'account_created' }
    case 'account_no_payment':
      return { ...base, score: clampScore(score + 30), needsHuman: true }
    case 'payment_failed':
      return { ...base, score: clampScore(score + 40), needsHuman: true }
    case 'window_closing_viewed':
      return { ...base, score: clampScore(score + 10) }
    case 'paid':
      return { ...base, status: 'paid', needsHuman: false }
  }
}

export async function applyLeadEvent(payload: Payload, lead: LeadDoc, event: LeadEvent): Promise<LeadDoc> {
  const data = scoreLeadEvent(lead, event)
  return (await payload.update({
    collection: 'leads',
    id: lead.id,
    data: data as Record<string, unknown>,
    depth: 0,
    overrideAccess: true,
  })) as unknown as LeadDoc
}

export async function findLeadByEmail(payload: Payload, email: string): Promise<LeadDoc | null> {
  const result = await payload.find({
    collection: 'leads',
    where: { email: { equals: email.trim().toLowerCase() } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (result.docs[0] as unknown as LeadDoc | undefined) ?? null
}

export async function findLeadByPhone(payload: Payload, e164: string): Promise<LeadDoc | null> {
  const result = await payload.find({
    collection: 'leads',
    where: { phoneHash: { equals: hashPhone(e164) } },
    sort: '-updatedAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (result.docs[0] as unknown as LeadDoc | undefined) ?? null
}

export async function findLeadForUser(payload: Payload, user: AuthUser): Promise<LeadDoc | null> {
  const linked = await payload.find({
    collection: 'leads',
    where: { user: { equals: user.id } },
    sort: '-updatedAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const lead = linked.docs[0] as unknown as LeadDoc | undefined
  return lead ?? findLeadByEmail(payload, user.email)
}

function bearerToken(req: PayloadRequest): string | null {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim() || null
}

/** Resolves a lead from a lead token, or from a logged-in user's linked lead. Never throws. */
export async function resolveLeadRequest(req: PayloadRequest): Promise<{ lead: LeadDoc | null; user: AuthUser | null }> {
  const token = bearerToken(req)
  if (!token) return { lead: null, user: null }
  try {
    const { leadId } = verifyLeadToken(token)
    const lead = await req.payload
      .findByID({ collection: 'leads', id: leadId, depth: 0, overrideAccess: true })
      .catch(() => null)
    return { lead: (lead as unknown as LeadDoc | null) ?? null, user: null }
  } catch {
    const user = await resolveAuthUser(req)
    if (!user) return { lead: null, user: null }
    return { lead: await findLeadForUser(req.payload, user), user }
  }
}

/** Lagos is UTC+1 all year. */
export function lagosParts(date = new Date()): { day: number; hour: number } {
  const lagos = new Date(date.getTime() + 60 * 60 * 1000)
  return { day: lagos.getUTCDay(), hour: lagos.getUTCHours() }
}

/** Imisi is available Monday–Saturday, 9am–6pm WAT. */
export function isAdvisorHours(date = new Date()): boolean {
  const { day, hour } = lagosParts(date)
  return day >= 1 && day <= 6 && hour >= 9 && hour < 18
}

export function formatLagosDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso))
}

function unsubscribeSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set and at least 32 characters long')
  return secret
}

/** Signed, non-expiring unsubscribe token for marketing emails: "<leadId>.<signature>". */
export function unsubscribeToken(leadId: number): string {
  const signature = crypto.createHmac('sha256', unsubscribeSecret()).update(`unsubscribe:${leadId}`).digest('base64url').slice(0, 32)
  return `${leadId}.${signature}`
}

export function verifyUnsubscribeToken(token: string): number | null {
  const [id, signature] = token.split('.')
  const leadId = Number(id)
  if (!Number.isInteger(leadId) || leadId <= 0 || !signature) return null
  const expected = unsubscribeToken(leadId).split('.')[1] ?? ''
  if (expected.length !== signature.length) return null
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)) ? leadId : null
}
