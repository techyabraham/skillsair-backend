import type { RenderedEmail } from './define.js'
import type { EmailKind } from './layout.js'
import { emailVerification } from './email-verification.js'
import { passwordReset } from './password-reset.js'

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
}

export { emailVerification, passwordReset }
