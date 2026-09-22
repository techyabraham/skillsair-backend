import cron from 'node-cron'
import { getPayload } from 'payload'
import type { SanitizedConfig } from 'payload'
import { logger } from '../lib/logger.js'

interface UserDoc {
  id: number
  email: string
  accessExpiresAt: string | null | undefined
}

async function auditExpiredAccess(config: Promise<SanitizedConfig> | SanitizedConfig): Promise<void> {
  const payload = await getPayload({ config })

  const expired = await payload.find({
    collection: 'users',
    where: {
      and: [
        { accessExpiresAt: { exists: true } },
        { accessExpiresAt: { less_than: new Date().toISOString() } },
      ],
    },
    depth: 0,
    limit: 500,
    overrideAccess: true,
  })

  for (const doc of expired.docs as unknown as UserDoc[]) {
    logger.info({ userId: doc.id, accessExpiresAt: doc.accessExpiresAt }, 'user_access_expired')
  }

  logger.info({ expiredCount: expired.totalDocs }, 'access_expiry_audit_complete')
}

export function registerAccessExpiryJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule('30 2 * * *', () => {
    auditExpiredAccess(config).catch((err: unknown) => {
      logger.error({ err }, 'access_expiry_job_failed')
    })
  })
}
