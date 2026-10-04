import type { GraphQLExtension, PayloadRequest } from 'payload'
import { requireAuth } from '../middleware/authenticate.js'
import { verifyAccessToken } from './jwt.js'
import { isTokenBlacklisted } from './redis.js'
import { AppError, type UserRole } from '../types/index.js'

interface GraphQLResolverContext {
  req: PayloadRequest
}

interface EnrollmentDoc {
  id: number
  status: string
  progressPercent: number
  enrolledAt: string | null
  completedAt: string | null
  course: number | { id: number; title: string; slug: string }
}

interface CourseRef {
  id: number
  title: string
  slug: string
}

interface CourseProgressResult {
  courseId: number
  title: string
  slug: string
  status: string
  progressPercent: number
  enrolledAt: string | null
  completedAt: string | null
}

interface UserDoc {
  accessExpiresAt: string | null | undefined
}

function courseRelation(value: EnrollmentDoc['course']): CourseRef | null {
  if (typeof value === 'object' && value !== null) return value
  return null
}

async function assertCanViewStudent(req: PayloadRequest, studentId: number): Promise<void> {
  const user = await requireAuth(req)
  if (user.id !== studentId && user.role !== 'admin' && user.role !== 'instructor') {
    throw new AppError('INSUFFICIENT_PERMISSION', "You cannot view this student's data")
  }
}

async function loadCoursesWithProgress(
  req: PayloadRequest,
  studentId: number,
): Promise<CourseProgressResult[]> {
  const enrollments = await req.payload.find({
    collection: 'enrollments',
    where: { student: { equals: studentId } },
    depth: 1,
    limit: 200,
    overrideAccess: true,
  })
  return (enrollments.docs as unknown as EnrollmentDoc[]).map((enrollment) => {
    const course = courseRelation(enrollment.course)
    return {
      courseId: course?.id ?? 0,
      title: course?.title ?? '',
      slug: course?.slug ?? '',
      status: enrollment.status,
      progressPercent: enrollment.progressPercent,
      enrolledAt: enrollment.enrolledAt,
      completedAt: enrollment.completedAt,
    }
  })
}

export const graphQLQueries: GraphQLExtension = (graphQL) => {
  const CourseProgressType = new graphQL.GraphQLObjectType({
    name: 'CourseProgress',
    fields: {
      courseId: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLInt) },
      title: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLString) },
      slug: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLString) },
      status: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLString) },
      progressPercent: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLInt) },
      enrolledAt: { type: graphQL.GraphQLString },
      completedAt: { type: graphQL.GraphQLString },
    },
  })

  const StudentDashboardType = new graphQL.GraphQLObjectType({
    name: 'StudentDashboard',
    fields: {
      studentId: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLInt) },
      enrolledCourseCount: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLInt) },
      completedCourseCount: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLInt) },
      certificateCount: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLInt) },
      accessExpiresAt: { type: graphQL.GraphQLString },
      courses: {
        type: new graphQL.GraphQLNonNull(
          new graphQL.GraphQLList(new graphQL.GraphQLNonNull(CourseProgressType)),
        ),
      },
    },
  })

  const TokenVerificationType = new graphQL.GraphQLObjectType({
    name: 'TokenVerification',
    fields: {
      valid: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLBoolean) },
      userId: { type: graphQL.GraphQLInt },
      role: { type: graphQL.GraphQLString },
    },
  })

  return {
    coursesWithProgress: {
      type: new graphQL.GraphQLNonNull(
        new graphQL.GraphQLList(new graphQL.GraphQLNonNull(CourseProgressType)),
      ),
      args: { studentId: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLInt) } },
      resolve: async (
        _source: unknown,
        args: { studentId: number },
        context: GraphQLResolverContext,
      ): Promise<CourseProgressResult[]> => {
        await assertCanViewStudent(context.req, args.studentId)
        return loadCoursesWithProgress(context.req, args.studentId)
      },
    },
    studentDashboard: {
      type: new graphQL.GraphQLNonNull(StudentDashboardType),
      args: { studentId: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLInt) } },
      resolve: async (
        _source: unknown,
        args: { studentId: number },
        context: GraphQLResolverContext,
      ) => {
        await assertCanViewStudent(context.req, args.studentId)
        const courses = await loadCoursesWithProgress(context.req, args.studentId)
        const [studentDoc, certificates] = await Promise.all([
          context.req.payload.findByID({
            collection: 'users',
            id: args.studentId,
            depth: 0,
            overrideAccess: true,
          }) as unknown as Promise<UserDoc>,
          context.req.payload.find({
            collection: 'certificates',
            where: { student: { equals: args.studentId } },
            limit: 1,
            overrideAccess: true,
          }),
        ])
        return {
          studentId: args.studentId,
          enrolledCourseCount: courses.length,
          completedCourseCount: courses.filter((course) => course.status === 'completed').length,
          certificateCount: certificates.totalDocs,
          accessExpiresAt: studentDoc.accessExpiresAt ?? null,
          courses,
        }
      },
    },
    verifyToken: {
      type: new graphQL.GraphQLNonNull(TokenVerificationType),
      args: { token: { type: new graphQL.GraphQLNonNull(graphQL.GraphQLString) } },
      resolve: async (
        _source: unknown,
        args: { token: string },
        context: GraphQLResolverContext,
      ): Promise<{ valid: boolean; userId: number | null; role: UserRole | null }> => {
        try {
          if (await isTokenBlacklisted(args.token)) {
            return { valid: false, userId: null, role: null }
          }
          const payload = verifyAccessToken(args.token)
          const user = await context.req.payload.findByID({ collection: 'users', id: payload.userId, depth: 0, overrideAccess: true }).catch(() => null)
          if (!user || !user.isActive) return { valid: false, userId: null, role: null }
          return { valid: true, userId: Number(user.id), role: user.role }
        } catch {
          return { valid: false, userId: null, role: null }
        }
      },
    },
  }
}
