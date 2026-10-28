/**
 * Types for the ambassador collections, written out by hand. payload-types.ts is generated
 * locally (`npm run generate:types`) but gitignored and not generated in the Docker build, so
 * code that tsc compiles in the image cannot import it. Keep these in step with
 * src/collections/ambassadors/* and src/globals/AmbassadorSettings.ts.
 */

export type AmbassadorStatus = 'pending' | 'active' | 'blocked'
export type AmbassadorSource = 'self' | 'admin' | 'wp_import'
export type CommissionableType = 'course' | 'subscription' | 'renewal' | 'certificate'

export type LedgerType = 'commission' | 'reversal' | 'adjustment' | 'payout' | 'payout_reversal'
export type LedgerStatus = 'pending' | 'approved' | 'void' | 'reserved' | 'paid'
export type LedgerProductType = CommissionableType | 'none'

/** A relationship as Payload returns it: an id at depth 0, or the populated document. */
export type Rel<T extends { id: number }> = number | T

export interface AmbassadorRiskFlag {
  id?: string | null
  kind: 'shared_bank' | 'self_referral_suspected' | 'velocity' | 'manual'
  note?: string | null
  openedAt?: string | null
  resolvedAt?: string | null
  resolvedBy?: number | { id: number } | null
}

export interface AmbassadorDoc {
  id: number
  user: number | { id: number; email: string; firstName?: string; lastName?: string }
  code: string
  username: string
  legacyWpRef?: string | null
  status: AmbassadorStatus
  source: AmbassadorSource
  emailVerifiedAt?: string | null
  promotionPlan?: string | null
  about?: string | null
  heardAbout?: string | null
  approvedAt?: string | null
  approvedBy?: number | { id: number } | null
  blockedAt?: string | null
  blockedReason?: string | null
  riskFlags?: AmbassadorRiskFlag[] | null
  createdAt: string
  updatedAt: string
}

export interface LedgerDoc {
  id: number
  ambassador: Rel<AmbassadorDoc>
  type: LedgerType
  status: LedgerStatus
  amountKobo: number
  saleKobo?: number | null
  rateBps?: number | null
  order?: number | { id: number } | null
  subscription?: number | { id: number } | null
  invoiceCode?: string | null
  payout?: number | { id: number } | null
  referredUser?: number | { id: number } | null
  productType?: LedgerProductType | null
  productTitle?: string | null
  availableAt?: string | null
  idempotencyKey: string
  note?: string | null
  createdBy?: number | { id: number } | null
  createdAt: string
  updatedAt: string
}

export type PayoutStatus = 'requested' | 'approved' | 'processing' | 'success' | 'failed' | 'rejected'

export interface AuditLogDoc {
  id: number
  actor?: number | { id: number } | null
  action?: string | null
  targetCollection?: string | null
  targetId?: string | null
  before?: unknown
  after?: unknown
  ip?: string | null
  createdAt: string
}

export interface AmbassadorSettings {
  programOpen: boolean
  defaultApplicationStatus: 'pending' | 'active'
  commissionRateBps: number
  commissionableTypes: CommissionableType[]
  approvalDelayDays: number
  cookieDays: number
  attributionModel: 'first_click' | 'last_click'
  /** null: an attribution is permanent. */
  attributionLifetimeDays: number | null
  minPayoutKobo: number
  payoutsEnabled: boolean
  payoutMode: 'manual_review' | 'automatic'
  perTransferCapKobo: number
  dailyCapKobo: number
  newBankHoldHours: number
  showReferredEmails: boolean
  heardAboutOptions: string[]
  shareMessage: string
}
