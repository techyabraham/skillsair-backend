import { sendEmail, type EmailContent } from '../resend.js'
import { formatNaira } from '../money.js'
import { logger } from '../logger.js'

export function commissionApprovedEmail(amountKobo: number): EmailContent {
  const amount = formatNaira(amountKobo)
  const subject = amount + ' is now available to withdraw'
  return { subject, text: subject + '. Sign in to your SkillsAir Ambassadors portal to view your wallet and payout options.', html: '<p>' + subject + '.</p><p>Sign in to your SkillsAir Ambassadors portal to view your wallet and payout options.</p>' }
}
export async function sendCommissionApprovedEmail(to: string, amountKobo: number, ambassadorId: number): Promise<void> {
  try { await sendEmail(to, commissionApprovedEmail(amountKobo)) }
  catch { logger.error({ ambassadorId }, 'ambassador_commission_email_failed') }
}

export function ambassadorApprovedEmail(firstName: string, referralLink: string): EmailContent {
  const name = escapeHtml(firstName || 'there')
  const link = escapeHtml(referralLink)
  return {
    subject: 'Your SkillsAir Ambassador application is approved',
    html: `<p>Hello ${name},</p><p>Your SkillsAir Ambassador application has been approved.</p><p>Your referral link is <a href="${link}">${link}</a>.</p><p>Sign in to your portal to view your dashboard and share your link.</p>`,
    text: `Hello ${firstName || 'there'},\n\nYour SkillsAir Ambassador application has been approved.\n\nYour referral link: ${referralLink}\n\nSign in to your portal to view your dashboard and share your link.`,
  }
}

export function ambassadorPayoutRequestedEmail(amountKobo: number): EmailContent {
  const amount = formatNaira(amountKobo)
  return {
    subject: `Withdrawal request received: ${amount}`,
    html: `<p>We have received your withdrawal request for <strong>${amount}</strong>.</p><p>You can check its status in your SkillsAir Ambassadors portal.</p>`,
    text: `We have received your withdrawal request for ${amount}. You can check its status in your SkillsAir Ambassadors portal.`,
  }
}

export function ambassadorPayoutPaidEmail(amountKobo: number, bankName: string, accountLast4: string): EmailContent {
  const amount = formatNaira(amountKobo)
  const safeBank = escapeHtml(bankName)
  const last4 = escapeHtml(accountLast4)
  return {
    subject: `${amount} has been sent to your bank`,
    html: `<p>Your withdrawal of <strong>${amount}</strong> has been sent to ${safeBank}, account ending in •••• ${last4}.</p><p>Allow your bank a little time to show the credit.</p>`,
    text: `Your withdrawal of ${amount} has been sent to ${bankName}, account ending in ${last4}. Allow your bank a little time to show the credit.`,
  }
}

export function ambassadorPayoutFailedEmail(amountKobo: number, reason: string): EmailContent {
  const amount = formatNaira(amountKobo)
  const safeReason = escapeHtml(reason)
  return {
    subject: `Your ${amount} withdrawal needs attention`,
    html: `<p>Your withdrawal of <strong>${amount}</strong> could not be completed.</p><p>${safeReason}</p><p>Your available balance has been updated. Check your bank details before requesting another withdrawal.</p>`,
    text: `Your withdrawal of ${amount} could not be completed. ${reason} Your available balance has been updated. Check your bank details before requesting another withdrawal.`,
  }
}

async function sendAmbassadorEmail(to: string, content: EmailContent, ambassadorId: number, event: string): Promise<void> {
  try { await sendEmail(to, content) }
  catch { logger.error({ ambassadorId }, event) }
}

export async function sendAmbassadorPayoutRequestedEmail(to: string, amountKobo: number, ambassadorId: number): Promise<void> {
  await sendAmbassadorEmail(to, ambassadorPayoutRequestedEmail(amountKobo), ambassadorId, 'ambassador_payout_request_email_failed')
}

export async function sendAmbassadorPayoutPaidEmail(to: string, amountKobo: number, bankName: string, last4: string, ambassadorId: number): Promise<void> {
  await sendAmbassadorEmail(to, ambassadorPayoutPaidEmail(amountKobo, bankName, last4), ambassadorId, 'ambassador_payout_paid_email_failed')
}

export async function sendAmbassadorPayoutFailureEmail(to: string, amountKobo: number, reason: string, ambassadorId: number): Promise<void> {
  await sendAmbassadorEmail(to, ambassadorPayoutFailedEmail(amountKobo, reason), ambassadorId, 'ambassador_payout_failure_email_failed')
}

export async function sendAmbassadorPayoutAdminEmail(message: string): Promise<void> {
  const to = process.env.AMBASSADOR_ADMIN_EMAIL?.trim()
  if (!to) {
    logger.error({ reason: 'AMBASSADOR_ADMIN_EMAIL is not configured' }, 'ambassador_admin_email_skipped')
    return
  }
  try { await sendEmail(to, { subject: 'SkillsAir Ambassadors payout needs attention', text: message, html: `<p>${escapeHtml(message)}</p>` }) }
  catch { logger.error({ reason: 'send_failed' }, 'ambassador_admin_alert_email_failed') }
}

export async function sendAmbassadorApprovedEmail(to: string, firstName: string, referralLink: string, ambassadorId: number): Promise<void> {
  await sendAmbassadorEmail(to, ambassadorApprovedEmail(firstName, referralLink), ambassadorId, 'ambassador_approved_email_failed')
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

export function ambassadorVerificationEmail(firstName: string, otp: string, link: string): EmailContent {
  const safeName = escapeHtml(firstName || 'there')
  const safeLink = escapeHtml(link)
  return {
    subject: 'Verify your SkillsAir Ambassadors email',
    html: `<p>Hello ${safeName},</p><p>Enter this code in the Ambassadors portal:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${otp}</p><p>The code expires in 30 minutes.</p><p>You can also verify your email using this link:</p><p><a href="${safeLink}">Verify email</a></p><p>If you did not apply, you can ignore this message.</p>`,
    text: `Hello ${firstName || 'there'},\n\nYour SkillsAir Ambassadors verification code is ${otp}. It expires in 30 minutes.\n\nVerify your email: ${link}\n\nIf you did not apply, you can ignore this message.`,
  }
}

export function ambassadorApplicationReceivedEmail(name: string, email: string, username: string): EmailContent {
  const safeName = escapeHtml(name)
  const safeEmail = escapeHtml(email)
  const safeUsername = escapeHtml(username)
  return {
    subject: `New ambassador application: ${name}`,
    html: `<p>A new SkillsAir Ambassadors application is ready for review.</p><p><strong>Name:</strong> ${safeName}<br><strong>Email:</strong> ${safeEmail}<br><strong>Username:</strong> ${safeUsername}</p>`,
    text: `A new SkillsAir Ambassadors application is ready for review.\nName: ${name}\nEmail: ${email}\nUsername: ${username}`,
  }
}

export function ambassadorBankChangedEmail(firstName: string): EmailContent {
  const safeName = escapeHtml(firstName || 'there')
  return {
    subject: 'Your SkillsAir payout account was changed',
    html: `<p>Hello ${safeName},</p><p>Your payout account was changed. For your security, withdrawals to a replacement account may be held for a short period.</p><p>If you did not make this change, contact SkillsAir support immediately.</p>`,
    text: `Hello ${firstName || 'there'},\n\nYour payout account was changed. For your security, withdrawals to a replacement account may be held for a short period.\n\nIf you did not make this change, contact SkillsAir support immediately.`,
  }
}
