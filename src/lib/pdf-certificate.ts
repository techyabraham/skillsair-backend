import PDFDocument from 'pdfkit'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { logger } from './logger.js'

const BRAND_PRIMARY = '#1B5E20'
const BRAND_GOLD = '#D4AF37'

export interface CertificatePdfInput {
  studentFullName: string
  courseTitle: string
  instructorName: string
  completionDate: string
  certificateCode: string
  verificationUrl: string
}

function getS3Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  })
}

export async function generateCertificatePdf(input: CertificatePdfInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const pageWidth = doc.page.width
    const pageHeight = doc.page.height

    doc.rect(0, 0, pageWidth, pageHeight).fill('#FFFFFF')
    doc.lineWidth(6).strokeColor(BRAND_PRIMARY).rect(24, 24, pageWidth - 48, pageHeight - 48).stroke()
    doc.lineWidth(1.5).strokeColor(BRAND_GOLD).rect(40, 40, pageWidth - 80, pageHeight - 80).stroke()

    doc
      .fillColor(BRAND_PRIMARY)
      .font('Helvetica-Bold')
      .fontSize(32)
      .text('SkillsAir', 0, 80, { align: 'center' })

    doc
      .fillColor('#52525b')
      .font('Helvetica')
      .fontSize(16)
      .text('Certificate of Completion', 0, 130, { align: 'center' })

    doc
      .fillColor('#27272a')
      .font('Helvetica')
      .fontSize(14)
      .text('This certifies that', 0, 190, { align: 'center' })

    doc
      .fillColor(BRAND_PRIMARY)
      .font('Helvetica-Bold')
      .fontSize(36)
      .text(input.studentFullName, 0, 220, { align: 'center' })

    doc
      .fillColor('#27272a')
      .font('Helvetica')
      .fontSize(14)
      .text('has successfully completed the course', 0, 280, { align: 'center' })

    doc
      .fillColor('#18181b')
      .font('Helvetica-Bold')
      .fontSize(22)
      .text(input.courseTitle, 60, 310, { align: 'center', width: pageWidth - 120 })

    doc
      .fillColor('#52525b')
      .font('Helvetica')
      .fontSize(12)
      .text(`Completed on ${input.completionDate}`, 0, 365, { align: 'center' })

    const signatureY = pageHeight - 130
    doc
      .moveTo(pageWidth / 2 - 140, signatureY)
      .lineTo(pageWidth / 2 + 140, signatureY)
      .strokeColor('#a1a1aa')
      .lineWidth(1)
      .stroke()
    doc
      .fillColor('#27272a')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(input.instructorName, pageWidth / 2 - 140, signatureY + 6, { width: 280, align: 'center' })
    doc
      .fillColor('#71717a')
      .font('Helvetica')
      .fontSize(10)
      .text('Instructor', pageWidth / 2 - 140, signatureY + 22, { width: 280, align: 'center' })

    doc
      .fillColor('#71717a')
      .font('Helvetica')
      .fontSize(9)
      .text(`Certificate Code: ${input.certificateCode}`, 60, pageHeight - 50)
    doc
      .fillColor('#71717a')
      .font('Helvetica')
      .fontSize(9)
      .text(`Verify at: ${input.verificationUrl}`, 0, pageHeight - 50, {
        align: 'right',
        width: pageWidth - 120,
      })

    doc.end()
  })
}

export async function uploadCertificatePdf(
  userId: number,
  certificateCode: string,
  pdfBuffer: Buffer,
): Promise<string> {
  const bucket = process.env.R2_BUCKET
  if (!bucket) throw new Error('R2_BUCKET is not configured')
  const key = `certificates/${userId}/${certificateCode}.pdf`

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      CacheControl: 'private, max-age=0',
    }),
  )

  logger.info({ userId, certificateCode, key }, 'certificate_pdf_uploaded')
  const publicUrl = process.env.R2_PUBLIC_URL ?? ''
  return `${publicUrl}/${key}`
}

export async function deleteCertificatePdf(userId: number, certificateCode: string): Promise<void> {
  const bucket = process.env.R2_BUCKET
  if (!bucket) throw new Error('R2_BUCKET is not configured')
  const key = `certificates/${userId}/${certificateCode}.pdf`
  await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  logger.info({ userId, certificateCode, key }, 'certificate_pdf_deleted')
}
