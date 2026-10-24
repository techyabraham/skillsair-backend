/**
 * Fallback for `payload migrate` when it exits without applying anything (seen on the Coolify
 * migration runner). Runs each pending migration's own up() from src/payload-migrations directly
 * against Postgres, without loading the Payload config, then records it in payload_migrations
 * exactly as Payload does, so `npm run migrate:status` shows it as run and Payload never repeats it.
 *
 * Everything happens in ONE transaction: if any migration fails, nothing is changed.
 *
 * Usage (on the migration runner, after a database backup):
 *   npm run migrate:fallback -- --test     apply everything pending, report, then roll back (changes nothing)
 *   npm run migrate:fallback               apply everything pending and commit
 *   npm run migrate:fallback -- --only 20261023   limit to migrations whose name starts with this
 *
 * Uses DATABASE_URI (the direct connection, never PgBouncer: migrations need one session).
 */
import pg from 'pg'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { migrations } from '../src/payload-migrations/index.js'

interface Migration {
  name: string
  up: (args: { db: unknown; payload: unknown; req: unknown }) => Promise<void>
}

const args = process.argv.slice(2)
const testOnly = args.includes('--test')
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? args[onlyIndex + 1] ?? '' : ''

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URI
  if (!connectionString) {
    console.error('DATABASE_URI is not set.')
    process.exit(1)
  }
  const client = new pg.Client({ connectionString })
  await client.connect()
  const dialect = new PgDialect()

  // The same shape the migrations use: db.execute(sql`...`) returning { rows }.
  const db = {
    execute: async (query: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(query)
      const result = params.length ? await client.query(text, params) : await client.query(text)
      // A multi-statement query returns one result per statement; the last one carries the rows.
      const last = Array.isArray(result) ? result[result.length - 1] : result
      return { rows: last?.rows ?? [], rowCount: last?.rowCount ?? 0 }
    },
  }
  const log = (level: string) => (value: unknown) => console.log(`[${level}]`, typeof value === 'string' ? value : JSON.stringify(value))
  const payload = { logger: { info: log('info'), warn: log('warn'), error: log('error'), debug: () => undefined } }

  try {
    // An empty database has no payload_migrations table yet: the first migration creates it.
    const hasTable = Boolean((await client.query<{ t: string | null }>(`SELECT to_regclass('public.payload_migrations') AS t`)).rows[0]?.t)
    const applied = new Set(hasTable ? (await client.query<{ name: string }>('SELECT name FROM payload_migrations WHERE batch > 0')).rows.map((row) => row.name) : [])
    const pending = (migrations as Migration[]).filter((migration) => !applied.has(migration.name) && (!only || migration.name.startsWith(only)))
    if (!pending.length) {
      console.log(`Nothing to do: every migration${only ? ` starting "${only}"` : ''} is already recorded as run.`)
      return
    }
    console.log(`${testOnly ? 'TEST RUN (rolled back at the end).' : 'APPLYING.'} Pending, in order:\n${pending.map((m) => `  - ${m.name}`).join('\n')}`)

    const batch = hasTable ? Number((await client.query<{ batch: string }>('SELECT COALESCE(MAX(batch), 0) + 1 AS batch FROM payload_migrations WHERE batch > 0')).rows[0]?.batch ?? 1) : 1
    await client.query('BEGIN')
    for (const migration of pending) {
      const started = Date.now()
      await migration.up({ db, payload, req: {} })
      await client.query('INSERT INTO payload_migrations (name, batch, updated_at, created_at) VALUES ($1, $2, now(), now())', [migration.name, batch])
      console.log(`  ✓ ${migration.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
    }
    if (testOnly) {
      await client.query('ROLLBACK')
      console.log('\nAll pending migrations ran without errors. Rolled back: nothing was changed. Run again without --test to apply.')
    } else {
      await client.query('COMMIT')
      console.log(`\nApplied ${pending.length} migration${pending.length === 1 ? '' : 's'} as batch ${batch}. Check with: npm run migrate:status`)
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error(`\nFailed, so nothing was changed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

await main()
