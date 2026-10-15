import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'
import crypto from 'node:crypto'
import type { AccessTokenPayload, RefreshTokenPayload, UserRole } from '../types/index.js'

function getSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long')
  }
  return secret
}

const ACCESS_EXPIRY = (process.env.JWT_ACCESS_EXPIRY ?? '7d') as unknown as SignOptions['expiresIn']
const REFRESH_EXPIRY = (process.env.JWT_REFRESH_EXPIRY ?? '30d') as unknown as SignOptions['expiresIn']

export function signAccessToken(userId: number, role: UserRole): string {
  const payload: AccessTokenPayload = { userId, role, type: 'access' }
  return jwt.sign(payload, getSecret(), { expiresIn: ACCESS_EXPIRY, algorithm: 'HS256' })
}

export function signRefreshToken(userId: number, role: UserRole): string {
  const payload: RefreshTokenPayload = { userId, role, type: 'refresh', jti: crypto.randomUUID() }
  return jwt.sign(payload, getSecret(), { expiresIn: REFRESH_EXPIRY, algorithm: 'HS256' })
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, getSecret(), { algorithms: ['HS256'] })
  if (typeof decoded === 'string' || decoded.type !== 'access') {
    throw new jwt.JsonWebTokenError('Not an access token')
  }
  return decoded as unknown as AccessTokenPayload
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, getSecret(), { algorithms: ['HS256'] })
  if (typeof decoded === 'string' || decoded.type !== 'refresh') {
    throw new jwt.JsonWebTokenError('Not a refresh token')
  }
  return decoded as unknown as RefreshTokenPayload
}

export function decodeTokenExpirySeconds(token: string): number {
  const decoded = jwt.decode(token)
  if (!decoded || typeof decoded === 'string' || !decoded.exp) return 0
  return Math.max(decoded.exp - Math.floor(Date.now() / 1000), 0)
}

export function generateAuthTokenPair(userId: number, role: UserRole): {
  authToken: string
  refreshToken: string
} {
  return {
    authToken: signAccessToken(userId, role),
    refreshToken: signRefreshToken(userId, role),
  }
}

export interface LeadTokenPayload {
  leadId: number
  type: 'lead'
  scope: 'lead'
}

const LEAD_EXPIRY = '30d' as unknown as SignOptions['expiresIn']

/** Lead tokens identify an applicant before they have an account. They are never accepted as user tokens. */
export function signLeadToken(leadId: number): string {
  const payload: LeadTokenPayload = { leadId, type: 'lead', scope: 'lead' }
  return jwt.sign(payload, getSecret(), { expiresIn: LEAD_EXPIRY, algorithm: 'HS256' })
}

export function verifyLeadToken(token: string): LeadTokenPayload {
  const decoded = jwt.verify(token, getSecret(), { algorithms: ['HS256'] })
  if (typeof decoded === 'string' || decoded.type !== 'lead' || decoded.scope !== 'lead') {
    throw new jwt.JsonWebTokenError('Not a lead token')
  }
  return decoded as unknown as LeadTokenPayload
}
