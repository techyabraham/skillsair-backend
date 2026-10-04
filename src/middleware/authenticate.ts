import type { PayloadRequest } from 'payload'
import { verifyAccessToken } from '../lib/jwt.js'
import { isTokenBlacklisted } from '../lib/redis.js'
import { AppError, type AuthUser } from '../types/index.js'
import { logSecurityEvent } from '../lib/logger.js'

function extractBearerToken(req: PayloadRequest): string | null {
  const header = req.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

/** Resolves the authenticated user from our custom JWT, or null if absent/invalid. Never throws. */
export async function resolveAuthUser(req: PayloadRequest): Promise<AuthUser | null> {
  const token = extractBearerToken(req)
  if (!token) return null
  try {
    if (await isTokenBlacklisted(token)) return null
    const payload = verifyAccessToken(token)
    const user = await req.payload.findByID({ collection: 'users', id: payload.userId, depth: 0, overrideAccess: true }).catch(() => null)
    if (!user || !user.isActive) return null
    return { id: Number(user.id), email: user.email, role: user.role }
  } catch {
    logSecurityEvent('invalid_token', { path: req.url })
    return null
  }
}

export async function requireAuth(req: PayloadRequest): Promise<AuthUser> {
  const user = await resolveAuthUser(req)
  if (!user) {
    throw new AppError('AUTH_REQUIRED', 'Authentication is required for this action')
  }
  return user
}

export function getBearerToken(req: PayloadRequest): string {
  const token = extractBearerToken(req)
  if (!token) {
    throw new AppError('AUTH_REQUIRED', 'Authentication is required for this action')
  }
  return token
}
