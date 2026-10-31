import { Resend } from 'resend'
import { logger } from './logger.js'
import { emailVerification, passwordReset } from '../emails/index.js'
import { accountAccessExtended } from '../emails/account-access-extended.js'
import { accountAdminEnrolment, type AccountAdminEnrolmentData } from '../emails/account-admin-enrolment.js'
import { accountEnrolment } from '../emails/account-enrolment.js'
import { accountWelcome } from '../emails/account-welcome.js'
import { leadDailySummary, type LeadSummaryInput } from '../emails/account-lead-summary.js'
import { getSettings } from '../emails/override-store.js'

export type { LeadSummaryInput }

let resendClient: Resend | null = null

function getClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error('RESEND_API_KEY is not configured')
    resendClient = new Resend(apiKey)
  }
  return resendClient
}

export interface EmailContent {
  subject: string
  html: string
  text: string
}

/**
 * Two sending streams on separate subdomains, so a marketing complaint can never block a
 * receipt: transactional (receipts, account, the offer someone asked for) and marketing
 * (sales sequences, nudges, reminders). Both use one sender name, and replies go to a
 * monitored inbox that Imisi reads.
 */
export type EmailStream = 'transactional' | 'marketing'

export interface SendEmailOptions {
  stream?: EmailStream
  /** Extra headers, e.g. List-Unsubscribe for marketing and service email. */
  headers?: Record<string, string>
  /** Resend tags, e.g. { track: 'A', step: 'A1' }; letters, numbers, _ and - only. */
  tags?: Record<string, string>
}

export const EMAIL_SENDER_NAME = process.env.EMAIL_FROM_NAME ?? 'Imisi from SkillsAir'
const FROM_TRANSACTIONAL = process.env.EMAIL_FROM_TRANSACTIONAL ?? process.env.EMAIL_FROM ?? 'imisi@notify.skillsair.com'
const FROM_MARKETING = process.env.EMAIL_FROM_MARKETING ?? 'imisi@mail.skillsair.com'
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? 'hello@skillsair.com'

export function senderAddress(stream: EmailStream): string {
  // Studio (Email settings) can change the display name; the addresses stay as configured.
  return `${getSettings().senderName || EMAIL_SENDER_NAME} <${stream === 'marketing' ? FROM_MARKETING : FROM_TRANSACTIONAL}>`
}

/** Sends one email and returns Resend's email id (used to match bounce and click webhooks). */
export async function sendEmail(to: string, content: EmailContent, options: SendEmailOptions = {}): Promise<string | null> {
  const stream = options.stream ?? 'transactional'
  try {
    const result = await getClient().emails.send({
      from: senderAddress(stream),
      to,
      replyTo: REPLY_TO,
      subject: content.subject,
      html: content.html,
      text: content.text,
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.tags ? { tags: Object.entries(options.tags).map(([name, value]) => ({ name, value: value.replace(/[^A-Za-z0-9_-]/g, '_') })) } : {}),
    })
    if (result.error) throw new Error(`${result.error.name}: ${result.error.message}`)
    return result.data?.id ?? null
  } catch (err) {
    logger.error({ err, stream, subject: content.subject }, 'email_send_failed')
    throw err
  }
}

/** The account emails are Studio-editable templates in src/emails/account-*.ts; these keep their callers unchanged. */
const content = (rendered: { subject: string; html: string; text: string }): EmailContent => ({ subject: rendered.subject, html: rendered.html, text: rendered.text })

export function welcomeEmail(firstName: string): EmailContent {
  return content(accountWelcome.render({ firstName }))
}

export function emailVerificationEmail(firstName: string, verifyUrl: string): EmailContent {
  return emailVerification.render({ firstName, verifyUrl })
}

export function passwordResetEmail(firstName: string, resetUrl: string): EmailContent {
  return passwordReset.render({ firstName, resetUrl })
}

export function enrollmentConfirmationEmail(firstName: string, courseName: string, courseUrl: string): EmailContent {
  return content(accountEnrolment.render({ firstName, courseName, courseUrl }))
}

export function accessExtendedEmail(firstName: string, newExpiryDate: string, daysAdded: number, reason: string): EmailContent {
  return content(accountAccessExtended.render({ firstName, newExpiryDate, daysAdded, reason }))
}

export function adminEnrolmentEmail(data: AccountAdminEnrolmentData): EmailContent {
  return content(accountAdminEnrolment.render(data))
}

/** Internal daily summary for the team. Contains first names only, no contact details. */
export function leadDailySummaryEmail(input: LeadSummaryInput): EmailContent {
  return content(leadDailySummary.render(input))
}
