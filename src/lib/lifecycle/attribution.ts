import type { Payload, Where } from 'payload'
import { logger } from '../logger.js'

/**
 * Conversion attribution (brief section 12): each track is judged by money or progress, not
 * opens. When a conversion happens, the most recent message from the relevant tracks that got
 * a click inside the window is marked converted (once).
 *
 * A and B (and G): a subscription started within 7 days of the click · D: a recovered payment ·
 * R: a restart · C: a certificate bought · I: a lesson completed within 72 hours.
 */
export type Conversion = 'subscribed' | 'recovered' | 'restarted' | 'certificate' | 'lesson'

const RULES: Record<Conversion, { tracks: string[]; windowMs: number }> = {
  subscribed: { tracks: ['A', 'Apost', 'B', 'G'], windowMs: 7 * 86_400_000 },
  recovered: { tracks: ['D', 'T'], windowMs: 7 * 86_400_000 },
  restarted: { tracks: ['R', 'T', 'D'], windowMs: 7 * 86_400_000 },
  certificate: { tracks: ['C', 'T'], windowMs: 7 * 86_400_000 },
  lesson: { tracks: ['I'], windowMs: 72 * 60 * 60 * 1000 },
}

/** Every message history key for a user: their own, and any application made before the account. */
async function personKeys(payload: Payload, userId: number): Promise<string[]> {
  const leads = await payload.find({ collection: 'leads', where: { user: { equals: userId } }, limit: 10, depth: 0, overrideAccess: true })
  return [`user:${userId}`, ...leads.docs.map((lead) => `lead:${lead.id}`)]
}

export async function attributeConversion(payload: Payload, userId: number, conversion: Conversion, now = Date.now()): Promise<number | null> {
  try {
    const rule = RULES[conversion]
    const result = await payload.find({
      collection: 'messages',
      where: {
        and: [
          { personKey: { in: await personKeys(payload, userId) } },
          { track: { in: rule.tracks } },
          { status: { equals: 'sent' } },
          { clickedAt: { greater_than: new Date(now - rule.windowMs).toISOString() } },
          { convertedAt: { exists: false } },
        ],
      },
      sort: '-clickedAt',
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const message = result.docs[0]
    if (!message) return null
    await payload.update({ collection: 'messages', id: message.id, data: { convertedAt: new Date(now).toISOString() }, depth: 0, overrideAccess: true })
    logger.info({ messageId: message.id, conversion, stepId: message.stepId }, 'lifecycle_conversion_attributed')
    return Number(message.id)
  } catch (err) {
    logger.error({ err, userId, conversion }, 'lifecycle_attribution_failed')
    return null
  }
}

/** Marks the message an unsubscribe or a spam complaint came from. */
export async function markMessageOutcome(
  payload: Payload,
  where: { idempotencyKey?: string; providerId?: string },
  field: 'unsubscribedAt' | 'complainedAt',
): Promise<void> {
  const condition: Where | null = where.idempotencyKey ? { idempotencyKey: { equals: where.idempotencyKey } } : where.providerId ? { providerId: { equals: where.providerId } } : null
  if (!condition) return
  const result = await payload.find({ collection: 'messages', where: condition, limit: 1, depth: 0, overrideAccess: true }).catch(() => null)
  const message = result?.docs[0]
  if (!message || message[field]) return
  await payload.update({ collection: 'messages', id: message.id, data: { [field]: new Date().toISOString() }, depth: 0, overrideAccess: true }).catch((err: unknown) => logger.error({ err }, 'message_outcome_failed'))
}
