/**
 * Ensures the ten SkillsAir schools exist as `categories`, with the exact names the owner
 * supplied. Existing categories (matched by name, ignoring case and spacing) are left as
 * they are. Dry run by default; nothing is written without --execute.
 *
 * Usage:
 *   npm run seed:schools [-- --execute]
 */
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'

export const SCHOOLS: Array<{ name: string; description: string }> = [
  { name: 'School of AI', description: 'Use and build with AI, the skill every industry is now hiring for.' },
  { name: 'School of Content Creation', description: 'Create content brands and audiences pay attention to.' },
  { name: 'School of Data', description: 'Turn raw numbers into decisions companies pay for.' },
  { name: 'School of Design', description: 'Design products and visuals people love to use.' },
  { name: 'School of Engineering', description: 'Build the software that runs modern businesses.' },
  { name: 'School of No-Code Development', description: 'Build real apps and websites without writing code.' },
  { name: 'School of Products', description: 'Learn to lead products from idea to launch.' },
  { name: 'School of Sales and Marketing', description: 'Grow brands and close deals with digital skills.' },
  { name: 'School of Security', description: 'Protect systems and data from attackers.' },
  { name: 'School of Smart Phone', description: 'Turn the phone in your hand into a source of income.' },
]

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '')

async function run(): Promise<void> {
  const execute = process.argv.includes('--execute')
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  const existing = await payload.find({ collection: 'categories', limit: 500, depth: 0, overrideAccess: true })
  const byName = new Map(existing.docs.map((doc) => [normalise(String(doc.name)), doc]))

  for (const school of SCHOOLS) {
    const found = byName.get(normalise(school.name))
    if (found) {
      console.log(`- ${school.name}: exists as "${found.name}" (/${found.slug})`)
      continue
    }
    if (execute) {
      const created = await payload.create({ collection: 'categories', data: { name: school.name, description: school.description }, overrideAccess: true })
      console.log(`- ${school.name}: created (/${created.slug})`)
    } else {
      console.log(`- ${school.name}: would be created`)
    }
  }
  console.log(execute ? 'Done.' : 'DRY RUN: nothing written. Re-run with --execute to create missing schools.')
  process.exit(0)
}

void run()
