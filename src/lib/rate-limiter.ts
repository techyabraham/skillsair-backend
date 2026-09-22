import type { NextFunction, Request, Response } from 'express'
import type { PayloadRequest } from 'payload'
import { checkRateLimit } from './redis.js'
import { logSecurityEvent } from './logger.js'
import { AppError } from '../types/index.js'
import { getClientIp } from '../middleware/validate.js'

function clientIpExpress(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

/**
 * Broad, IP-keyed limiter applied to *all* inbound traffic at the Express layer,
 * before requests are bridged into Payload (covers custom endpoints and Payload's
 * own native REST/GraphQL routes alike).
 */
export function generalApiRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const limit = 300
  const windowSeconds = 15 * 60
  const key = `general:${clientIpExpress(req)}`
  checkRateLimit(key, limit, windowSeconds)
    .then((result) => {
      res.setHeader('X-RateLimit-Limit', String(limit))
      res.setHeader('X-RateLimit-Remaining', String(result.remaining))
      if (!result.allowed) {
        logSecurityEvent('rate_limited', { path: req.path, key })
        res.setHeader('Retry-After', String(result.retryAfterSeconds))
        res.status(429).json({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
        })
        return
      }
      next()
    })
    .catch(() => next())
}

export interface PayloadRateLimiter {
  /** Throws a RATE_LIMITED AppError if the bucket for this request is exhausted. */
  check(req: PayloadRequest, identityId?: number | string): Promise<void>
}

function createPayloadRateLimiter(name: string, limit: number, windowSeconds: number): PayloadRateLimiter {
  return {
    async check(req, identityId) {
      const key = `${name}:${identityId !== undefined ? String(identityId) : getClientIp(req)}`
      const result = await checkRateLimit(key, limit, windowSeconds)
      if (!result.allowed) {
        logSecurityEvent('rate_limited', { name, key })
        throw new AppError('RATE_LIMITED', 'Too many requests. Please try again later.')
      }
    },
  }
}

export const authRateLimiter = createPayloadRateLimiter('auth', 10, 15 * 60)
export const paymentRateLimiter = createPayloadRateLimiter('payment', 20, 60 * 60)
export const streamRateLimiter = createPayloadRateLimiter('stream', 100, 60 * 60)
export const adminRateLimiter = createPayloadRateLimiter('admin', 60, 15 * 60)
