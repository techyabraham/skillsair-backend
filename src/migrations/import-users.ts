/**
 * Imports the full WordPress user directory into Payload's `users` collection.
 *
 * Expected columns: email, first_name, last_name. Optional columns:
 * wp_user_id, phone, wp_roles, is_student, is_active, marketing_consent,
 * marketing_consent_at, marketing_consent_source.
 *
 * WordPress roles are retained as source metadata. They never grant a SkillsAir
 * admin or instructor role. Imported accounts get a random password and should
 * use the password-reset flow. `is_student` is an audience flag, independent of
 * the backend role; enrollment imports also mark linked users as students.
 *
 * Usage:
 *   node --loader ts-node/esm src/migrations/import-users.ts <csv-path> [--execute]
 *
 * Without --execute this is a dry run.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'

import { generateSecureToken } from '../utils/generate-code.js'
import { sanitizeText, isValidE164Phone } from '../utils/sanitize.js'

interface UserCsvRow {
  email?: string
  user_email?: string
  first_name?: string
  firstName?: string
  display_name?: string
  last_name?: string
  lastName?: string
  wp_user_id?: string
  id?: string
  phone?: string
  wp_roles?: string
  roles?: string
  role?: string
  is_student?: string
  isStudent?: string
  is_active?: string
  marketing_consent?: string
  marketing_consent_at?: string
  marketing_consent_source?: string
}

type Consent = 'unknown' | 'opted_in' | 'opted_out'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TRUE_VALUES = new Set(['true', '1', 'yes', 'y'])
const FALSE_VALUES = new Set(['false', '0', 'no', 'n'])

interface Summary {
  total: number
  created: number
  updated: number
  skipped: number
  failed: number
  warnings: number
}

function parseBoolean(value: string | undefined, field: string): boolean | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const normalized = value.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  throw new Error(`invalid ${field}: "${value}" (use true/false, yes/no, or 1/0)`)
}

function parseConsent(value: string | undefined): Consent | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const normalized = value.trim().toLowerCase()
  if (['opted_in', 'subscribed', 'consented', 'granted', 'yes', 'true', '1'].includes(normalized)) {
    return 'opted_in'
  }
  if (['opted_out', 'unsubscribed', 'withdrawn', 'denied', 'no', 'false', '0'].includes(normalized)) {
    return 'opted_out'
  }
  if (normalized === 'unknown') return 'unknown'
  throw new Error(`invalid marketing_consent: "${value}"`)
}

function parseWordPressRoles(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === '') return undefined
  return [...new Set(value.split(/[|,;]/).map((role) => sanitizeText(role)).filter(Boolean))]
}

function optionalDate(value: string | undefined, field: string): string | undefined {
  if (!value?.trim()) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid ${field}: "${value}"`)
  return parsed.toISOString()
}

function sourceRolesData(roles: string[] | undefined): { role: string }[] | undefined {
  return roles?.map((role) => ({ role }))
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
  const summary: Summary = { total: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, warnings: 0 }
  const seenEmails = new Set<string>()
  const seenWordPressIds = new Set<string>()

  for (const [index, row] of rows.entries()) {
    const rowLabel = `row ${index + 2}`
    const email = (row.email ?? row.user_email ?? '').trim().toLowerCase()
    try {
      if (!email || !EMAIL_PATTERN.test(email)) {
        throw new Error(`invalid email: "${email}"`)
      }
      if (seenEmails.has(email)) throw new Error(`duplicate email in export: ${email}`)
      seenEmails.add(email)

      const wordpressUserId = (row.wp_user_id ?? row.id)?.trim()
      if (wordpressUserId) {
        if (seenWordPressIds.has(wordpressUserId)) {
          throw new Error(`duplicate WordPress user ID in export: ${wordpressUserId}`)
        }
        seenWordPressIds.add(wordpressUserId)
      }

      const firstName = (sanitizeText(row.first_name ?? row.firstName ?? '')
        || sanitizeText(row.display_name ?? '')
        || email.split('@')[0]
        || 'User').slice(0, 100)
      const lastName = (sanitizeText(row.last_name ?? row.lastName ?? '') || 'Unknown').slice(0, 100)
      let phone = row.phone?.trim()
      if (phone && !isValidE164Phone(phone)) {
        console.warn(`WARNING  ${rowLabel} ${email}: invalid phone omitted (normalize to E.164 before importing if it must be retained)`)
        phone = undefined
        summary.warnings += 1
      }

      const roles = parseWordPressRoles(row.wp_roles ?? row.roles ?? row.role)
      const isStudent = parseBoolean(row.is_student ?? row.isStudent, 'is_student')
      const isActive = parseBoolean(row.is_active, 'is_active')
      const marketingConsent = parseConsent(row.marketing_consent)
      const marketingConsentAt = optionalDate(row.marketing_consent_at, 'marketing_consent_at')
      if (marketingConsentAt && !marketingConsent) {
        throw new Error('marketing_consent_at requires an explicit marketing_consent value')
      }
      const marketingConsentSource = row.marketing_consent_source?.trim()

      const existingRecords = await payload.find({
        collection: 'users',
        where: wordpressUserId
          ? { or: [{ email: { equals: email } }, { wordpressUserId: { equals: wordpressUserId } }] }
          : { email: { equals: email } },
        limit: wordpressUserId ? 2 : 1,
        depth: 0,
        overrideAccess: true,
      })
      const existingByEmail = existingRecords.docs.find(
        (doc) => String(doc.email).toLowerCase() === email,
      )
      const existingBySourceId = wordpressUserId
        ? existingRecords.docs.find(
          (doc) => String((doc as { wordpressUserId?: string }).wordpressUserId ?? '') === wordpressUserId,
        )
        : undefined
      if (existingBySourceId && existingByEmail && String(existingBySourceId.id) !== String(existingByEmail.id)) {
        throw new Error(`WordPress user ID ${wordpressUserId} and email ${email} belong to different existing accounts`)
      }
      if (existingBySourceId && String(existingBySourceId.email).toLowerCase() !== email) {
        throw new Error(`WordPress user ID ${wordpressUserId} is already linked to a different email; reconcile it manually`)
      }
      const existing = existingBySourceId ?? existingByEmail

      if (existing) {
        const existingWordPressId = (existing as { wordpressUserId?: string }).wordpressUserId
        const existingConsent = (existing as { marketingConsent?: Consent }).marketingConsent ?? 'unknown'
        const canSetConsent = marketingConsent !== undefined
          && marketingConsent !== 'unknown'
          && existingConsent === 'unknown'
        if (wordpressUserId && existingWordPressId && existingWordPressId !== wordpressUserId) {
          throw new Error(`email ${email} is already linked to WordPress user ID ${existingWordPressId}`)
        }

        const updateData = {
          ...(wordpressUserId && !existingWordPressId ? { wordpressUserId } : {}),
          ...(roles ? { wordpressRoles: sourceRolesData(roles) } : {}),
          ...(isStudent !== undefined
            ? { isStudent: isStudent || Boolean((existing as { isStudent?: boolean }).isStudent) }
            : {}),
          ...(isActive !== undefined ? { isActive } : {}),
          ...(canSetConsent ? { marketingConsent } : {}),
          ...(canSetConsent && marketingConsentAt ? { marketingConsentAt } : {}),
          ...(canSetConsent && marketingConsentSource ? { marketingConsentSource } : {}),
        }
        if (Object.keys(updateData).length === 0) {
          console.log(`SKIP  ${email} (already exists; no migration metadata supplied)`)
          summary.skipped += 1
          continue
        }

        if (!execute) {
          console.log(`WOULD UPDATE  ${email} (migration metadata only)`)
          summary.updated += 1
          continue
        }

        await payload.update({
          collection: 'users',
          id: existing.id,
          data: updateData,
          overrideAccess: true,
        })
        console.log(`UPDATED  ${email}`)
        summary.updated += 1
        continue
      }

      if (!execute) {
        console.log(`WOULD CREATE  ${email} (${firstName} ${lastName})${isStudent ? ' [student]' : ''}`)
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
          role: 'student',
          isVerified: true,
          isActive: isActive ?? true,
          isStudent: isStudent ?? false,
          ...(wordpressUserId ? { wordpressUserId } : {}),
          ...(roles ? { wordpressRoles: sourceRolesData(roles) } : {}),
          marketingConsent: marketingConsent ?? 'unknown',
          ...(marketingConsentAt ? { marketingConsentAt } : {}),
          ...(marketingConsentSource ? { marketingConsentSource } : {}),
        },
        context: { skipWelcomeEmail: true },
        overrideAccess: true,
      })
      console.log(`CREATED  ${email}`)
      summary.created += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`FAILED  ${rowLabel} ${email || '(no email)'}: ${message}`)
      summary.failed += 1
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`)
  console.log(`Total rows: ${summary.total}`)
  console.log(`Created: ${summary.created}`)
  console.log(`Updated (metadata only): ${summary.updated}`)
  console.log(`Skipped (no migration data): ${summary.skipped}`)
  console.log(`Failed: ${summary.failed}`)
  console.log(`Warnings (optional phone omitted): ${summary.warnings}`)

  await payload.destroy()
}

run().catch((err: unknown) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
