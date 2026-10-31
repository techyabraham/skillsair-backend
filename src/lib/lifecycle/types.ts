/**
 * Shared types for the lifecycle email engine. The planner (stage.ts, plan.ts) works on plain
 * snapshots with times in epoch milliseconds, so it can be unit-tested without a database.
 */
export type Channel = 'email' | 'whatsapp'
export type Kind = 'transactional' | 'service' | 'marketing'
/** A: before the first payment (window open) · Apost: after the window closes · B: checkout not finished ·
 *  T: transactional · D: failed payment · I: inactivity · R: lapsed · C: certificate · G: next programme · X: re-permission ·
 *  L: learning plan (guided 12-week plan emails, sent by the guided-plan job) */
export type Track = 'A' | 'Apost' | 'B' | 'T' | 'D' | 'I' | 'R' | 'C' | 'G' | 'X' | 'L'

export interface Stage {
  track: Track
  /** What the stage is about: "lead:12", "order:40", "sub:7", "enr:19", "cert:5". */
  subjectId: string
  enteredAt: number
  /** Separates repeat visits to a stage (a new window, a second lapse) so steps can send again. */
  cycle: number
  courseId?: number
  /** A only: the lead applied before this window opened (they're coming back for it). */
  reopened?: boolean
  /** I only: paid but never started a lesson. */
  neverStarted?: boolean
}

export interface WindowState {
  open: boolean
  opensAt: number | null
  closesAt: number | null
  /** When the most recent window closed (null if none has closed yet). */
  lastClosedAt: number | null
}

export interface SnapshotOrder {
  id: number
  type: string
  status: string
  courseId: number | null
  createdAt: number
}

export interface SnapshotSubscription {
  id: number
  courseId: number
  status: 'active' | 'past_due' | 'cancelled' | 'expired'
  lastFailedAt: number | null
  currentPeriodEnd: number | null
  /** card = Paystack renews it; manual = transfer/OPay, paid month by month. Missing = card. */
  billing?: 'card' | 'manual'
  failedAttempts: number
  updatedAt: number
}

export interface SnapshotEnrollment {
  id: number
  courseId: number
  status: string
  enrolledAt: number
  completedAt: number | null
  cycle: number
  /** On a monthly plan (only those get learning nudges and win-back emails). */
  subscriptionBased: boolean
  /** When an admin's access extension for this programme ends (Studio enrolments have one). */
  accessExtendedUntil?: number | null
}

export interface PersonSnapshot {
  /** "user:<id>" or "lead:<id>" (a lead with an account is handled as the user). */
  key: string
  kind: 'user' | 'lead'
  id: number
  createdAt: number
  email: string | null
  phone: string | null
  emailSuppressed: boolean
  /** Marketing consent + the "offers" preference, and not opted out. */
  marketingEmailAllowed: boolean
  marketingWhatsAppAllowed: boolean
  learningReminders: boolean
  sunsetAt: number | null
  lastEngagedAt: number | null
  lastLearningAt: number | null
  lead: { id: number; status: string; createdAt: number; courseId: number | null } | null
  orders: SnapshotOrder[]
  subscriptions: SnapshotSubscription[]
  enrollments: SnapshotEnrollment[]
  certificates: Array<{ courseId: number; issuedAt: number }>
}

/** A row of the messages log, as the planner needs it. */
export interface LogEntry {
  idempotencyKey: string
  track: string
  stepId: string
  kind: Kind
  channel: Channel
  status: 'sent' | 'skipped' | 'failed'
  skipReason?: string | null
  sentAt: number
  openedAt?: number | null
  clickedAt?: number | null
}

export interface PlannerConfig {
  graceDays: number
  /** A scheduled step more than this late is skipped ("stale") rather than sent. */
  staleAfterMs: number
  now: number
}
