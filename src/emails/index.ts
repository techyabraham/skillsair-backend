import type { RenderedEmail } from './define.js'
import type { EmailKind } from './layout.js'
import { emailVerification } from './email-verification.js'
import { passwordReset } from './password-reset.js'
import { LIFECYCLE_TEMPLATES } from './lifecycle/index.js'
import { accountWelcome } from './account-welcome.js'
import { accountEnrolment } from './account-enrolment.js'
import { accountAccessExtended } from './account-access-extended.js'
import { leadDailySummary } from './account-lead-summary.js'

export { defineEmail, firstNameOf, type EmailTemplate, type RenderedEmail } from './define.js'

/** Every template, for the admin preview route and `npm run emails:preview`. */
export interface PreviewableTemplate {
  id: string
  kind: EmailKind
  track: string
  stepId: string
  renderSample(): RenderedEmail
}

export const emailTemplates: Record<string, PreviewableTemplate> = {
  [passwordReset.id]: passwordReset,
  [emailVerification.id]: emailVerification,
  [accountWelcome.id]: accountWelcome,
  [accountEnrolment.id]: accountEnrolment,
  [accountAccessExtended.id]: accountAccessExtended,
  [leadDailySummary.id]: leadDailySummary,
  ...LIFECYCLE_TEMPLATES,
}

export { emailVerification, passwordReset, accountWelcome, accountEnrolment, accountAccessExtended, leadDailySummary }
