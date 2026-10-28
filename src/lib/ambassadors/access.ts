/**
 * Who may use the ambassador endpoints (AMBASSADORS.md C1, C2, R3, R4). Ambassador states are
 * reported as INSUFFICIENT_PERMISSION with fields.reason, never as new error codes.
 */
import type { PayloadRequest } from 'payload'
import { requireAuth, resolveAuthUser } from '../../middleware/authenticate.js'
import { AppError, type AuthUser } from '../../types/index.js'
import { logSecurityEvent } from '../logger.js'
import type { AmbassadorDoc } from './types.js'

export type AmbassadorDeniedReason = 'not_ambassador' | 'pending' | 'blocked' | 'email_unverified'

function denied(reason: AmbassadorDeniedReason, message: string): AppError {
  return new AppError('INSUFFICIENT_PERMISSION', message, { reason })
}

/** The signed-in user (app JWT) and their ambassador record, whatever its status, or null. */
export async function loadAmbassadorForUser(req: PayloadRequest): Promise<{ user: AuthUser; ambassador: AmbassadorDoc | null }> {
  const user = await requireAuth(req)
  const result = await req.payload.find({
    collection: 'ambassadors',
    where: { user: { equals: user.id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return { user, ambassador: (result.docs[0] as unknown as AmbassadorDoc | undefined) ?? null }
}

/** An ACTIVE ambassador (with a verified email when they applied themselves); otherwise 403 with the reason. */
export async function requireAmbassador(req: PayloadRequest): Promise<{ user: AuthUser; ambassador: AmbassadorDoc }> {
  const { user, ambassador } = await loadAmbassadorForUser(req)
  if (!ambassador) throw denied('not_ambassador', 'You are not a SkillsAir ambassador.')
  if (ambassador.status === 'blocked') throw denied('blocked', 'Your ambassador account is blocked.')
  if (ambassador.source === 'self' && !ambassador.emailVerifiedAt) throw denied('email_unverified', 'Please verify your email address first.')
  if (ambassador.status === 'pending') throw denied('pending', 'Your ambassador application is being reviewed.')
  return { user, ambassador }
}

/** An admin from Payload's admin session (Studio) or from the app's JWT. */
export async function requireAdmin(req: PayloadRequest): Promise<AuthUser> {
  const session = req.user as { id?: number | string; email?: string; role?: string } | null | undefined
  if (session?.role === 'admin') return { id: Number(session.id), email: String(session.email ?? ''), role: 'admin' }
  const user = await resolveAuthUser(req)
  if (user?.role === 'admin') return user
  if (!session && !user) throw new AppError('AUTH_REQUIRED', 'Authentication is required for this action')
  logSecurityEvent('insufficient_permission', { userId: user?.id ?? session?.id, role: user?.role ?? session?.role, path: req.url })
  throw new AppError('INSUFFICIENT_PERMISSION', 'You do not have permission to perform this action')
}
