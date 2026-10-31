import type { Payload } from 'payload'
import { logger } from '../logger.js'
import { relationId } from '../leads.js'
import { accessGraceDays } from '../billing.js'
import { loadLog, loadPerson, loadWindow, type LoadedPerson, type PersonRef } from './context.js'
import { planPerson, type PlannedAction } from './plan.js'
import { executeStep, isLive, type SendOutcome } from './send.js'
import { isDryRun } from './live.js'
import { COMPLETION_LOOKBACK_MS } from './stage.js'
import { DAY } from './timing.js'
import type { LogEntry, WindowState } from './types.js'

/**
 * runLifecycle: the hourly job. For everyone with an open stage, plans and executes the next
 * due steps (planner rules in plan.ts). Marketing volume per run is capped
 * (LIFECYCLE_MAX_MARKETING_PER_RUN, default 500) so a window opening for thousands of waitlist
 * leads goes out in batches.
 */
export interface LifecycleSummary {
  people: number
  sent: number
  skipped: number
  failed: number
  deferred: number
  sunset: number
  dryRun: boolean
  byStep: Record<string, Partial<Record<SendOutcome | 'sunset', number>>>
  deferredReasons: Record<string, number>
}

const STALE_AFTER_MS = 3 * DAY

function maxMarketingPerRun(): number {
  const value = Number(process.env.LIFECYCLE_MAX_MARKETING_PER_RUN ?? 500)
  return Number.isFinite(value) && value > 0 ? value : 500
}

/** Everyone who could be in a stage now. A lead with an account is handled as the user. */
export async function enumeratePeople(payload: Payload, now = Date.now()): Promise<PersonRef[]> {
  const refs = new Map<string, PersonRef>()
  const addUser = (id: unknown) => {
    const userId = Number(relationId(id))
    if (userId) refs.set(`user:${userId}`, { type: 'user', id: userId })
  }
  const all = async (collection: 'leads' | 'subscriptions' | 'orders' | 'enrollments' | 'certificates', where: Record<string, unknown>, each: (doc: Record<string, unknown>) => void) => {
    let page = 1
    for (;;) {
      const result = await payload.find({ collection, where: where as never, limit: 500, page, depth: 0, overrideAccess: true })
      for (const doc of result.docs) each(doc as unknown as Record<string, unknown>)
      if (!result.hasNextPage) break
      page++
    }
  }
  const since = (ms: number) => new Date(now - ms).toISOString()
  await all('leads', { status: { in: ['new', 'contacted', 'offer_viewed', 'account_created'] } }, (lead) => {
    const userId = relationId(lead.user)
    if (userId) addUser(userId)
    else refs.set(`lead:${lead.id}`, { type: 'lead', id: Number(lead.id) })
  })
  await all('subscriptions', {}, (subscription) => addUser(subscription.user))
  await all('orders', { and: [{ status: { equals: 'pending' } }, { createdAt: { greater_than: since(7 * DAY) } }] }, (order) => addUser(order.user))
  await all('enrollments', { and: [{ status: { equals: 'completed' } }, { completedAt: { greater_than: since(COMPLETION_LOOKBACK_MS) } }] }, (enrollment) => addUser(enrollment.student))
  await all('certificates', { createdAt: { greater_than: since(COMPLETION_LOOKBACK_MS) } }, (certificate) => addUser(certificate.student))
  return [...refs.values()]
}

/**
 * Dry-run rows stop a step repeating while its track is in dry-run; once live, they're ignored.
 * no_consent rows never block a step: people are on the list by default now, and anyone who has
 * opted out is stopped again by the planner.
 */
function effectiveLog(log: LogEntry[]): LogEntry[] {
  return log.filter((entry) => !(entry.skipReason === 'dry_run' && isLive(entry.track)) && entry.skipReason !== 'no_consent')
}

async function contentFlags(): Promise<{ freeExercise?: boolean; laptopDeadlineSoon?: boolean }> {
  // Per-school free exercises and the laptop-application deadline arrive with the step 5 content.
  return {}
}

async function sunset(payload: Payload, person: LoadedPerson, now: number): Promise<void> {
  const at = new Date(now).toISOString()
  if (person.user) await payload.update({ collection: 'users', id: person.user.id, data: { lifecycle: { sunsetAt: at } }, depth: 0, overrideAccess: true })
  else if (person.lead) await payload.update({ collection: 'leads', id: person.lead.id, data: { sunsetAt: at }, depth: 0, overrideAccess: true })
  logger.info({ person: person.snapshot.key }, 'lifecycle_sunset')
}

export async function processPerson(
  payload: Payload,
  ref: PersonRef,
  window: WindowState,
  now: number,
  summary: LifecycleSummary,
  budget: { marketing: number },
): Promise<void> {
  const person = await loadPerson(payload, ref)
  if (!person) return
  const log = effectiveLog(await loadLog(payload, person.snapshot.key))
  const flags = await contentFlags()
  const plan = planPerson(person.snapshot, window, log, { now, graceDays: accessGraceDays(), staleAfterMs: STALE_AFTER_MS }, () => flags)
  summary.people++
  for (const deferred of plan.deferred) summary.deferredReasons[deferred.reason] = (summary.deferredReasons[deferred.reason] ?? 0) + 1
  summary.deferred += plan.deferred.length

  for (const action of plan.actions as PlannedAction[]) {
    if (action.type === 'sunset') {
      await sunset(payload, person, now)
      summary.sunset++
      continue
    }
    if (action.type === 'send' && action.kind === 'marketing' && isLive(action.stage.track) && budget.marketing <= 0) {
      summary.deferred++
      summary.deferredReasons.batch_limit = (summary.deferredReasons.batch_limit ?? 0) + 1
      continue
    }
    const outcome = await executeStep(payload, person, action, window, action.type === 'skip' ? action.reason : undefined)
    if (outcome === 'sent' && action.kind === 'marketing') budget.marketing--
    summary[outcome === 'sent' ? 'sent' : outcome === 'skipped' ? 'skipped' : outcome === 'failed' ? 'failed' : 'deferred']++
    const stats = (summary.byStep[action.stepId.replace(/#\d+$/, '')] ??= {})
    stats[outcome] = (stats[outcome] ?? 0) + 1
  }
}

export async function runLifecycle(payload: Payload, now = Date.now(), refs?: PersonRef[]): Promise<LifecycleSummary> {
  const summary: LifecycleSummary = {
    people: 0, sent: 0, skipped: 0, failed: 0, deferred: 0, sunset: 0,
    dryRun: isDryRun(), byStep: {}, deferredReasons: {},
  }
  const window = await loadWindow(payload, now)
  const people = refs ?? (await enumeratePeople(payload, now))
  const budget = { marketing: maxMarketingPerRun() }
  for (const ref of people) {
    try {
      await processPerson(payload, ref, window, now, summary, budget)
    } catch (err) {
      logger.error({ err, ref }, 'lifecycle_person_failed')
    }
  }
  logger.info({ ...summary }, 'lifecycle_run')
  return summary
}
