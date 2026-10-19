/**
 * Lifecycle dry-run report (brief step 4: run in dry-run on real data for 48 hours first).
 *
 * The hourly job records dry-run decisions in `messages` (status skipped, reason dry_run). This
 * prints what would have been sent, per step, plus skips by reason, over the last N hours.
 * Read-only unless --run-now, which runs the engine once in dry-run (nothing is sent).
 *
 * Usage:
 *   npm run lifecycle:dry-run                 # last 48 hours
 *   npm run lifecycle:dry-run -- --hours 24
 *   npm run lifecycle:dry-run -- --run-now    # run the engine once (forced dry-run), then report
 */
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'

const arg = (name: string) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

await loadEnv()
if (process.argv.includes('--run-now')) process.env.LIFECYCLE_DRY_RUN = 'true'
const { default: config } = await import('../payload.config.js')
const payload = await getPayload({ config })

if (process.argv.includes('--run-now')) {
  const { runLifecycle } = await import('../src/lib/lifecycle/engine.js')
  const summary = await runLifecycle(payload)
  console.log(`Ran the engine once (dry-run): ${summary.people} people, ${summary.skipped} recorded, ${summary.deferred} deferred.`)
  console.log('Deferred by reason:', summary.deferredReasons)
}

const hours = Number(arg('--hours') ?? 48)
const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
const wouldSend = new Map<string, { email: number; whatsapp: number; people: Set<string> }>()
const skipped = new Map<string, number>()
let page = 1
for (;;) {
  const result = await payload.find({ collection: 'messages', where: { sentAt: { greater_than: since } }, limit: 500, page, depth: 0, overrideAccess: true })
  for (const doc of result.docs as unknown as Array<{ stepId: string; channel: 'email' | 'whatsapp'; status: string; skipReason?: string | null; personKey: string }>) {
    const step = doc.stepId.replace(/#\d+$/, '')
    if (doc.status === 'skipped' && doc.skipReason === 'dry_run') {
      const row = wouldSend.get(step) ?? { email: 0, whatsapp: 0, people: new Set<string>() }
      row[doc.channel]++
      row.people.add(doc.personKey)
      wouldSend.set(step, row)
    } else if (doc.status === 'skipped') {
      skipped.set(`${step}: ${doc.skipReason ?? 'unknown'}`, (skipped.get(`${step}: ${doc.skipReason ?? 'unknown'}`) ?? 0) + 1)
    }
  }
  if (!result.hasNextPage) break
  page++
}

console.log(`\nWould have sent (last ${hours} hours):`)
if (!wouldSend.size) console.log('- nothing')
for (const [step, row] of [...wouldSend.entries()].sort()) {
  console.log(`- ${step}: ${row.email} email, ${row.whatsapp} WhatsApp, to ${row.people.size} people`)
}
console.log('\nSkipped, by reason:')
if (!skipped.size) console.log('- nothing')
for (const [key, count] of [...skipped.entries()].sort()) console.log(`- ${key}: ${count}`)
process.exit(0)
