import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, getParam, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { relationId, refreshEnrollmentProgress, requireCourseAccess } from '../../lib/course-access.js'
import { isValidPayloadId } from '../../utils/sanitize.js'
import { AppError } from '../../types/index.js'

const schema = z.object({ answers: z.array(z.object({ questionId: z.number().int().positive(), optionIndex: z.number().int().min(0) })).min(1) })

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const quizId = getParam(req, 'quizId')
  if (!isValidPayloadId(quizId)) throw new AppError('VALIDATION_ERROR', 'Invalid quiz id')
  const { answers } = parseBody(schema, await readJsonBody(req))
  const payload = req.payload
  const quiz = await payload.findByID({ collection: 'quizzes', id: quizId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!quiz || !quiz.isPublished) throw new AppError('NOT_FOUND', 'Quiz not found')
  const courseId = relationId(quiz.course)
  if (courseId === undefined) throw new AppError('NOT_FOUND', 'Quiz course not found')
  await requireCourseAccess(payload, user.id, courseId)
  const questionIds = ((quiz.questions ?? []) as unknown[]).map(relationId).filter((id): id is number | string => id !== undefined)
  if (!questionIds.length || answers.length !== questionIds.length || new Set(answers.map((a) => a.questionId)).size !== questionIds.length) {
    throw new AppError('VALIDATION_ERROR', 'Answer every question exactly once')
  }
  const questions = await Promise.all(questionIds.map((id) => payload.findByID({ collection: 'quiz-questions', id, depth: 0, overrideAccess: true })))
  let correct = 0
  for (const question of questions) {
    const answer = answers.find((item) => String(item.questionId) === String(question.id))
    if (!answer || answer.optionIndex >= (question.options?.length ?? 0)) throw new AppError('VALIDATION_ERROR', 'Invalid quiz answer')
    if (answer.optionIndex === question.correctIndex) correct += 1
  }
  const score = Math.round(correct * 100 / questions.length)
  const passed = score >= quiz.passingScore
  const attempt = await payload.create({ collection: 'quiz-attempts', data: { student: user.id, quiz: quiz.id, score, passed, answers }, overrideAccess: true })
  const enrollments = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: user.id } }, { course: { equals: courseId } }, { status: { not_equals: 'refunded' } }] }, limit: 1, overrideAccess: true })
  if (enrollments.docs[0]) await refreshEnrollmentProgress(payload, enrollments.docs[0].id, user.id, courseId)
  return sendSuccess({ id: attempt.id, score, passed }, undefined, 201)
}

export const quizSubmitEndpoint: Endpoint = { path: '/quizzes/:quizId/submit', method: 'post', handler: asyncHandler(handler) }
