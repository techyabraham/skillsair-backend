import type { Payload, PayloadRequest } from 'payload'
import { sql } from '@payloadcms/db-postgres'

export async function ambassadorSQL(payload: Payload, req: Partial<PayloadRequest>, query: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  const id = await req.transactionID
  if (id == null) throw new Error('Ambassador operation requires a database transaction')
  const db = payload.db as unknown as { sessions: Record<string, { db: { execute(q: ReturnType<typeof sql>): Promise<{ rows: Array<Record<string, unknown>> }> } }> }
  return (await db.sessions[String(id)]!.db.execute(query)).rows
}
