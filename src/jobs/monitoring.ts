import type { SanitizedConfig } from 'payload'
import { jobScheduler } from './scheduler.js'
import { logger } from '../lib/logger.js'
import { driveHealthForHour } from '../lib/drive-health.js'
import { sendEmail } from '../lib/resend.js'
import { claimIdempotencyKey } from '../lib/redis.js'

const cron = jobScheduler('monitoring')

/** Where alerts go: ALERT_EMAIL, else the daily lead summary address. */
export const alertRecipient = () => process.env.ALERT_EMAIL || process.env.LEAD_SUMMARY_EMAIL || ''

export async function sendOwnerAlert(key: string, subject: string, lines: string[]): Promise<void> {
  const to = alertRecipient()
  if (!to) {
    logger.warn({ key, subject }, 'owner_alert_no_recipient')
    return
  }
  // One alert per key per day.
  if (!(await claimIdempotencyKey(`owner-alert:${key}:${new Date().toISOString().slice(0, 10)}`, 86_400))) return
  const text = lines.join('\n')
  await sendEmail(to, { subject: `[SkillsAir alert] ${subject}`, text, html: `<p>${lines.map((line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>')}</p>` })
}

/** Hourly: alerts the owner when Drive "download quota exceeded" errors pass 1% of video plays. */
export async function checkDriveHealth(): Promise<void> {
  const health = await driveHealthForHour()
  logger.info({ ...health }, 'drive_health_hourly')
  if (health.plays >= 50 && health.rate > 0.01) {
    await sendOwnerAlert('drive-quota', 'Google Drive is limiting video playback', [
      `In the hour ${health.hour}:00 UTC, ${health.quotaErrors} of ${health.plays} video plays (${(health.rate * 100).toFixed(1)}%) hit Google Drive's download quota.`,
      'Learners saw "This video is busy, please try again in a few minutes".',
      'If this keeps happening, the busiest videos need copies in another Drive account (or a separate video host).',
    ])
  }
}

export function registerMonitoringJob(_config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule('2 * * * *', () => checkDriveHealth())
}
