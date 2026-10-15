import { Resend } from 'resend'
import { logger } from './logger.js'

let resendClient: Resend | null = null

function getClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error('RESEND_API_KEY is not configured')
    resendClient = new Resend(apiKey)
  }
  return resendClient
}

interface EmailContent {
  subject: string
  html: string
  text: string
}

const BRAND_COLOR = '#1B5E20'
const FROM_NAME = process.env.EMAIL_FROM_NAME ?? 'SkillsAir'
const FROM_EMAIL = process.env.EMAIL_FROM ?? 'noreply@skillsair.com'
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

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

export async function sendEmail(to: string, content: EmailContent): Promise<void> {
  try {
    await getClient().emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    })
  } catch (err) {
    logger.error({ err, to, subject: content.subject }, 'email_send_failed')
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
  const subject = 'Verify your SkillsAir email'
  const html = wrapHtml(`
    <p>Hi ${firstName},</p>
    <p>Please verify your email address. This link is valid for 24 hours.</p>
    ${button('Verify email', verifyUrl)}
  `)
  return {
    subject,
    html,
    text: `Hi ${firstName}, verify your email (valid 24 hours): ${verifyUrl}`,
  }
}

export function passwordResetEmail(firstName: string, resetUrl: string): EmailContent {
  const subject = 'Reset your SkillsAir password'
  const html = wrapHtml(`
    <p>Hi ${firstName},</p>
    <p>We received a request to reset your password. This link is valid for 1 hour. If you didn't request this, you can ignore this email.</p>
    ${button('Reset password', resetUrl)}
  `)
  return {
    subject,
    html,
    text: `Hi ${firstName}, reset your password (valid 1 hour): ${resetUrl}`,
  }
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

export function courseCompletionEmail(firstName: string, courseName: string, certificateUrl: string): EmailContent {
  const subject = `Congratulations! You completed ${courseName}`
  const html = wrapHtml(`
    <p>Hi ${firstName},</p>
    <p>Congratulations on completing <strong>${courseName}</strong>! You've achieved a major milestone.</p>
    ${button('Get your certificate', certificateUrl)}
  `)
  return {
    subject,
    html,
    text: `Hi ${firstName}, congratulations on completing ${courseName}! Get your certificate: ${certificateUrl}`,
  }
}

export function certificateUnlockedEmail(firstName: string, downloadUrl: string, verificationUrl: string): EmailContent {
  const subject = 'Your certificate is ready to download'
  const html = wrapHtml(`
    <p>Hi ${firstName},</p>
    <p>Your certificate is ready. Download it below and share your achievement on LinkedIn.</p>
    ${button('Download certificate', downloadUrl)}
    <p style="margin-top:16px;"><a href="${verificationUrl}">${verificationUrl}</a></p>
  `)
  return {
    subject,
    html,
    text: `Hi ${firstName}, your certificate is ready: ${downloadUrl}. Verify at: ${verificationUrl}`,
  }
}

export function paymentConfirmationEmail(
  firstName: string,
  reference: string,
  amountFormatted: string,
  itemDescription: string,
): EmailContent {
  const subject = `Payment confirmed — Order #${reference}`
  const html = wrapHtml(`
    <p>Hi ${firstName},</p>
    <p>We've confirmed your payment of <strong>${amountFormatted}</strong> for ${itemDescription}.</p>
    <p>Order reference: <strong>${reference}</strong></p>
  `)
  return {
    subject,
    html,
    text: `Hi ${firstName}, payment confirmed for ${itemDescription}. Amount: ${amountFormatted}. Reference: ${reference}`,
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

export function subscriptionCancelledEmail(firstName: string, accessEndDate: string, resubscribeUrl: string): EmailContent {
  const subject = 'Your SkillsAir subscription has been cancelled'
  const html = wrapHtml(`
    <p>Hi ${firstName},</p>
    <p>Your subscription has been cancelled. You'll retain access until <strong>${accessEndDate}</strong>.</p>
    ${button('Re-subscribe', resubscribeUrl)}
  `)
  return {
    subject,
    html,
    text: `Hi ${firstName}, your subscription is cancelled. Access ends ${accessEndDate}. Re-subscribe: ${resubscribeUrl}`,
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const naira = (amount: number) => `₦${amount.toLocaleString('en-NG')}`

const LEAD_FOOTER = `You're receiving this because you applied for a SkillsAir programme at skillsair.com.
              SKILLS AIR LIMITED · RC 9272398 · Osifila Street, Anifowose, Ikeja, Lagos.`

export interface OfferEmailInput {
  firstName: string
  programme: string
  offerUrl: string
  windowOpen: boolean
  price: number
  standardPrice: number
  standardMonthlyPrice: number | null
  certificatePrice: number
  closesOn: string
}

/** Email A: sent immediately when someone applies (transactional), signed by Imisi. */
export function offerEmail(input: OfferEmailInput): EmailContent {
  const name = escapeHtml(input.firstName)
  const programme = escapeHtml(input.programme)
  const cert = naira(input.certificatePrice)
  if (!input.windowOpen) {
    const monthly = input.standardMonthlyPrice ? ` (or ${naira(input.standardMonthlyPrice)}/month)` : ''
    const subject = `${input.firstName}, your SkillsAir application for ${input.programme}`
    const html = wrapHtml(`
      <p>Hi ${name},</p>
      <p>Thanks for applying for <strong>${programme}</strong>. The Access Scholarship window is closed right now, so the standard fee of <strong>${naira(input.standardPrice)}</strong>${monthly} applies.</p>
      <p>We'll message you on WhatsApp the moment the next scholarship window opens.</p>
      <p>Certificate: ${cert}, paid only when you finish and want it.</p>
      ${button('See my offer', input.offerUrl)}
      <p style="margin-top:24px;">Questions? Reply here or WhatsApp me on +234 818 212 6524.</p>
      <p>Imisi, SkillsAir</p>
    `, LEAD_FOOTER)
    return {
      subject,
      html,
      text: `Hi ${input.firstName}, thanks for applying for ${input.programme}. The Access Scholarship window is closed right now, so the standard fee of ${naira(input.standardPrice)}${monthly} applies. We'll message you on WhatsApp when the next window opens. Certificate: ${cert}, paid only when you finish and want it. Your offer: ${input.offerUrl}\n\nImisi, SkillsAir`,
    }
  }
  const discount = Math.max(input.standardPrice - input.price, 0)
  const subject = `${input.firstName}, your ${naira(input.price)} SkillsAir scholarship offer (closes ${input.closesOn})`
  const html = wrapHtml(`
    <p>Hi ${name},</p>
    <p>You qualify for the Access Scholarship on <strong>${programme}</strong>.</p>
    <table role="presentation" width="100%" cellpadding="6" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;margin:16px 0;">
      <tr><td>Standard fee</td><td align="right"><s>${naira(input.standardPrice)}</s></td></tr>
      <tr><td>Access Scholarship</td><td align="right">−${naira(discount)}</td></tr>
      <tr><td><strong>You pay to start</strong></td><td align="right"><strong>${naira(input.price)}, one time</strong></td></tr>
      <tr><td>Certificate (when you finish)</td><td align="right">${cert}, optional; needed for internship access</td></tr>
    </table>
    <p>The scholarship closes on <strong>${escapeHtml(input.closesOn)}, 11:59pm</strong>.</p>
    <p><strong>What you get:</strong></p>
    <ul>
      <li>The full ${programme} programme, with 3 months to finish at your own pace</li>
      <li>When you finish: a verifiable certificate employers can check online (${cert})</li>
      <li>Free bonus courses: CV &amp; LinkedIn, and Freelancing</li>
      <li>Access to internship openings from SkillsAir partner firms once you're certified</li>
    </ul>
    <p>Our fair refund promise: complete at least one chapter or 5 lessons. If it's not for you, ask for a refund within 24 hours of paying.</p>
    ${button('Secure my seat', input.offerUrl)}
    <p style="margin-top:24px;">Questions? Reply here or WhatsApp me on +234 818 212 6524.</p>
    <p>Imisi, SkillsAir</p>
  `, LEAD_FOOTER)
  return {
    subject,
    html,
    text: [
      `Hi ${input.firstName},`,
      '',
      `You qualify for the Access Scholarship on ${input.programme}.`,
      '',
      `Standard fee: ${naira(input.standardPrice)}`,
      `Access Scholarship: -${naira(discount)}`,
      `You pay to start: ${naira(input.price)}, one time`,
      `Certificate (when you finish): ${cert}, optional; needed for internship access`,
      '',
      `The scholarship closes on ${input.closesOn}, 11:59pm.`,
      '',
      "Refund promise: complete at least one chapter or 5 lessons. If it's not for you, ask for a refund within 24 hours of paying.",
      '',
      `Secure my seat: ${input.offerUrl}`,
      '',
      'Questions? Reply here or WhatsApp me on +234 818 212 6524.',
      'Imisi, SkillsAir',
    ].join('\n'),
  }
}

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
