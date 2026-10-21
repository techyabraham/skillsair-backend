import type { Channel, Kind, PersonSnapshot, Stage, Track, WindowState } from './types.js'
import { DAY, HOUR, lagosTimeOnDay } from './timing.js'

/**
 * Every lifecycle step and when it goes (brief section 10). All timings live here, so a delay
 * can be changed without touching the engine. Copy lives in src/emails/ (one file per step).
 *
 * anchor:
 * - stage_entered     offsetHours after the person entered the stage
 * - window_closes     offsetHours relative to the scholarship window closing (negative = before)
 * - window_close_day  offsetHours after midnight (Lagos) on the closing day (9 = 9am)
 * - event             sent by events.ts when something happens (payment, completion...)
 */
export type Anchor = 'stage_entered' | 'window_closes' | 'window_close_day' | 'event'

export interface StepContext {
  stage: Stage
  window: WindowState
  snapshot: PersonSnapshot
  now: number
  dueAt: number
  graceDays: number
  /** Content the owner may not have filled in yet (a step that needs it is skipped). */
  flags: { freeExercise?: boolean; laptopDeadlineSoon?: boolean }
}

export interface FollowUp {
  /** WhatsApp template name. */
  template: string
  kind: Kind
  /** Hours after the email was sent (never the same day as the email). */
  afterHours: number
  /** Skip the WhatsApp if the email got a click (or an open). */
  unless: 'clicked' | 'opened'
}

export interface Step {
  id: string
  track: Track
  kind: Kind
  channel: Channel
  /** Email template id in src/emails/, or a WhatsApp template name. */
  template: string
  anchor: Anchor
  offsetHours: number
  repeatEveryDays?: number
  maxRepeats?: number
  /** Closing-window emails win over the rest of the sequence when both are due. */
  priority?: 'high'
  when?: (ctx: StepContext) => boolean
  /** Replaces the computed due time (e.g. "48 hours, or 12 hours before the window closes if sooner"). */
  dueOverride?: (ctx: Omit<StepContext, 'dueAt'>, computed: number) => number
  followUp?: FollowUp
}

/**
 * Track A compression: a lead who arrives with fewer than 5 days left skips any of A1–A5 that
 * would land within 48 hours of the close; one who arrives with under 48 hours gets A1 and A7 only.
 */
function compressed(stepId: string) {
  return (ctx: StepContext): boolean => {
    if (ctx.stage.reopened && stepId !== 'A5') return false
    const closesAt = ctx.window.closesAt
    if (closesAt === null) return false
    const left = closesAt - ctx.stage.enteredAt
    if (left < 48 * HOUR) return stepId === 'A1'
    if (left < 5 * DAY) return ctx.dueAt < closesAt - 48 * HOUR
    return true
  }
}

const marketingEmail = { kind: 'marketing' as const, channel: 'email' as const }
const serviceEmail = { kind: 'service' as const, channel: 'email' as const }
const transactionalEmail = { kind: 'transactional' as const, channel: 'email' as const }

export const SEQUENCES: Step[] = [
  // Track A: before the first payment, while a window is open (Soap Opera Sequence). A0 is an event.
  { id: 'A0', track: 'A', ...transactionalEmail, template: 'A0', anchor: 'event', offsetHours: 0 },
  { id: 'A1', track: 'A', ...marketingEmail, template: 'A1', anchor: 'stage_entered', offsetHours: 1, when: compressed('A1') },
  { id: 'A2', track: 'A', ...marketingEmail, template: 'A2', anchor: 'stage_entered', offsetHours: 24, when: compressed('A2') },
  {
    id: 'A3', track: 'A', ...marketingEmail, template: 'A3', anchor: 'stage_entered', offsetHours: 48, when: compressed('A3'),
    followUp: { template: 'skillsair_offer_reminder', kind: 'marketing', afterHours: 24, unless: 'clicked' },
  },
  { id: 'A4', track: 'A', ...marketingEmail, template: 'A4', anchor: 'stage_entered', offsetHours: 72, when: compressed('A4') },
  { id: 'A5', track: 'A', ...marketingEmail, template: 'A5', anchor: 'stage_entered', offsetHours: 96, when: compressed('A5') },
  {
    id: 'A6', track: 'A', ...marketingEmail, template: 'A6', anchor: 'window_closes', offsetHours: -48, priority: 'high',
    followUp: { template: 'skillsair_window_closing', kind: 'marketing', afterHours: 24, unless: 'clicked' },
  },
  { id: 'A7', track: 'A', ...marketingEmail, template: 'A7', anchor: 'window_close_day', offsetHours: 9, priority: 'high' },
  // W1: a lead who applied before this window opened (WhatsApp skillsair_window_open goes from notifyWaitlist).
  { id: 'W1', track: 'A', ...marketingEmail, template: 'W1', anchor: 'stage_entered', offsetHours: 0, priority: 'high', when: (ctx) => Boolean(ctx.stage.reopened) },

  // Track A-post: weekly nurture after the window closes (StoryBrand: three value emails to one offer).
  { id: 'P1', track: 'Apost', ...marketingEmail, template: 'P1', anchor: 'stage_entered', offsetHours: 24 },
  { id: 'P2', track: 'Apost', ...marketingEmail, template: 'P2', anchor: 'stage_entered', offsetHours: 8 * 24, when: (ctx) => Boolean(ctx.flags.freeExercise) },
  { id: 'P3', track: 'Apost', ...marketingEmail, template: 'P3', anchor: 'stage_entered', offsetHours: 15 * 24 },
  { id: 'P4', track: 'Apost', ...marketingEmail, template: 'P4', anchor: 'stage_entered', offsetHours: 22 * 24 },
  { id: 'P5', track: 'Apost', ...marketingEmail, template: 'P5', anchor: 'stage_entered', offsetHours: 29 * 24 },
  { id: 'P6', track: 'Apost', ...marketingEmail, template: 'P6', anchor: 'stage_entered', offsetHours: 36 * 24, repeatEveryDays: 30, maxRepeats: 4 },

  // Track B: checkout not finished (reminder → gentle push → final nudge). No discounts.
  { id: 'B1', track: 'B', ...transactionalEmail, template: 'B1', anchor: 'stage_entered', offsetHours: 1 },
  { id: 'B1-WA', track: 'B', kind: 'transactional', channel: 'whatsapp', template: 'skillsair_payment_help', anchor: 'stage_entered', offsetHours: 2 },
  { id: 'B2', track: 'B', ...marketingEmail, template: 'B2', anchor: 'stage_entered', offsetHours: 24 },
  {
    id: 'B3', track: 'B', ...marketingEmail, template: 'B3', anchor: 'stage_entered', offsetHours: 48,
    dueOverride: (ctx, computed) => {
      const closesAt = ctx.window.open ? ctx.window.closesAt : null
      if (closesAt === null) return computed
      const beforeClose = closesAt - 12 * HOUR
      return beforeClose > ctx.stage.enteredAt + 2 * HOUR ? Math.min(computed, beforeClose) : computed
    },
  },

  // Track T: transactional, sent on events, never capped.
  { id: 'T1', track: 'T', ...transactionalEmail, template: 'T1', anchor: 'event', offsetHours: 0 },
  { id: 'T2', track: 'T', ...transactionalEmail, template: 'T2', anchor: 'event', offsetHours: 0 },
  { id: 'T3', track: 'T', ...serviceEmail, template: 'T3', anchor: 'event', offsetHours: 0 },
  { id: 'T4', track: 'T', ...serviceEmail, template: 'T4', anchor: 'event', offsetHours: 0 },
  { id: 'T5', track: 'T', ...transactionalEmail, template: 'T5', anchor: 'event', offsetHours: 0 },
  { id: 'T6', track: 'T', ...transactionalEmail, template: 'T6', anchor: 'event', offsetHours: 0 },
  { id: 'T7', track: 'T', ...transactionalEmail, template: 'T7', anchor: 'event', offsetHours: 0 },
  { id: 'T8', track: 'T', ...transactionalEmail, template: 'T8', anchor: 'event', offsetHours: 0 },
  { id: 'T9', track: 'T', ...transactionalEmail, template: 'T9', anchor: 'event', offsetHours: 0 },
  // Month-by-month (transfer/OPay) plans: next month due soon (T10) and in grace (T11).
  { id: 'T10', track: 'T', ...transactionalEmail, template: 'T10', anchor: 'event', offsetHours: 0 },
  { id: 'T11', track: 'T', ...transactionalEmail, template: 'T11', anchor: 'event', offsetHours: 0 },

  // Track D: failed payment. D1 goes on the event; access pauses when the grace days end.
  { id: 'D1', track: 'D', ...transactionalEmail, template: 'D1', anchor: 'event', offsetHours: 0 },
  { id: 'D2', track: 'D', ...transactionalEmail, template: 'D2', anchor: 'stage_entered', offsetHours: 48 },
  {
    id: 'D3', track: 'D', ...transactionalEmail, template: 'D3', anchor: 'stage_entered', offsetHours: 0,
    dueOverride: (ctx) => {
      const graceEnd = ctx.stage.enteredAt + ctx.graceDays * DAY
      const nineAm = lagosTimeOnDay(graceEnd, 9)
      return nineAm < graceEnd ? nineAm : graceEnd - 12 * HOUR
    },
  },

  // Track I: learning nudges (service, no selling). The clock restarts with every lesson.
  { id: 'I0', track: 'I', ...serviceEmail, template: 'I0', anchor: 'stage_entered', offsetHours: 48, when: (ctx) => Boolean(ctx.stage.neverStarted) },
  { id: 'I1', track: 'I', ...serviceEmail, template: 'I1', anchor: 'stage_entered', offsetHours: 5 * 24 },
  {
    id: 'I2', track: 'I', ...serviceEmail, template: 'I2', anchor: 'stage_entered', offsetHours: 10 * 24,
    followUp: { template: 'skillsair_learning_nudge', kind: 'marketing', afterHours: 24, unless: 'opened' },
  },
  { id: 'I3', track: 'I', ...serviceEmail, template: 'I3', anchor: 'stage_entered', offsetHours: 18 * 24 },

  // Track R: lapsed before finishing, at the locked ₦2,000 a month. T6 goes on the event.
  { id: 'R1', track: 'R', ...marketingEmail, template: 'R1', anchor: 'stage_entered', offsetHours: 3 * 24 },
  {
    id: 'R2', track: 'R', ...marketingEmail, template: 'R2', anchor: 'stage_entered', offsetHours: 7 * 24,
    followUp: { template: 'skillsair_resume_offer', kind: 'marketing', afterHours: 24, unless: 'clicked' },
  },
  { id: 'R3', track: 'R', ...marketingEmail, template: 'R3', anchor: 'stage_entered', offsetHours: 14 * 24 },
  { id: 'R4', track: 'R', ...marketingEmail, template: 'R4', anchor: 'stage_entered', offsetHours: 30 * 24 },
  { id: 'R5', track: 'R', ...marketingEmail, template: 'R5', anchor: 'stage_entered', offsetHours: 60 * 24, repeatEveryDays: 30, maxRepeats: 12 },

  // Track C: finished, no certificate. T8 goes on the event.
  { id: 'C1', track: 'C', ...marketingEmail, template: 'C1', anchor: 'stage_entered', offsetHours: 2 * 24 },
  {
    id: 'C2', track: 'C', ...marketingEmail, template: 'C2', anchor: 'stage_entered', offsetHours: 5 * 24, when: (ctx) => !ctx.flags.laptopDeadlineSoon,
    followUp: { template: 'skillsair_certificate_reminder', kind: 'marketing', afterHours: 24, unless: 'clicked' },
  },
  { id: 'C2L', track: 'C', ...marketingEmail, template: 'C2L', anchor: 'stage_entered', offsetHours: 5 * 24, when: (ctx) => Boolean(ctx.flags.laptopDeadlineSoon) },
  { id: 'C3', track: 'C', ...marketingEmail, template: 'C3', anchor: 'stage_entered', offsetHours: 10 * 24 },
  { id: 'C4', track: 'C', ...marketingEmail, template: 'C4', anchor: 'stage_entered', offsetHours: 20 * 24 },
  { id: 'C5', track: 'C', ...marketingEmail, template: 'C5', anchor: 'stage_entered', offsetHours: 45 * 24, repeatEveryDays: 45, maxRepeats: 3 },

  // Track G: certified graduates, next programme. T9 goes on the event.
  { id: 'G1', track: 'G', ...marketingEmail, template: 'G1', anchor: 'stage_entered', offsetHours: 7 * 24 },
  {
    id: 'G2', track: 'G', ...marketingEmail, template: 'G2', anchor: 'stage_entered', offsetHours: 14 * 24,
    followUp: { template: 'skillsair_next_programme', kind: 'marketing', afterHours: 24, unless: 'clicked' },
  },
  { id: 'G3', track: 'G', ...marketingEmail, template: 'G3', anchor: 'stage_entered', offsetHours: 21 * 24 },
  { id: 'G4', track: 'G', ...marketingEmail, template: 'G4', anchor: 'stage_entered', offsetHours: 45 * 24, repeatEveryDays: 30, maxRepeats: 4 },

  // Track X: re-permission after 90 days without engagement (sent by the planner, not on a schedule).
  { id: 'X1', track: 'X', ...marketingEmail, template: 'X1', anchor: 'event', offsetHours: 0 },
]

export function stepById(id: string): Step | undefined {
  return SEQUENCES.find((step) => step.id === id)
}

/** Scheduled steps for a track (event steps are sent by events.ts). */
export function scheduledSteps(track: Track): Step[] {
  return SEQUENCES.filter((step) => step.track === track && step.anchor !== 'event')
}

/** Due time for the n-th occurrence of a step (n > 0 only for repeating steps), or null if not applicable. */
export function dueTime(step: Step, ctx: Omit<StepContext, 'dueAt'>, occurrence = 0): number | null {
  let base: number
  if (step.anchor === 'stage_entered') base = ctx.stage.enteredAt + step.offsetHours * HOUR
  else if (step.anchor === 'window_closes') {
    if (!ctx.window.open || ctx.window.closesAt === null) return null
    base = ctx.window.closesAt + step.offsetHours * HOUR
  } else if (step.anchor === 'window_close_day') {
    if (!ctx.window.open || ctx.window.closesAt === null) return null
    base = lagosTimeOnDay(ctx.window.closesAt, 0) + step.offsetHours * HOUR
  } else return null
  if (step.dueOverride) base = step.dueOverride(ctx, base)
  return base + occurrence * (step.repeatEveryDays ?? 0) * DAY
}

export const WINDOW_ANCHORS: Anchor[] = ['window_closes', 'window_close_day']
