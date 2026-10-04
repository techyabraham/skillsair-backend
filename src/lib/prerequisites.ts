import type { Payload } from 'payload'
import { AppError } from '../types/index.js'
import { relationId } from './course-access.js'

export async function requirePrerequisites(payload: Payload, studentId: number | string, courseId: number | string): Promise<void> {
  const course = await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true })
  const required = ((course.prerequisites ?? []) as unknown[]).map(relationId).filter((id): id is number | string => id !== undefined)
  if (!required.length) return
  const completed = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: studentId } }, { course: { in: required } }, { status: { equals: 'completed' } }] }, limit: required.length, depth: 0, overrideAccess: true })
  const ids = new Set(completed.docs.map((doc) => String(relationId(doc.course))))
  if (required.some((id) => !ids.has(String(id)))) throw new AppError('INSUFFICIENT_PERMISSION', 'Complete the prerequisite courses first')
}
