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

function wrapHtml(bodyHtml: string): string {
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
              You're receiving this email because you have an account with SkillsAir.
              <a href="${FRONTEND_URL}/unsubscribe" style="color:#a1a1aa;">Unsubscribe</a>
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
    <p>Your SkillsAir account has been created. We're excited to have you join thousands of African students leveling up their careers.</p>
    ${button('Verify your email', `${FRONTEND_URL}/verify-email`)}
  `)
  return {
    subject,
    html,
    text: `Hi ${firstName}, your SkillsAir account has been created. Verify your email at ${FRONTEND_URL}/verify-email`,
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
