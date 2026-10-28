/**
 * Integration-test harness: boots Payload's local API against a disposable Postgres named by
 * TEST_DATABASE_URI, applies every registered migration exactly as `npm run migrate:fallback`
 * does (each migration's own up(), recorded in payload_migrations), and truncates tables between
 * tests.
 *
 * Without TEST_DATABASE_URI the integration specs skip with a message. The URI must point at
 * localhost: this harness drops data, so it refuses anything else.
 *
 *   initdb -D <dir> -U postgres --auth=trust && pg_ctl -D <dir> -o "-p 55432" start
 *   createdb -h localhost -p 55432 -U postgres amb_test
 *   TEST_DATABASE_URI=postgres://postgres@localhost:55432/amb_test npm test
 */
import { describe } from 'vitest'
import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres'

type SQLQuery = ReturnType<typeof sql>

interface Migration {
  name: string
  up: (args: { db: unknown; payload: unknown; req: unknown }) => Promise<void>
}

export const TEST_DATABASE_URI = process.env.TEST_DATABASE_URI ?? ''

/** describe() for specs that need the database; skipped (with a note) when TEST_DATABASE_URI is unset. */
export const describeWithDb = describe.skipIf(!TEST_DATABASE_URI)

if (!TEST_DATABASE_URI) {
  console.warn('[integration] TEST_DATABASE_URI is not set: database specs are skipped. See src/test/payload-harness.ts.')
}

/** The ambassador tables, child (array) tables included, truncated between tests. */
export const AMBASSADOR_TABLES = [
  'ambassadors',
  'ambassadors_risk_flags',
  'ambassador_bank_accounts',
  'referral_clicks',
  'referral_attributions',
  'ambassador_ledger',
  'ambassador_payouts',
  'ambassador_audit_log',
] as const

function assertLocal(uri: string): void {
  const host = new URL(uri).hostname
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(`TEST_DATABASE_URI must point at a local disposable database (got host "${host}").`)
  }
}

let booted: Promise<Payload> | undefined

/** Payload's local API on the test database, migrated. One instance per test file. */
export function getTestPayload(): Promise<Payload> {
  booted ??= boot()
  return booted
}

async function boot(): Promise<Payload> {
  if (!TEST_DATABASE_URI) throw new Error('TEST_DATABASE_URI is not set')
  assertLocal(TEST_DATABASE_URI)
  // payload.config.ts reads these when it is imported. PAYLOAD_MIGRATING stops the adapter from
  // pushing the schema itself (dev mode), so the database only ever gets the real migrations.
  process.env.DATABASE_URI = TEST_DATABASE_URI
  process.env.PAYLOAD_MIGRATING = 'true'
  delete process.env.PGBOUNCER_URL
  delete process.env.RESEND_API_KEY
  process.env.PAYLOAD_SECRET ||= 'test-payload-secret-not-for-production-use'
  process.env.JWT_SECRET ||= 'test-jwt-secret-not-for-production-use-0123456789'
  process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

  const { getPayload } = await import('payload')
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  await applyMigrations(payload)
  return payload
}

export async function execute<T = Record<string, unknown>>(payload: Payload, statement: SQLQuery): Promise<T[]> {
  const db = payload.db as unknown as { drizzle: { execute: (q: SQLQuery) => Promise<{ rows: T[] }> } }
  return (await db.drizzle.execute(statement)).rows
}

/** Runs pending migrations the way scripts/migrate-fallback.ts does on the Coolify runner. */
async function applyMigrations(payload: Payload): Promise<void> {
  const { migrations } = await import('../payload-migrations/index.js')
  const db = (payload.db as unknown as { drizzle: unknown }).drizzle
  const [table] = await execute<{ t: string | null }>(payload, sql`SELECT to_regclass('public.payload_migrations') AS t`)
  const applied = new Set(
    table?.t ? (await execute<{ name: string }>(payload, sql`SELECT name FROM payload_migrations WHERE batch > 0`)).map((row) => row.name) : [],
  )
  for (const migration of migrations as Migration[]) {
    if (applied.has(migration.name)) continue
    await migration.up({ db, payload, req: {} })
    await execute(payload, sql`INSERT INTO payload_migrations (name, batch, updated_at, created_at) VALUES (${migration.name}, 1, now(), now())`)
  }
}

/** Empties the given tables (and anything that references them) and restarts their ids. */
export async function truncate(payload: Payload, tables: readonly string[]): Promise<void> {
  if (!tables.length) return
  const list = tables.map((name) => `"${name.replace(/"/g, '')}"`).join(', ')
  await execute(payload, sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`))
}

let userSeq = 0

/** A user for tests (no welcome email). */
export async function createTestUser(
  payload: Payload,
  data: { role?: 'admin' | 'instructor' | 'student'; email?: string; password?: string; firstName?: string } = {},
): Promise<{ id: number; email: string; password: string }> {
  userSeq += 1
  const email = data.email ?? `user${Date.now()}${userSeq}@example.test`
  const password = data.password ?? 'Test-password-1!'
  const user = await payload.create({
    collection: 'users',
    data: { email, password, firstName: data.firstName ?? 'Test', lastName: 'User', role: data.role ?? 'student' },
    overrideAccess: true,
    context: { skipWelcomeEmail: true },
  })
  return { id: Number(user.id), email, password }
}
