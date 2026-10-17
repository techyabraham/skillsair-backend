import type { Kind, LogEntry, PersonSnapshot, PlannerConfig, Stage, WindowState } from './types.js'
import { SEQUENCES, WINDOW_ANCHORS, dueTime, scheduledSteps, stepById, type Step, type StepContext } from './sequences.js'
import { computeStages, isLearning, pickActiveTrack } from './stage.js'
import { DAY, HOUR, inQuietHours, isSundayInLagos, lagosDayNumber } from './timing.js'

/**
 * The planner: given one person's snapshot, their message log and the time, decides what to
 * send now, what to skip for good (logged with a reason) and what to try again later
 * (quiet hours, caps). Pure, so the rules can be tested without a database or a clock.
 *
 * Rules (brief sections 4 and 7):
 * - Transactional steps always go. Marketing and service steps only from the active track.
 * - No selling while someone has an unfinished programme they can study (except finishing a
 *   checkout they started).
 * - Marketing email: at most 1 a day (Lagos) and 3 in 7 days. Marketing WhatsApp: 1 in 7 days,
 *   and at most 3 per scholarship window for leads.
 * - Marketing and service only 8am–8pm Lagos time; no marketing on Sundays.
 * - One marketing and one service send per person per run; closing-window emails go first.
 * - 90 days without engagement: one re-permission email (X1), then sunset after 14 more days.
 */

export interface PlannedStep {
  step: Step
  stage: Stage
  /** "A3", or "R5#2" for the 3rd repeat, or "A3-WA" for a WhatsApp follow-up. */
  stepId: string
  kind: Kind
  channel: 'email' | 'whatsapp'
  template: string
  idempotencyKey: string
  dueAt: number
}

export type PlannedAction =
  | ({ type: 'send' } & PlannedStep)
  | ({ type: 'skip'; reason: string } & PlannedStep)
  | { type: 'sunset'; reason: string }

export interface Plan {
  stages: Stage[]
  active: Stage | null
  actions: PlannedAction[]
  deferred: Array<{ idempotencyKey: string; reason: string }>
}

export type Flags = StepContext['flags']

export const SUNSET_AFTER_MS = 90 * DAY
export const REPERMISSION_GRACE_MS = 14 * DAY
const MARKETING_TRACKS = new Set(['A', 'Apost', 'B', 'R', 'C', 'G'])

export function idempotencyKey(track: string, stepId: string, subjectId: string, cycle: number): string {
  return `${track}:${stepId}:${subjectId}:${cycle}`
}

function candidatesFor(stage: Stage, window: WindowState, snapshot: PersonSnapshot, log: Map<string, LogEntry>, config: PlannerConfig, flags: Flags) {
  const now = config.now
  const out: Array<PlannedAction> = []
  const base: Omit<StepContext, 'dueAt'> = { stage, window, snapshot, now, graceDays: config.graceDays, flags }
  for (const step of scheduledSteps(stage.track)) {
    const occurrences = step.repeatEveryDays ? step.maxRepeats ?? 1 : 1
    for (let n = 0; n < occurrences; n++) {
      const due = dueTime(step, base, n)
      if (due === null || due > now) break
      const stepId = n ? `${step.id}#${n}` : step.id
      const key = idempotencyKey(stage.track, stepId, stage.subjectId, stage.cycle)
      const planned: PlannedStep = { step, stage, stepId, kind: step.kind, channel: step.channel, template: step.template, idempotencyKey: key, dueAt: due }
      const existing = log.get(key)
      if (existing) {
        // WhatsApp follow-up a day after the email, unless the email already did its job.
        if (step.followUp) {
          const followUpKey = idempotencyKey(stage.track, `${stepId}-WA`, stage.subjectId, stage.cycle)
          const followUpDue = existing.sentAt + step.followUp.afterHours * HOUR
          if (!log.has(followUpKey) && followUpDue <= now) {
            const followUp: PlannedStep = {
              ...planned, stepId: `${stepId}-WA`, kind: step.followUp.kind, channel: 'whatsapp', template: step.followUp.template, idempotencyKey: followUpKey, dueAt: followUpDue,
            }
            const engaged = step.followUp.unless === 'clicked' ? Boolean(existing.clickedAt) : Boolean(existing.openedAt || existing.clickedAt)
            if (engaged) out.push({ type: 'skip', reason: 'email_engaged', ...followUp })
            else if (now - followUpDue > config.staleAfterMs) out.push({ type: 'skip', reason: 'stale', ...followUp })
            else out.push({ type: 'send', ...followUp })
          }
        }
        continue
      }
      // A step whose condition doesn't apply isn't logged; it's simply checked again next run.
      if (step.when && !step.when({ ...base, dueAt: due })) continue
      if (WINDOW_ANCHORS.includes(step.anchor) && due < stage.enteredAt) out.push({ type: 'skip', reason: 'before_entry', ...planned })
      else if (now - due > config.staleAfterMs) out.push({ type: 'skip', reason: 'stale', ...planned })
      else out.push({ type: 'send', ...planned })
    }
  }
  return out
}

interface GateState {
  marketingThisRun: boolean
  serviceThisRun: boolean
}

type Gate = { ok: true } | { skip: string } | { defer: string }

function sentMarketing(log: LogEntry[], channel: 'email' | 'whatsapp', since: number): LogEntry[] {
  return log.filter((entry) => entry.status === 'sent' && entry.kind === 'marketing' && entry.channel === channel && entry.sentAt >= since)
}

export function gate(
  candidate: PlannedStep,
  snapshot: PersonSnapshot,
  context: { active: Stage | null; learning: boolean; log: LogEntry[]; now: number; state: GateState },
): Gate {
  const { now, log } = context
  const email = candidate.channel === 'email'
  if (email && !snapshot.email) return { skip: 'no_email' }
  if (email && snapshot.emailSuppressed) return { skip: 'suppressed' }
  if (!email && !snapshot.phone) return { skip: 'no_phone' }
  if (candidate.kind === 'transactional') return { ok: true }

  const isActive = context.active !== null && context.active.subjectId === candidate.stage.subjectId && context.active.track === candidate.stage.track
  const isRepermission = candidate.stage.track === 'X'
  if (!isActive && !isRepermission) return { defer: 'not_active_track' }

  if (candidate.kind === 'marketing') {
    // Finishing a checkout they started and learning nudges (I2's WhatsApp is marketing to Meta) aren't selling.
    const selling = candidate.stage.track !== 'B' && candidate.stage.track !== 'I' && !isRepermission
    if (context.learning && selling) return { skip: 'learning_no_selling' }
    if (snapshot.sunsetAt !== null) return { skip: 'sunset' }
    if (email ? !snapshot.marketingEmailAllowed : !snapshot.marketingWhatsAppAllowed) return { skip: 'no_consent' }
  } else if (email && !snapshot.learningReminders) {
    return { skip: 'learning_reminders_off' }
  }

  if (inQuietHours(now)) return { defer: 'quiet_hours' }
  if (candidate.kind === 'marketing' && isSundayInLagos(now)) return { defer: 'sunday' }

  if (candidate.kind === 'service') return context.state.serviceThisRun ? { defer: 'one_per_run' } : { ok: true }
  if (context.state.marketingThisRun) return { defer: 'one_per_run' }
  if (email) {
    const today = lagosDayNumber(now)
    if (sentMarketing(log, 'email', now - 2 * DAY).some((entry) => lagosDayNumber(entry.sentAt) === today)) return { defer: 'daily_cap' }
    if (sentMarketing(log, 'email', now - 7 * DAY).length >= 3) return { defer: 'weekly_cap' }
  } else {
    if (sentMarketing(log, 'whatsapp', now - 7 * DAY).length >= 1) return { defer: 'whatsapp_weekly_cap' }
    if (candidate.stage.track === 'A' || candidate.stage.track === 'Apost') {
      const thisWindow = log.filter((entry) => entry.status === 'sent' && entry.kind === 'marketing' && entry.channel === 'whatsapp' && entry.idempotencyKey.endsWith(`:${candidate.stage.cycle}`))
      if (thisWindow.length >= 3) return { skip: 'window_whatsapp_cap' }
    }
  }
  return { ok: true }
}

function repermission(snapshot: PersonSnapshot, active: Stage | null, logByKey: Map<string, LogEntry>, now: number): PlannedAction | null {
  if (!active || !MARKETING_TRACKS.has(active.track) || snapshot.sunsetAt !== null) return null
  const engagedAt = Math.max(snapshot.lastEngagedAt ?? 0, snapshot.createdAt)
  if (now - engagedAt < SUNSET_AFTER_MS) return null
  const step = stepById('X1') as Step
  const stage: Stage = { track: 'X', subjectId: snapshot.key, enteredAt: engagedAt + SUNSET_AFTER_MS, cycle: 0 }
  const key = idempotencyKey('X', 'X1', snapshot.key, 0)
  const sent = logByKey.get(key)
  if (!sent) return { type: 'send', step, stage, stepId: 'X1', kind: 'marketing', channel: 'email', template: 'X1', idempotencyKey: key, dueAt: stage.enteredAt }
  if (sent.status === 'sent' && now - sent.sentAt >= REPERMISSION_GRACE_MS && (snapshot.lastEngagedAt ?? 0) < sent.sentAt) {
    return { type: 'sunset', reason: 'no_engagement_after_repermission' }
  }
  if (sent.status === 'skipped' && now - sent.sentAt >= REPERMISSION_GRACE_MS) return { type: 'sunset', reason: 'no_engagement_90_days' }
  return null
}

export function planPerson(snapshot: PersonSnapshot, window: WindowState, log: LogEntry[], config: PlannerConfig, flagsFor: (stage: Stage) => Flags = () => ({})): Plan {
  const stages = computeStages(snapshot, window, config.now, config.graceDays)
  const active = pickActiveTrack(stages)
  const learning = isLearning(stages)
  const logByKey = new Map(log.map((entry) => [entry.idempotencyKey, entry]))

  const raw: PlannedAction[] = stages.flatMap((stage) => candidatesFor(stage, window, snapshot, logByKey, config, flagsFor(stage)))
  const x = repermission(snapshot, active, logByKey, config.now)
  if (x) raw.push(x)

  const order = (action: PlannedAction): [number, number] => {
    if (action.type === 'sunset') return [3, 0]
    const priority = action.kind === 'transactional' ? 0 : action.step.priority === 'high' || action.stage.track === 'X' ? 1 : 2
    return [priority, action.dueAt]
  }
  raw.sort((a, b) => {
    const [pa, da] = order(a)
    const [pb, db] = order(b)
    return pa - pb || da - db
  })

  const state: GateState = { marketingThisRun: false, serviceThisRun: false }
  const actions: PlannedAction[] = []
  const deferred: Plan['deferred'] = []
  for (const action of raw) {
    if (action.type !== 'send') {
      actions.push(action)
      continue
    }
    const verdict = gate(action, snapshot, { active, learning, log, now: config.now, state })
    if ('defer' in verdict) deferred.push({ idempotencyKey: action.idempotencyKey, reason: verdict.defer })
    else if ('skip' in verdict) actions.push({ ...action, type: 'skip', reason: verdict.skip })
    else {
      actions.push(action)
      if (action.kind === 'marketing') state.marketingThisRun = true
      if (action.kind === 'service') state.serviceThisRun = true
    }
  }
  return { stages, active, actions, deferred }
}

/** For tests and the admin view: every step id the engine can send. */
export const ALL_STEP_IDS = SEQUENCES.map((step) => step.id)
