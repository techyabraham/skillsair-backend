/**
 * Exports a CSV audience from the SkillsAir users collection. This reads data
 * only; it does not send email. Consent is included so the sending platform can
 * apply its own suppression and campaign rules.
 *
 * Usage:
 *   node --loader ts-node/esm src/migrations/export-communications.ts <output.csv> --segment=all|students --consent=opted_in|opted_out|unknown|all [--include-inactive] [--force]
 */
import { writeFileSync } from 'node:fs'
import { loadEnv } from 'payload/node'
import { getPayload, type Where } from 'payload'

type Segment = 'all' | 'students'
type Consent = 'opted_in' | 'opted_out' | 'unknown' | 'all'

interface UserExport {
  email?: string
  firstName?: string
  lastName?: string
  isStudent?: boolean
  isActive?: boolean
  wordpressRoles?: { role?: string }[]
  marketingConsent?: string
  marketingConsentAt?: string
  marketingConsentSource?: string
}

const HEADERS = [
  'email',
  'first_name',
  'last_name',
  'is_student',
  'is_active',
  'wordpress_roles',
  'marketing_consent',
  'marketing_consent_at',
  'marketing_consent_source',
]

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

async function run(): Promise<void> {
  const outputPath = process.argv[2]
  const segment = flagValue('segment') as Segment | undefined
  const consent = flagValue('consent') as Consent | undefined
  const force = process.argv.includes('--force')
  const includeInactive = process.argv.includes('--include-inactive')

  if (!outputPath || !segment || !consent || !['all', 'students'].includes(segment) || !['opted_in', 'opted_out', 'unknown', 'all'].includes(consent)) {
    console.error('Usage: export-communications.ts <output.csv> --segment=all|students --consent=opted_in|opted_out|unknown|all [--include-inactive] [--force]')
    process.exitCode = 1
    return
  }

  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })

  const filters: Where[] = []
  if (!includeInactive) filters.push({ isActive: { equals: true } })
  if (segment === 'students') filters.push({ isStudent: { equals: true } })
  if (consent !== 'all') filters.push({ marketingConsent: { equals: consent } })
  const where: Where | undefined = filters.length === 1
    ? filters[0]
    : filters.length > 1
      ? { and: filters }
      : undefined

  const records: string[] = [HEADERS.map(csvCell).join(',')]
  let page = 1
  let total = 0
  let pages = 1

  while (page <= pages) {
    const result = await payload.find({
      collection: 'users',
      ...(where ? { where } : {}),
      limit: 500,
      page,
      depth: 0,
      overrideAccess: true,
    })
    pages = result.totalPages
    total = result.totalDocs

    for (const rawUser of result.docs) {
      const user = rawUser as unknown as UserExport
      records.push([
        user.email,
        user.firstName,
        user.lastName,
        user.isStudent ? 'true' : 'false',
        user.isActive ? 'true' : 'false',
        user.wordpressRoles?.map(({ role }) => role).filter(Boolean).join('|'),
        user.marketingConsent ?? 'unknown',
        user.marketingConsentAt,
        user.marketingConsentSource,
      ].map(csvCell).join(','))
    }
    page += 1
  }

  writeFileSync(outputPath, `${records.join('\n')}\n`, { encoding: 'utf8', flag: force ? 'w' : 'wx' })
  console.log(`Exported ${total} user(s) to ${outputPath}`)
  console.log(`Segment: ${segment}; consent: ${consent}`)
}

run().catch((err: unknown) => {
  console.error('Communications export failed:', err)
  process.exitCode = 1
})
