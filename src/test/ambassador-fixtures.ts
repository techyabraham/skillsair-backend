/** Test data for ambassador specs. */
import type { Payload } from 'payload'
import { createTestUser } from './payload-harness.js'
import type { AmbassadorDoc, AmbassadorStatus } from '../lib/ambassadors/types.js'

let seq = 0

export async function createTestAmbassador(
  payload: Payload,
  data: { status?: AmbassadorStatus; code?: string; userId?: number } = {},
): Promise<AmbassadorDoc> {
  seq += 1
  const userId = data.userId ?? (await createTestUser(payload)).id
  const code = data.code ?? `T${String(Date.now() % 1e6).padStart(6, '0')}${String(seq % 10)}`
  const doc = await payload.create({
    collection: 'ambassadors',
    data: { user: userId, code, username: `amb_${userId}_${seq}`, status: data.status ?? 'active', source: 'admin' },
    overrideAccess: true,
    depth: 0,
  })
  return doc as unknown as AmbassadorDoc
}

let orderSeq = 0

/** A paid course order (naira amount, as orders store it). */
export async function createTestOrder(payload: Payload, data: { userId?: number; amountNaira?: number } = {}): Promise<{ id: number }> {
  orderSeq += 1
  const userId = data.userId ?? (await createTestUser(payload)).id
  const doc = await payload.create({
    collection: 'orders',
    data: { user: userId, type: 'course', amount: data.amountNaira ?? 25_000, currency: 'NGN', status: 'success', reference: `TEST-${Date.now()}-${orderSeq}` },
    overrideAccess: true,
  })
  return { id: Number(doc.id) }
}
