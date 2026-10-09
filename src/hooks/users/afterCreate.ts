import type { CollectionAfterChangeHook } from 'payload'
import { sendEmail, welcomeEmail } from '../../lib/resend.js'
import { logger } from '../../lib/logger.js'

interface UserDoc {
  email: string
  firstName: string
}

export const usersAfterCreate: CollectionAfterChangeHook = async ({ context, doc, operation }) => {
  if (operation !== 'create' || context?.skipWelcomeEmail === true) return doc

  const user = doc as UserDoc
  try {
    await sendEmail(user.email, welcomeEmail(user.firstName))
  } catch (err) {
    logger.error({ err, userId: doc.id }, 'welcome_email_failed')
  }

  return doc
}
