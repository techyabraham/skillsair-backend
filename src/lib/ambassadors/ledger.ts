/**
 * The ambassador ledger (AMBASSADORS.md M4-M7): the only code that writes `ambassador-ledger`.
 *
 * - Rows are append-only. After insert only `status` changes (and `payout`, set on insert), and
 *   only along the transitions in M5; every change is a conditional UPDATE that re-checks the
 *   current status in the same statement, so two callers can never both move a row.
 * - Every row has an idempotency key (M7). Inserting a key that exists returns the existing row
 *   with created: false: webhooks, retries and jobs are safe to run twice.
 * - Wallet figures are derived from the rows on every read, in one aggregate query (M6).
 *
 * Each function takes an optional `req` carrying a Payload transaction (see withTransaction);
 * raw SQL then runs on that transaction's connection too.
 */
import { randomUUID } from 'node:crypto'
import type { Payload, PayloadRequest } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { logger } from '../logger.js'
import type { LedgerDoc, LedgerProductType, LedgerStatus, LedgerType } from './types.js'

type SQLQuery = ReturnType<typeof sql>
type Executor = { execute: (q: SQLQuery) => Promise<{ rows: Array<Record<string, unknown>> }> }
type Req = Partial<PayloadRequest> | undefined

export class LedgerError extends Error {
  constructor(
    readonly code: 'invalid_entry' | 'invalid_transition' | 'not_found' | 'insufficient_balance',
    message: string,
  ) {
    super(message)
    this.name = 'LedgerError'
  }
}

/** Statuses a row may be inserted with. Commissions start pending (approved only for imports); payouts start reserved (paid only for imports). */
const INSERT_STATUSES: Record<LedgerType, readonly LedgerStatus[]> = {
  commission: ['pending', 'approved'],
  reversal: ['approved'],
  adjustment: ['approved'],
  payout: ['reserved', 'paid'],
}

/** M5 transitions: type -> target status -> statuses it may come from. */
const TRANSITIONS: Record<LedgerType, Partial<Record<LedgerStatus, readonly LedgerStatus[]>>> = {
  commission: { approved: ['pending'], void: ['pending'] },
  reversal: {},
  adjustment: {},
  payout: { paid: ['reserved'], void: ['reserved'] },
}

const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

/** M7 key formats, by type. */
const KEY_FORMATS: Record<LedgerType, RegExp> = {
  commission: /^(commission:order:\d+(:partial)?|commission:invoice:[A-Za-z0-9_-]+|import:wp-commission:[A-Za-z0-9_-]+)$/,
  reversal: /^reversal:order:\d+:[A-Za-z0-9_:.-]+$/,
  adjustment: new RegExp(`^adjustment:${UUID_V4}$`),
  payout: /^(payout:\d+|import:wp-withdrawal:[A-Za-z0-9_-]+)$/,
}

export interface NewLedgerEntry {
  ambassadorId: number
  type: LedgerType
  status: LedgerStatus
  amountKobo: number
  idempotencyKey: string
  saleKobo?: number | null
  rateBps?: number | null
  orderId?: number | null
  subscriptionId?: number | null
  invoiceCode?: string | null
  payoutId?: number | null
  referredUserId?: number | null
  productType?: LedgerProductType | null
  productTitle?: string | null
  availableAt?: Date | string | null
  note?: string | null
  createdById?: number | null
}

export interface Wallet {
  pendingKobo: number
  availableKobo: number
  inFlightKobo: number
  paidOutKobo: number
  totalEarnedKobo: number
}

async function executor(payload: Payload, req: Req): Promise<Executor> {
  const db = payload.db as unknown as { drizzle: Executor; sessions?: Record<string, { db: Executor } | undefined> }
  const id = req?.transactionID instanceof Promise ? await req.transactionID : req?.transactionID
  const session = id !== undefined && id !== null ? db.sessions?.[String(id)] : undefined
  return session?.db ?? db.drizzle
}

async function run(payload: Payload, req: Req, statement: SQLQuery): Promise<Array<Record<string, unknown>>> {
  return (await (await executor(payload, req)).execute(statement)).rows
}

/**
 * Runs fn inside one database transaction (Payload's beginTransaction / commitTransaction /
 * rollbackTransaction). Pass the req it gives you to every ledger call and Payload operation.
 */
export async function withTransaction<T>(payload: Payload, fn: (req: Partial<PayloadRequest>) => Promise<T>): Promise<T> {
  const transactionID = await payload.db.beginTransaction()
  const req: Partial<PayloadRequest> = transactionID === null ? { payload } : { payload, transactionID }
  try {
    const result = await fn(req)
    if (transactionID !== null) await payload.db.commitTransaction(transactionID)
    return result
  } catch (err) {
    if (transactionID !== null) await payload.db.rollbackTransaction(transactionID)
    throw err
  }
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function validateEntry(entry: NewLedgerEntry): void {
  const fail = (message: string): never => { throw new LedgerError('invalid_entry', message) }
  if (!isId(entry.ambassadorId)) fail('ambassadorId must be a positive integer')
  if (!(entry.type in INSERT_STATUSES)) fail(`Unknown ledger type: ${String(entry.type)}`)
  if (!INSERT_STATUSES[entry.type].includes(entry.status)) fail(`A ${entry.type} cannot be created as ${entry.status}`)
  if (!Number.isSafeInteger(entry.amountKobo)) fail('amountKobo must be a safe integer')
  const amount = entry.amountKobo
  if (entry.type === 'commission' && amount <= 0) fail('A commission must be positive')
  if ((entry.type === 'reversal' || entry.type === 'payout') && amount >= 0) fail(`A ${entry.type} must be negative`)
  if (entry.type === 'adjustment' && amount === 0) fail('An adjustment cannot be zero')
  if (entry.saleKobo !== undefined && entry.saleKobo !== null && (!Number.isSafeInteger(entry.saleKobo) || entry.saleKobo < 0)) fail('saleKobo must be a non-negative integer')
  if (entry.rateBps !== undefined && entry.rateBps !== null && (!Number.isInteger(entry.rateBps) || entry.rateBps < 0 || entry.rateBps > 10_000)) fail('rateBps must be an integer from 0 to 10000')
  if (typeof entry.idempotencyKey !== 'string' || entry.idempotencyKey.length > 200 || !KEY_FORMATS[entry.type].test(entry.idempotencyKey)) {
    fail(`idempotencyKey "${String(entry.idempotencyKey)}" does not match the ${entry.type} format`)
  }
  if (entry.type === 'adjustment' && (typeof entry.note !== 'string' || entry.note.trim().length < 10)) fail('An adjustment needs a note of at least 10 characters')
  if (entry.note && entry.note.length > 500) fail('note is longer than 500 characters')
  for (const key of ['orderId', 'subscriptionId', 'payoutId', 'referredUserId', 'createdById'] as const) {
    const value = entry[key]
    if (value !== undefined && value !== null && !isId(value)) fail(`${key} must be a positive integer`)
  }
}

async function findEntry(payload: Payload, id: number, req: Req): Promise<LedgerDoc> {
  return (await payload.findByID({ collection: 'ambassador-ledger', id, depth: 0, overrideAccess: true, req })) as unknown as LedgerDoc
}

async function findByIds(payload: Payload, ids: number[], req: Req): Promise<LedgerDoc[]> {
  if (!ids.length) return []
  const result = await payload.find({
    collection: 'ambassador-ledger',
    where: { id: { in: ids } },
    limit: ids.length,
    pagination: false,
    sort: 'id',
    depth: 0,
    overrideAccess: true,
    req,
  })
  return result.docs as unknown as LedgerDoc[]
}

const iso = (value: Date | string | null | undefined): string | null =>
  value === null || value === undefined ? null : new Date(value).toISOString()

/**
 * Inserts a ledger row. If its idempotency key already exists, nothing is written and the
 * existing row comes back with created: false.
 */
export async function insertLedgerEntry(payload: Payload, entry: NewLedgerEntry, req?: Req): Promise<{ entry: LedgerDoc; created: boolean }> {
  validateEntry(entry)
  const rows = await run(payload, req, sql`
    INSERT INTO "ambassador_ledger" (
      "ambassador_id", "type", "status", "amount_kobo", "sale_kobo", "rate_bps", "order_id", "subscription_id",
      "invoice_code", "payout_id", "referred_user_id", "product_type", "product_title", "available_at",
      "idempotency_key", "note", "created_by_id"
    ) VALUES (
      ${entry.ambassadorId}, ${entry.type}, ${entry.status}, ${entry.amountKobo}, ${entry.saleKobo ?? null}, ${entry.rateBps ?? null},
      ${entry.orderId ?? null}, ${entry.subscriptionId ?? null}, ${entry.invoiceCode ?? null}, ${entry.payoutId ?? null},
      ${entry.referredUserId ?? null}, ${entry.productType ?? null}, ${entry.productTitle ?? null}, ${iso(entry.availableAt)},
      ${entry.idempotencyKey}, ${entry.note ?? null}, ${entry.createdById ?? null}
    )
    ON CONFLICT ("idempotency_key") DO NOTHING
    RETURNING "id"`)
  const insertedId = rows[0]?.id
  if (insertedId !== undefined) return { entry: await findEntry(payload, Number(insertedId), req), created: true }

  const [existing] = await run(payload, req, sql`SELECT "id" FROM "ambassador_ledger" WHERE "idempotency_key" = ${entry.idempotencyKey}`)
  if (!existing) throw new LedgerError('not_found', `Ledger insert for ${entry.idempotencyKey} conflicted but no row was found`)
  const doc = await findEntry(payload, Number(existing.id), req)
  const ambassadorId = typeof doc.ambassador === 'number' ? doc.ambassador : doc.ambassador.id
  if (ambassadorId !== entry.ambassadorId || doc.type !== entry.type || doc.amountKobo !== entry.amountKobo) {
    logger.warn({ ledgerId: doc.id, key: entry.idempotencyKey }, 'ambassador_ledger_key_reused_with_different_values')
  }
  return { entry: doc, created: false }
}

/**
 * Moves one row to `to`, only along the M5 transitions. The current status is re-checked in the
 * same UPDATE; if the row is not in an allowed status it is re-read and the change refused.
 */
export async function transitionLedgerEntry(payload: Payload, ledgerId: number, to: LedgerStatus, req?: Req): Promise<LedgerDoc> {
  if (!isId(ledgerId)) throw new LedgerError('invalid_entry', 'ledgerId must be a positive integer')
  const allowedTypes = (Object.keys(TRANSITIONS) as LedgerType[]).filter((type) => TRANSITIONS[type][to]?.length)
  const clauses = allowedTypes.map((type) => sql`("type" = ${type} AND "status"::text IN (${sql.join((TRANSITIONS[type][to] ?? []).map((s) => sql`${s}`), sql`, `)}))`)
  const rows = clauses.length
    ? await run(payload, req, sql`
        UPDATE "ambassador_ledger" SET "status" = ${to}, "updated_at" = now()
        WHERE "id" = ${ledgerId} AND (${sql.join(clauses, sql` OR `)})
        RETURNING "id"`)
    : []
  if (rows.length) return findEntry(payload, ledgerId, req)

  const [current] = await run(payload, req, sql`SELECT "type", "status" FROM "ambassador_ledger" WHERE "id" = ${ledgerId}`)
  if (!current) throw new LedgerError('not_found', `Ledger entry ${ledgerId} does not exist`)
  throw new LedgerError('invalid_transition', `A ${String(current.type)} cannot go from ${String(current.status)} to ${to}`)
}

const num = (value: unknown): number => {
  const n = Number(value ?? 0)
  return n === 0 ? 0 : n // no -0
}

/** The five wallet figures of M6, from one aggregate query over the ambassador's rows. */
export async function getWallet(payload: Payload, ambassadorId: number, req?: Req): Promise<Wallet> {
  if (!isId(ambassadorId)) throw new LedgerError('invalid_entry', 'ambassadorId must be a positive integer')
  const [row] = await run(payload, req, sql`
    SELECT
      COALESCE(SUM("amount_kobo") FILTER (WHERE "type" = 'commission' AND "status" = 'pending'), 0) AS "pending",
      COALESCE(SUM("amount_kobo") FILTER (
        WHERE ("type" IN ('commission', 'reversal', 'adjustment') AND "status" = 'approved')
           OR ("type" = 'payout' AND "status" IN ('reserved', 'paid'))
      ), 0) AS "available",
      COALESCE(-SUM("amount_kobo") FILTER (WHERE "type" = 'payout' AND "status" = 'reserved'), 0) AS "in_flight",
      COALESCE(-SUM("amount_kobo") FILTER (WHERE "type" = 'payout' AND "status" = 'paid'), 0) AS "paid_out",
      COALESCE(SUM("amount_kobo") FILTER (
        WHERE ("type" = 'commission' AND "status" IN ('pending', 'approved'))
           OR "type" IN ('reversal', 'adjustment')
      ), 0) AS "total_earned"
    FROM "ambassador_ledger"
    WHERE "ambassador_id" = ${ambassadorId}`)
  return {
    pendingKobo: num(row?.pending),
    availableKobo: num(row?.available),
    inFlightKobo: num(row?.in_flight),
    paidOutKobo: num(row?.paid_out),
    totalEarnedKobo: num(row?.total_earned),
  }
}

/**
 * Approves pending commissions whose availableAt has passed, oldest first, at most `limit`, for
 * ambassadors that still exist and are active or blocked (blocked ambassadors keep earned money).
 * Safe to run twice and on two instances at once (rows are claimed with SKIP LOCKED).
 */
export async function approveDueCommissions(
  payload: Payload,
  now: Date,
  limit: number,
  req?: Req,
): Promise<Array<{ ambassadorId: number; entries: LedgerDoc[] }>> {
  if (!Number.isInteger(limit) || limit < 1) throw new LedgerError('invalid_entry', 'limit must be a positive integer')
  const rows = await run(payload, req, sql`
    WITH "due" AS (
      SELECT l."id" FROM "ambassador_ledger" l
      JOIN "ambassadors" a ON a."id" = l."ambassador_id"
      WHERE l."type" = 'commission' AND l."status" = 'pending' AND l."available_at" <= ${now.toISOString()}
        AND a."status" IN ('active', 'blocked')
      ORDER BY l."available_at", l."id"
      LIMIT ${limit}
      FOR UPDATE OF l SKIP LOCKED
    )
    UPDATE "ambassador_ledger" SET "status" = 'approved', "updated_at" = now()
    FROM "due" WHERE "ambassador_ledger"."id" = "due"."id" AND "ambassador_ledger"."status" = 'pending'
    RETURNING "ambassador_ledger"."id"`)
  const entries = await findByIds(payload, rows.map((row) => Number(row.id)), req)
  const grouped = new Map<number, LedgerDoc[]>()
  for (const entry of entries) {
    const ambassadorId = typeof entry.ambassador === 'number' ? entry.ambassador : entry.ambassador.id
    grouped.set(ambassadorId, [...(grouped.get(ambassadorId) ?? []), entry])
  }
  return [...grouped].map(([ambassadorId, list]) => ({ ambassadorId, entries: list }))
}

/** A refund before approval: the pending commission becomes void (the reason is logged; rows keep no edits). */
export async function voidPendingCommission(payload: Payload, ledgerId: number, reason: string, req?: Req): Promise<LedgerDoc> {
  const [row] = isId(ledgerId) ? await run(payload, req, sql`SELECT "type" FROM "ambassador_ledger" WHERE "id" = ${ledgerId}`) : []
  if (!row) throw new LedgerError('not_found', `Ledger entry ${String(ledgerId)} does not exist`)
  if (row.type !== 'commission') throw new LedgerError('invalid_transition', 'Only a commission can be voided this way')
  const entry = await transitionLedgerEntry(payload, ledgerId, 'void', req)
  logger.info({ ledgerId, reason }, 'ambassador_commission_voided')
  return entry
}

/** A refund after approval: a negative reversal row (approved at once). amountKobo is the negative amount to take back. */
export async function recordReversal(
  payload: Payload,
  args: { ambassadorId: number; orderId: number; amountKobo: number; key: string; note?: string | null },
  req?: Req,
): Promise<{ entry: LedgerDoc; created: boolean }> {
  if (!args.key.startsWith(`reversal:order:${args.orderId}:`)) {
    throw new LedgerError('invalid_entry', `A reversal key for order ${args.orderId} must start with reversal:order:${args.orderId}:`)
  }
  return insertLedgerEntry(payload, {
    ambassadorId: args.ambassadorId,
    type: 'reversal',
    status: 'approved',
    amountKobo: args.amountKobo,
    orderId: args.orderId,
    idempotencyKey: args.key,
    note: args.note ?? null,
  }, req)
}

/** An admin's correction (positive or negative), approved at once. Needs a note of 10 characters or more. */
export async function recordAdjustment(
  payload: Payload,
  args: { ambassadorId: number; amountKobo: number; note: string; createdBy: number },
  req?: Req,
): Promise<LedgerDoc> {
  const { entry } = await insertLedgerEntry(payload, {
    ambassadorId: args.ambassadorId,
    type: 'adjustment',
    status: 'approved',
    amountKobo: args.amountKobo,
    note: args.note,
    createdById: args.createdBy,
    idempotencyKey: `adjustment:${randomUUID()}`,
  }, req)
  return entry
}

/**
 * Reserves a payout: a negative `reserved` row keyed payout:<payoutId>. Refuses an amount larger
 * than the available balance. Callers hold the ambassador's withdrawal lock (withLock) so the
 * balance cannot change between this check and the insert.
 */
export async function reservePayout(
  payload: Payload,
  args: { ambassadorId: number; payoutId: number; amountKobo: number },
  req?: Req,
): Promise<{ entry: LedgerDoc; created: boolean }> {
  if (!Number.isSafeInteger(args.amountKobo) || args.amountKobo <= 0) throw new LedgerError('invalid_entry', 'A payout amount must be a positive integer')
  const key = `payout:${args.payoutId}`
  const [existing] = await run(payload, req, sql`SELECT "id" FROM "ambassador_ledger" WHERE "idempotency_key" = ${key}`)
  if (!existing) {
    const wallet = await getWallet(payload, args.ambassadorId, req)
    if (wallet.availableKobo < args.amountKobo) {
      throw new LedgerError('insufficient_balance', `Available ${wallet.availableKobo} kobo is less than ${args.amountKobo}`)
    }
  }
  return insertLedgerEntry(payload, {
    ambassadorId: args.ambassadorId,
    type: 'payout',
    status: 'reserved',
    amountKobo: -args.amountKobo,
    payoutId: args.payoutId,
    idempotencyKey: key,
  }, req)
}

async function payoutEntryId(payload: Payload, payoutId: number, req: Req): Promise<number> {
  const [row] = await run(payload, req, sql`SELECT "id" FROM "ambassador_ledger" WHERE "idempotency_key" = ${`payout:${payoutId}`}`)
  if (!row) throw new LedgerError('not_found', `No ledger row for payout ${payoutId}`)
  return Number(row.id)
}

/** The transfer succeeded: reserved -> paid. */
export async function markPayoutPaid(payload: Payload, payoutId: number, req?: Req): Promise<LedgerDoc> {
  return transitionLedgerEntry(payload, await payoutEntryId(payload, payoutId, req), 'paid', req)
}

/** The transfer failed or was rejected: reserved -> void, and the money is available again. */
export async function voidPayout(payload: Payload, payoutId: number, req?: Req): Promise<LedgerDoc> {
  return transitionLedgerEntry(payload, await payoutEntryId(payload, payoutId, req), 'void', req)
}
