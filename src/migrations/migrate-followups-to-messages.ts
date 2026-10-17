/**
 * One-off: copies each lead's old follow-up history (`leads.followUpsSent`) into the lifecycle
 * `messages` log, under the keys the engine uses, so nothing that already went out is sent
 * again. The old field stays (read-only) for history. Safe to re-run: existing keys are kept.
 * Dry run by default.
 *
 * Usage:
 *   npm run migrate:followups [-- --execute]
 */
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'
import type { LeadDoc } from '../lib/leads.js'

interface Mapping {
  stepId: string
  template: string
  channel: 'email' | 'whatsapp'
  kind: 'transactional' | 'marketing'
}

/** Old key → lifecycle step. Keys ending ":<window ISO date>" belong to that window. */
const MAP: Record<string, Mapping> = {
  email_offer: { stepId: 'A0', template: 'A0', channel: 'email', kind: 'transactional' },
  wa_offer_ready: { stepId: 'A0-WA', template: 'skillsair_offer_ready', channel: 'whatsapp', kind: 'transactional' },
  wa_curriculum: { stepId: 'A0-curriculum-WA', template: 'skillsair_curriculum', channel: 'whatsapp', kind: 'transactional' },
  email_b: { stepId: 'A1', template: 'A1', channel: 'email', kind: 'marketing' },
  email_c: { stepId: 'A3', template: 'A3', channel: 'email', kind: 'marketing' },
  email_d: { stepId: 'A6', template: 'A6', channel: 'email', kind: 'marketing' },
  'wa_mkt:offer_reminder': { stepId: 'A3-WA', template: 'skillsair_offer_reminder', channel: 'whatsapp', kind: 'marketing' },
  'wa_mkt:window_closing': { stepId: 'A6-WA', template: 'skillsair_window_closing', channel: 'whatsapp', kind: 'marketing' },
  'wa_mkt:window_open': { stepId: 'W1-WA', template: 'skillsair_window_open', channel: 'whatsapp', kind: 'marketing' },
}

function parseKey(key: string): { mapping: Mapping; windowIso: string | null } | null {
  if (MAP[key]) return { mapping: MAP[key], windowIso: null }
  const index = key.lastIndexOf(':')
  if (index <= 0) return null
  // Window keys are ISO dates, which contain ':' too; match the known prefixes instead.
  for (const prefix of Object.keys(MAP)) {
    if (key.startsWith(`${prefix}:`)) return { mapping: MAP[prefix] as Mapping, windowIso: key.slice(prefix.length + 1) }
  }
  return null
}

async function run(): Promise<void> {
  const execute = process.argv.includes('--execute')
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  const { loadPerson, loadWindow } = await import('../lib/lifecycle/context.js')
  const { recordMessage } = await import('../lib/lifecycle/send.js')
  const { idempotencyKey } = await import('../lib/lifecycle/plan.js')
  const { windowCycle } = await import('../lib/lifecycle/stage.js')

  const window = await loadWindow(payload)
  const currentCycle = windowCycle(window.closesAt)
  let leads = 0
  let rows = 0
  let ignored = 0
  let page = 1
  for (;;) {
    const result = await payload.find({ collection: 'leads', limit: 200, page, depth: 0, overrideAccess: true })
    for (const lead of result.docs as unknown as LeadDoc[]) {
      const items = lead.followUpsSent ?? []
      if (!items.length) continue
      leads++
      const person = await loadPerson(payload, { type: 'lead', id: lead.id })
      if (!person) continue
      for (const item of items) {
        const parsed = parseKey(item.key)
        if (!parsed) {
          ignored++ // scoring markers (score_*) aren't messages
          continue
        }
        const cycle = parsed.windowIso ? windowCycle(Date.parse(parsed.windowIso)) : currentCycle
        const key = idempotencyKey('A', parsed.mapping.stepId, `lead:${lead.id}`, cycle)
        rows++
        if (execute) {
          await recordMessage(payload, {
            person, channel: parsed.mapping.channel, kind: parsed.mapping.kind, track: 'A', stepId: parsed.mapping.stepId,
            template: parsed.mapping.template, subjectId: `lead:${lead.id}`, cycle, idempotencyKey: key, status: 'sent', sentAt: item.sentAt,
          })
        } else {
          console.log(`- lead ${lead.id}: ${item.key} -> ${key}`)
        }
      }
    }
    if (!result.hasNextPage) break
    page++
  }
  console.log(`${execute ? 'Copied' : 'Would copy'} ${rows} messages from ${leads} leads (${ignored} scoring markers left as they are).`)
  if (!execute) console.log('DRY RUN: nothing written. Re-run with --execute to apply.')
  process.exit(0)
}

void run()
