import type { CollectionConfig, Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { resolveAuthUser, requireAuth } from '../middleware/authenticate.js'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../middleware/validate.js'
import { getScholarshipWindow, type ScholarshipWindowState } from '../lib/pricing.js'
import { sanitizeText } from '../utils/sanitize.js'
import { AppError } from '../types/index.js'

const isAdmin = ({ req }: { req: { user?: unknown } }) => (req.user as { role?: string } | null | undefined)?.role === 'admin'

interface CertificateRow {
  id: number
  certificateCode: string
  issuedAt?: string | null
  createdAt: string
  course?: { title?: string } | number | null
}

/** A certificate issued within the cohort period makes the learner eligible. */
async function eligibleCertificate(req: PayloadRequest, userId: number, window: ScholarshipWindowState): Promise<CertificateRow | null> {
  if (!window.cohortStartsAt || !window.cohortEndsAt) return null
  const result = await req.payload.find({
    collection: 'certificates',
    where: { student: { equals: userId } },
    sort: '-createdAt',
    limit: 50,
    depth: 1,
    overrideAccess: true,
  })
  const start = new Date(window.cohortStartsAt).getTime()
  // Certificates for cohort learners are often issued after the enrolment period ends; allow 3 extra months.
  const end = new Date(window.cohortEndsAt).getTime() + 92 * 24 * 60 * 60 * 1000
  return (
    (result.docs as unknown as CertificateRow[]).find((certificate) => {
      const issued = new Date(certificate.issuedAt ?? certificate.createdAt).getTime()
      return issued >= start && issued <= end
    }) ?? null
  )
}

async function existingApplication(req: PayloadRequest, userId: number, cohortLabel: string) {
  const result = await req.payload.find({
    collection: 'laptop-applications',
    where: { and: [{ user: { equals: userId } }, { cohortLabel: { equals: cohortLabel } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs[0] ?? null
}

async function mine(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const window = await getScholarshipWindow(req.payload)
  const cohortLabel = window.cohortLabel ?? ''
  const certificate = await eligibleCertificate(req, user.id, window)
  const application = cohortLabel ? await existingApplication(req, user.id, cohortLabel) : null
  return sendSuccess({
    cohortLabel,
    laptopsPerCohort: window.laptopsPerCohort ?? 2,
    eligible: Boolean(certificate && cohortLabel),
    certificate: certificate
      ? { code: certificate.certificateCode, course: typeof certificate.course === 'object' ? certificate.course?.title ?? '' : '' }
      : null,
    application: application ? { id: application.id, status: application.status, submittedAt: application.createdAt } : null,
  })
}

const applySchema = z.object({
  story: z.string().trim().min(150, 'Tell us a bit more (at least 150 characters).').max(1500),
  currentDevice: z.enum(['none', 'phone_only', 'shared_laptop', 'old_laptop']),
  plannedUse: z.string().trim().min(20, 'Tell us how you will use it (at least 20 characters).').max(1500),
  consentToFeature: z.boolean().optional(),
})

async function apply(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const body = parseBody(applySchema, await readJsonBody(req))
  const window = await getScholarshipWindow(req.payload)
  const cohortLabel = window.cohortLabel ?? ''
  if (!cohortLabel) throw new AppError('VALIDATION_ERROR', 'Laptop support applications are not open right now.')
  const certificate = await eligibleCertificate(req, user.id, window)
  if (!certificate) {
    throw new AppError('INSUFFICIENT_PERMISSION', 'Laptop support is for learners who hold their SkillsAir certificate from this cohort.')
  }
  if (await existingApplication(req, user.id, cohortLabel)) {
    throw new AppError('ALREADY_EXISTS', 'You have already applied for laptop support this cohort.')
  }
  const created = await req.payload.create({
    collection: 'laptop-applications',
    data: {
      user: user.id,
      cohortLabel,
      certificate: certificate.id,
      story: sanitizeText(body.story),
      currentDevice: body.currentDevice,
      plannedUse: sanitizeText(body.plannedUse),
      consentToFeature: body.consentToFeature === true,
      status: 'submitted',
    },
    depth: 0,
    overrideAccess: true,
  })
  return sendSuccess({ id: created.id, status: 'submitted' }, undefined, 201)
}

const mineEndpoint: Endpoint = { path: '/mine', method: 'get', handler: asyncHandler(mine) }
const applyEndpoint: Endpoint = { path: '/apply', method: 'post', handler: asyncHandler(apply) }

export const LaptopApplications: CollectionConfig = {
  slug: 'laptop-applications',
  admin: {
    group: 'People',
    useAsTitle: 'cohortLabel',
    defaultColumns: ['user', 'cohortLabel', 'currentDevice', 'status', 'createdAt'],
    description: 'Laptop support (FCCPC-approved): 2 per cohort, certified graduates only, awarded to the greatest need.',
  },
  endpoints: [mineEndpoint, applyEndpoint],
  access: {
    read: async ({ req }) => {
      const user = req.user ?? (await resolveAuthUser(req))
      if (user?.role === 'admin') return true
      if (user) return { user: { equals: user.id } }
      return false
    },
    // Learners apply through POST /api/laptop-applications/apply, which checks eligibility.
    create: () => false,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'cohortLabel', type: 'text', required: true, index: true },
    { name: 'certificate', type: 'relationship', relationTo: 'certificates', required: true },
    {
      name: 'story',
      type: 'textarea',
      required: true,
      minLength: 150,
      maxLength: 1500,
      admin: { description: 'Tell us your story and why you need a laptop.' },
    },
    {
      name: 'currentDevice',
      type: 'select',
      required: true,
      options: [
        { label: 'No device', value: 'none' },
        { label: 'Phone only', value: 'phone_only' },
        { label: 'Shared laptop', value: 'shared_laptop' },
        { label: 'Old or faulty laptop', value: 'old_laptop' },
      ],
    },
    { name: 'plannedUse', type: 'textarea', required: true, maxLength: 1500, admin: { description: 'What will you do with it?' } },
    {
      name: 'consentToFeature',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'If selected, SkillsAir may share their first name, photo and story.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'submitted',
      options: [
        { label: 'Submitted', value: 'submitted' },
        { label: 'Shortlisted', value: 'shortlisted' },
        { label: 'Awarded', value: 'awarded' },
        { label: 'Not selected', value: 'not_selected' },
      ],
    },
    { name: 'reviewNotes', type: 'textarea', access: { read: isAdmin, update: isAdmin, create: isAdmin } },
  ],
  timestamps: true,
}
