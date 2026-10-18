import type { Payload } from 'payload'
import { logger } from '../logger.js'
import { sendEmail } from '../resend.js'
import { sendTemplate } from '../whatsapp.js'
import { listUnsubscribeHeaders, preferencesUrl, type EmailAudience } from '../email-tokens.js'
import { maskEmail } from '../email-preferences.js'
import { buildMessageData, type EventData, type LoadedPerson } from './context.js'
import { LIFECYCLE_EMAILS, LIFECYCLE_WHATSAPP, offerFor, variantFor, variantLabel } from './templates.js'
import type { PlannedStep } from './plan.js'
import type { Kind, Track, WindowState } from './types.js'

/**
 * The only code that sends lifecycle messages. The planner has already applied consent,
 * caps and quiet hours; this renders, sends (or, in dry-run, only records what it would
 * send) and writes the messages log.
 *
 * Switching on (brief step 6): LIFECYCLE_DRY_RUN=false enables real sending for the tracks in
 * LIFECYCLE_LIVE_TRACKS (comma-separated, e.g. "T,D" then "T,D,B"; "all" for everything).
 * Anything else is dry-run: logged as skipped with reason "dry_run", nothing sent.
 */
export type SendOutcome = 'sent' | 'skipped' | 'failed' | 'deferred'

export function isLive(track: Track | string): boolean {
  if (process.env.LIFECYCLE_DRY_RUN !== 'false') return false
  const live = (process.env.LIFECYCLE_LIVE_TRACKS ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  return live.includes('all') || live.includes(track)
}

const MAX_SEND_ATTEMPTS = 3

export interface MessageRecord {
  person: LoadedPerson
  channel: 'email' | 'whatsapp'
  kind: Kind
  track: string
  stepId: string
  template: string
  subjectId: string
  cycle: number
  idempotencyKey: string
  status: 'sent' | 'skipped' | 'failed'
  skipReason?: string
  providerId?: string | null
  sentAt?: string
  variant?: string | null
}

/** Writes one row of the messages log. A dry-run row is replaced when the step later goes for real. */
export async function recordMessage(payload: Payload, record: MessageRecord): Promise<void> {
  const snapshot = record.person.snapshot
  const data = {
    person: { relationTo: snapshot.kind === 'user' ? 'users' : 'leads', value: snapshot.id },
    personKey: snapshot.key,
    channel: record.channel,
    kind: record.kind,
    track: record.track,
    stepId: record.stepId,
    template: record.template,
    subjectId: record.subjectId,
    cycle: record.cycle,
    idempotencyKey: record.idempotencyKey,
    status: record.status,
    skipReason: record.skipReason ?? null,
    providerId: record.providerId ?? null,
    sentAt: record.sentAt ?? new Date().toISOString(),
    variant: record.variant ?? null,
  }
  const existing = await payload.find({ collection: 'messages', where: { idempotencyKey: { equals: record.idempotencyKey } }, limit: 1, depth: 0, overrideAccess: true })
  const row = existing.docs[0] as unknown as { id: number; skipReason?: string | null } | undefined
  if (row) {
    if (row.skipReason === 'dry_run' && record.skipReason !== 'dry_run') {
      await payload.update({ collection: 'messages', id: row.id, data: data as never, depth: 0, overrideAccess: true })
    }
    return
  }
  try {
    await payload.create({ collection: 'messages', data: data as never, depth: 0, overrideAccess: true })
  } catch (err) {
    // A concurrent run logged the same step first: the unique key did its job.
    logger.warn({ err, key: record.idempotencyKey }, 'lifecycle_message_record_conflict')
  }
}

async function failedAttempts(payload: Payload, key: string): Promise<number> {
  const result = await payload.count({ collection: 'messages', where: { idempotencyKey: { like: `${key}#fail` } }, overrideAccess: true })
  return result.totalDocs
}

function audienceOf(person: LoadedPerson): EmailAudience {
  return { type: person.snapshot.kind, id: person.snapshot.id }
}

/** Sends (or records) one planned step. Never throws. */
export async function executeStep(
  payload: Payload,
  person: LoadedPerson,
  step: PlannedStep,
  window: WindowState,
  skipReason?: string,
  extra: EventData = {},
): Promise<SendOutcome> {
  const base = {
    person, channel: step.channel, kind: step.kind, track: step.stage.track, stepId: step.stepId, template: step.template,
    subjectId: step.stage.subjectId, cycle: step.stage.cycle, idempotencyKey: step.idempotencyKey,
  }
  try {
    if (skipReason) {
      await recordMessage(payload, { ...base, status: 'skipped', skipReason })
      return 'skipped'
    }

    const data = { ...(await buildMessageData(payload, person, step.stage, window, extra)), occurrence: Number(/#(\d+)/.exec(step.stepId)?.[1] ?? 0) }
    const userId = person.user?.id
    if (step.channel === 'email') {
      const renderer = LIFECYCLE_EMAILS[step.template]
      if (!renderer) return 'deferred'
      const audience = audienceOf(person)
      const links = step.kind === 'transactional' ? {} : { preferencesUrl: preferencesUrl(audience, step.idempotencyKey), unsubscribeUrl: preferencesUrl(audience, step.idempotencyKey) }
      const variant = variantFor(step.template, person.snapshot.key)
      const content = renderer({ data, offer: await offerFor(payload, step.stage.courseId, userId), links, variant })
      if (!content) return 'deferred'
      if (!isLive(step.stage.track)) {
        logger.info({ to: maskEmail(person.snapshot.email ?? ''), step: step.stepId, track: step.stage.track, subject: content.subject, key: step.idempotencyKey }, 'lifecycle_dry_run')
        await recordMessage(payload, { ...base, status: 'skipped', skipReason: 'dry_run', variant: variantLabel(variant) })
        return 'skipped'
      }
      const providerId = await sendEmail(person.snapshot.email as string, content, {
        stream: step.kind === 'transactional' ? 'transactional' : 'marketing',
        ...(step.kind === 'transactional' ? {} : { headers: listUnsubscribeHeaders(audience, step.kind === 'service' ? 'learning' : 'offers', step.idempotencyKey) }),
        tags: { track: step.stage.track, step: step.stepId },
      })
      await recordMessage(payload, { ...base, status: 'sent', providerId, variant: variantLabel(variant) })
      return 'sent'
    }

    const whatsapp = LIFECYCLE_WHATSAPP[step.template]
    const components = whatsapp?.components(data)
    if (!whatsapp || !components) return 'deferred'
    if (!isLive(step.stage.track)) {
      logger.info({ step: step.stepId, track: step.stage.track, template: step.template, key: step.idempotencyKey }, 'lifecycle_dry_run')
      await recordMessage(payload, { ...base, status: 'skipped', skipReason: 'dry_run' })
      return 'skipped'
    }
    const result = await sendTemplate(person.snapshot.phone as string, step.template, 'en', components)
    if (result.sent) {
      await recordMessage(payload, { ...base, status: 'sent', providerId: result.messageId ?? null })
      await whatsapp.afterSend?.(payload, person.lead)
      return 'sent'
    }
    if (result.skipped) {
      await recordMessage(payload, { ...base, status: 'skipped', skipReason: `whatsapp_${result.skipped}` })
      return 'skipped'
    }
    throw new Error(result.error ?? 'whatsapp_send_failed')
  } catch (err) {
    logger.error({ err, key: step.idempotencyKey }, 'lifecycle_send_failed')
    const attempts = await failedAttempts(payload, step.idempotencyKey).catch(() => MAX_SEND_ATTEMPTS)
    if (attempts + 1 >= MAX_SEND_ATTEMPTS) {
      await recordMessage(payload, { ...base, status: 'failed', skipReason: 'send_failed' }).catch(() => undefined)
    } else {
      await recordMessage(payload, { ...base, idempotencyKey: `${step.idempotencyKey}#fail${attempts + 1}`, status: 'failed', skipReason: 'send_failed_retrying' }).catch(() => undefined)
    }
    return 'failed'
  }
}
