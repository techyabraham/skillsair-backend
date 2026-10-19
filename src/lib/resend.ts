import { Resend } from 'resend'
import { logger } from './logger.js'
import { emailVerification, passwordReset } from '../emails/index.js'

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

const BRAND_COLOR = '#1B5E20'
export const EMAIL_SENDER_NAME = process.env.EMAIL_FROM_NAME ?? 'Imisi from SkillsAir'
const FROM_TRANSACTIONAL = process.env.EMAIL_FROM_TRANSACTIONAL ?? process.env.EMAIL_FROM ?? 'imisi@notify.skillsair.com'
const FROM_MARKETING = process.env.EMAIL_FROM_MARKETING ?? 'imisi@mail.skillsair.com'
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? 'hello@skillsair.com'
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

export function senderAddress(stream: EmailStream): string {
  return `${EMAIL_SENDER_NAME} <${stream === 'marketing' ? FROM_MARKETING : FROM_TRANSACTIONAL}>`
}

const ACCOUNT_FOOTER = `You're receiving this email because you have an account with SkillsAir.
              <a href="${FRONTEND_URL}/unsubscribe" style="color:#a1a1aa;">Unsubscribe</a>`

function wrapHtml(bodyHtml: string, footerHtml = ACCOUNT_FOOTER): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background-color:${BRAND_COLOR};padding:24px 32px;">
              <h1 style="color:#ffffff;font-size:20px;margin:0;">SkillsAir</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#27272a;font-size:15px;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;background-color:#fafafa;color:#a1a1aa;font-size:12px;">
              ${footerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function button(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;margin-top:16px;">${label}</a>`
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

export function welcomeEmail(firstName: string): EmailContent {
  const subject = `Welcome to SkillsAir, ${firstName}!`
  const html = wrapHtml(`
    <p>Hi ${firstName},</p>
    <p>Your SkillsAir account has been created. We're glad to have you with us.</p>
    ${button('Go to your dashboard', `${FRONTEND_URL}/dashboard`)}
  `)
  return {
    subject,
    html,
    text: `Hi ${firstName}, your SkillsAir account has been created. Go to your dashboard: ${FRONTEND_URL}/dashboard`,
  }
}

export function emailVerificationEmail(firstName: string, verifyUrl: string): EmailContent {
  return emailVerification.render({ firstName, verifyUrl })
}

export function passwordResetEmail(firstName: string, resetUrl: string): EmailContent {
  return passwordReset.render({ firstName, resetUrl })
}

export function enrollmentConfirmationEmail(firstName: string, courseName: string, courseUrl: string): EmailContent {
  const subject = `You are enrolled in ${courseName}`
  const html = wrapHtml(`
    <p>Hi ${firstName},</p>
    <p>You're now enrolled in <strong>${courseName}</strong>. Start learning whenever you're ready.</p>
    ${button('Start learning', courseUrl)}
  `)
  return {
    subject,
    html,
    text: `Hi ${firstName}, you are enrolled in ${courseName}. Start learning: ${courseUrl}`,
  }
}

export function accessExtendedEmail(firstName: string, newExpiryDate: string, daysAdded: number, reason: string): EmailContent {
  const subject = 'Your SkillsAir access has been extended'
  const html = wrapHtml(`
    <p>Hi ${firstName},</p>
    <p>Your access has been extended by <strong>${daysAdded} days</strong>.</p>
    <p>New expiry: <strong>${newExpiryDate}</strong></p>
    <p>Reason: ${reason}</p>
  `)
  return {
    subject,
    html,
    text: `Hi ${firstName}, your access has been extended by ${daysAdded} days. New expiry: ${newExpiryDate}. Reason: ${reason}`,
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const naira = (amount: number) => `₦${amount.toLocaleString('en-NG')}`

const LEAD_FOOTER = `You're receiving this because you applied for a SkillsAir programme at skillsair.com.
              SKILLS AIR LIMITED · RC 9272398 · Osifila Street, Anifowose, Ikeja, Lagos.`

export interface LeadSummaryInput {
  dateLabel: string
  newLeads: number
  bySchool: Array<{ label: string; count: number }>
  bySource: Array<{ label: string; count: number }>
  offersViewed: number
  accountsCreated: number
  payments: number
  queueSize: number
  topLeads: Array<{ firstName: string; programme: string; score: number; needsHuman: boolean; adminUrl: string }>
}

/** Internal daily summary for the team. Contains first names only, no contact details. */
export function leadDailySummaryEmail(input: LeadSummaryInput): EmailContent {
  const list = (rows: Array<{ label: string; count: number }>) =>
    rows.length ? rows.map((row) => `<li>${escapeHtml(row.label)}: ${row.count}</li>`).join('') : '<li>None</li>'
  const top = input.topLeads.length
    ? input.topLeads
        .map((lead) => `<li><a href="${lead.adminUrl}">${escapeHtml(lead.firstName)}</a>, ${escapeHtml(lead.programme)} (score ${lead.score}${lead.needsHuman ? ', needs Imisi' : ''})</li>`)
        .join('')
    : '<li>None</li>'
  const subject = `SkillsAir leads: ${input.newLeads} new, ${input.queueSize} waiting for Imisi (${input.dateLabel})`
  const html = wrapHtml(`
    <p><strong>Last 24 hours</strong></p>
    <ul>
      <li>New leads: ${input.newLeads}</li>
      <li>Offers viewed: ${input.offersViewed}</li>
      <li>Accounts created: ${input.accountsCreated}</li>
      <li>Payments: ${input.payments}</li>
      <li>Imisi's queue right now: ${input.queueSize}</li>
    </ul>
    <p><strong>New leads by school</strong></p><ul>${list(input.bySchool)}</ul>
    <p><strong>New leads by source</strong></p><ul>${list(input.bySource)}</ul>
    <p><strong>Top 10 open leads by score</strong></p><ol>${top}</ol>
  `, 'Internal SkillsAir lead summary.')
  const text = [
    `Last 24 hours (${input.dateLabel})`,
    `New leads: ${input.newLeads}`,
    `Offers viewed: ${input.offersViewed}`,
    `Accounts created: ${input.accountsCreated}`,
    `Payments: ${input.payments}`,
    `Imisi's queue: ${input.queueSize}`,
    '',
    'By school:',
    ...input.bySchool.map((row) => `- ${row.label}: ${row.count}`),
    '',
    'By source:',
    ...input.bySource.map((row) => `- ${row.label}: ${row.count}`),
    '',
    'Top leads:',
    ...input.topLeads.map((lead) => `- ${lead.firstName}, ${lead.programme} (score ${lead.score}) ${lead.adminUrl}`),
  ].join('\n')
  return { subject, html, text }
}

function marketingFooter(unsubscribeUrl: string): string {
  return `You're receiving this because you applied at skillsair.com and asked for updates.
              <a href="${unsubscribeUrl}" style="color:#a1a1aa;">Unsubscribe</a> ·
              SKILLS AIR LIMITED · RC 9272398 · Osifila Street, Anifowose, Ikeja, Lagos.`
}

const signOff = `<p style="margin-top:24px;">Questions? Reply here or WhatsApp me on +234 818 212 6524.</p><p>Imisi, SkillsAir</p>`
const signOffText = 'Questions? Reply here or WhatsApp me on +234 818 212 6524.\nImisi, SkillsAir'
