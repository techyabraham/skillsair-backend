/**
 * The ambassador audit log (AMBASSADORS.md S7): every admin action that changes ambassador money
 * or status is recorded here. Rows are never updated or deleted. Full account numbers never enter
 * the log: any `accountNumber` in before/after is reduced to its last four digits.
 */
import type { Payload, PayloadRequest } from 'payload'
import type { AuditLogDoc } from './types.js'

export interface AuditEntry {
  actorId: number | null
  action: string
  targetCollection: string
  targetId: string | number
  before?: unknown
  after?: unknown
  ip?: string | null
}

function maskAccountNumbers(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => maskAccountNumbers(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = key === 'accountNumber' && typeof inner === 'string' ? `******${inner.slice(-4)}` : maskAccountNumbers(inner, depth + 1)
  }
  return out
}

export async function writeAudit(payload: Payload, entry: AuditEntry, req?: Partial<PayloadRequest>): Promise<AuditLogDoc> {
  const doc = await payload.create({
    collection: 'ambassador-audit-log',
    data: {
      actor: entry.actorId,
      action: entry.action.slice(0, 100),
      targetCollection: entry.targetCollection.slice(0, 100),
      targetId: String(entry.targetId).slice(0, 100),
      before: maskAccountNumbers(entry.before ?? null),
      after: maskAccountNumbers(entry.after ?? null),
      ip: entry.ip ? entry.ip.slice(0, 64) : null,
    },
    overrideAccess: true,
    ...(req ? { req } : {}),
  })
  return doc as unknown as AuditLogDoc
}
