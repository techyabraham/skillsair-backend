/**
 * Imports students from a WordPress/TutorLMS CSV export into the `users` collection.
 *
 * Expected CSV columns: email, first_name, last_name, phone (optional), role (optional).
 * Migrated users get a random password (their WordPress hash can't be reused) and are
 * expected to use the forgot-password flow to set their own.
 *
 * Usage:
 *   node --loader ts-node/esm src/migrations/import-users.ts <csv-path> [--execute]
 *
 * Without --execute, runs as a dry run: prints what would happen, writes nothing.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'

import { generateSecureToken } from '../utils/generate-code.js'
import { sanitizeText, isValidE164Phone } from '../utils/sanitize.js'

interface UserCsvRow {
  email: string
  first_name: string
  last_name: string
  phone?: string
  role?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_ROLES = new Set(['admin', 'instructor', 'student'])

interface Summary {
  total: number
  created: number
  skipped: number
  failed: number
}

async function run(): Promise<void> {
  const csvPath = process.argv[2]
  const execute = process.argv.includes('--execute')

  if (!csvPath) {
    console.error('Usage: import-users.ts <csv-path> [--execute]')
    process.exitCode = 1
    return
  }

  const rows = parse(readFileSync(csvPath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as UserCsvRow[]

  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })

  const summary: Summary = { total: rows.length, created: 0, skipped: 0, failed: 0 }

  for (const row of rows) {
    const email = row.email?.trim().toLowerCase()
    try {
      if (!email || !EMAIL_PATTERN.test(email)) {
        throw new Error(`invalid email: "${row.email ?? ''}"`)
      }
      const firstName = sanitizeText(row.first_name) || 'Student'
      const lastName = sanitizeText(row.last_name) || ''
      const phone = row.phone?.trim()
      if (phone && !isValidE164Phone(phone)) {
        throw new Error(`invalid phone for ${email}: "${phone}"`)
      }
      const role = row.role?.trim().toLowerCase()
      if (role && !VALID_ROLES.has(role)) {
        throw new Error(`invalid role for ${email}: "${role}"`)
      }

      const existing = await payload.find({
        collection: 'users',
        where: { email: { equals: email } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      if (existing.totalDocs > 0) {
        console.log(`SKIP  ${email} (already exists)`)
        summary.skipped += 1
        continue
      }

      if (!execute) {
        console.log(`WOULD CREATE  ${email} (${firstName} ${lastName})`)
        summary.created += 1
        continue
      }

      await payload.create({
        collection: 'users',
        data: {
          email,
          password: generateSecureToken(),
          firstName,
          lastName,
          ...(phone ? { phone } : {}),
          role: (role as 'admin' | 'instructor' | 'student' | undefined) ?? 'student',
          isVerified: true,
          isActive: true,
        },
        overrideAccess: true,
      })
      console.log(`CREATED  ${email}`)
      summary.created += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`FAILED  ${email ?? row.email ?? '(no email)'}: ${message}`)
      summary.failed += 1
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`)
  console.log(`Total rows: ${summary.total}`)
  console.log(`Created: ${summary.created}`)
  console.log(`Skipped (existing): ${summary.skipped}`)
  console.log(`Failed: ${summary.failed}`)
}

run().catch((err: unknown) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
