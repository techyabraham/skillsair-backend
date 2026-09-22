import type { Endpoint, PayloadRequest } from 'payload'
import { sendSuccess, asyncHandler, getParam } from '../../middleware/validate.js'
import { AppError } from '../../types/index.js'

interface CertificateDoc {
  certificateCode: string
  issuedAt: string
  student: { firstName: string; lastName: string } | number | string
  course: { title: string } | number | string
}

async function handler(req: PayloadRequest): Promise<Response> {
  const code = getParam(req, 'code')
  const payload = req.payload

  const result = await payload.find({
    collection: 'certificates',
    where: { certificateCode: { equals: code } },
    limit: 1,
    depth: 1,
    overrideAccess: true,
  })
  const certificate = result.docs[0] as unknown as CertificateDoc | undefined
  if (!certificate) {
    throw new AppError('NOT_FOUND', 'Certificate not found or invalid')
  }

  const student = certificate.student
  const course = certificate.course
  return sendSuccess({
    valid: true,
    certificateCode: certificate.certificateCode,
    issuedAt: certificate.issuedAt,
    studentName: typeof student === 'object' ? `${student.firstName} ${student.lastName}` : undefined,
    courseTitle: typeof course === 'object' ? course.title : undefined,
  })
}

export const verifyCertificateEndpoint: Endpoint = {
  path: '/certificates/verify/:code',
  method: 'get',
  handler: asyncHandler(handler),
}
