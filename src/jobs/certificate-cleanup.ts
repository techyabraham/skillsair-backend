import cron from 'node-cron'
import { getPayload } from 'payload'
import type { SanitizedConfig } from 'payload'
import { logger } from '../lib/logger.js'
import { deleteCertificatePdf } from '../lib/pdf-certificate.js'

interface CertificateDoc {
  id: number
  certificateCode: string
  student: number | string | { id: number | string }
  course: number | string | { id: number | string }
}

function relationId(value: CertificateDoc['student']): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in value) return value.id
  return value
}

async function cleanupOrphanedCertificates(
  config: Promise<SanitizedConfig> | SanitizedConfig,
): Promise<void> {
  const payload = await getPayload({ config })

  const certificates = await payload.find({
    collection: 'certificates',
    depth: 0,
    limit: 1000,
    overrideAccess: true,
  })

  let removed = 0
  for (const doc of certificates.docs as unknown as CertificateDoc[]) {
    const studentId = relationId(doc.student)
    const courseId = relationId(doc.course)
    if (studentId === undefined || courseId === undefined) continue

    const enrollments = await payload.find({
      collection: 'enrollments',
      where: { and: [{ student: { equals: studentId } }, { course: { equals: courseId } }] },
      limit: 1,
      overrideAccess: true,
    })
    const enrollment = enrollments.docs[0] as unknown as { status: string } | undefined
    const isOrphaned = !enrollment || enrollment.status === 'refunded'
    if (!isOrphaned) continue

    try {
      await deleteCertificatePdf(Number(studentId), doc.certificateCode)
    } catch (err) {
      logger.error({ err, certificateId: doc.id }, 'certificate_pdf_delete_failed')
    }
    await payload.delete({ collection: 'certificates', id: doc.id, overrideAccess: true })
    removed += 1
  }

  logger.info({ checked: certificates.totalDocs, removed }, 'certificate_cleanup_complete')
}

export function registerCertificateCleanupJob(
  config: Promise<SanitizedConfig> | SanitizedConfig,
): void {
  cron.schedule('0 3 * * 0', () => {
    cleanupOrphanedCertificates(config).catch((err: unknown) => {
      logger.error({ err }, 'certificate_cleanup_job_failed')
    })
  })
}
