import type { PayloadRequest } from 'payload'
import { AppError, type AuthUser, type UserRole } from '../types/index.js'
import { requireAuth } from './authenticate.js'
import { logSecurityEvent } from '../lib/logger.js'

export async function requireRole(req: PayloadRequest, allowedRoles: UserRole[]): Promise<AuthUser> {
  const user = await requireAuth(req)
  if (!allowedRoles.includes(user.role)) {
    logSecurityEvent('insufficient_permission', { userId: user.id, role: user.role, path: req.url })
    throw new AppError('INSUFFICIENT_PERMISSION', 'You do not have permission to perform this action')
  }
  return user
}

export async function requireAdmin(req: PayloadRequest): Promise<AuthUser> {
  return requireRole(req, ['admin'])
}

export async function requireInstructorOrAdmin(req: PayloadRequest): Promise<AuthUser> {
  return requireRole(req, ['admin', 'instructor'])
}
