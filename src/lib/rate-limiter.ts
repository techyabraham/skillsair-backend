import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { PayloadRequest } from 'payload'
import { checkRateLimit } from './redis.js'
import { logSecurityEvent } from './logger.js'
import { AppError } from '../types/index.js'
import { getClientIp, trustedBffClientIp } from '../middleware/validate.js'

function clientIpExpress(req: Request): string {
  const bffClientIp = trustedBffClientIp({ get: (name) => req.get(name) ?? null })
  if (bffClientIp) return bffClientIp
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

/**
 * Sign-in, sign-up and session refresh. Counted per account first, so one shared IP (the frontend
 * server, when BFF_SHARED_SECRET is missing or doesn't match) can never lock every learner out:
 * - per account: 10 sign-ins or sign-ups per email in 15 minutes (with the failed-login lock in
 *   redis.ts on top), 30 refreshes per user in 15 minutes;
 * - per visitor IP: a looser cap against one machine trying many accounts.
 */
export const authAccountRateLimiter = createPayloadRateLimiter('auth-account', 10, 15 * 60)
export const authIpRateLimiter = createPayloadRateLimiter('auth-ip', 100, 15 * 60)
export const refreshUserRateLimiter = createPayloadRateLimiter('auth-refresh', 30, 15 * 60)
export const refreshIpRateLimiter = createPayloadRateLimiter('auth-refresh-ip', 300, 15 * 60)

/** An email as a rate-limit identity: hashed, so addresses never appear in Redis keys or logs. */
export function accountIdentity(email: string): string {
  return `email:${crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24)}`
}
export const paymentRateLimiter = createPayloadRateLimiter('payment', 20, 60 * 60)
export const streamRateLimiter = createPayloadRateLimiter('stream', 100, 60 * 60)
export const captionsRateLimiter = createPayloadRateLimiter('captions', 600, 60 * 60)
// Quizzes: starts and submits are rare; autosave runs about every 5 seconds during an exam.
export const quizStartRateLimiter = createPayloadRateLimiter('quiz-start', 30, 15 * 60)
export const quizSaveRateLimiter = createPayloadRateLimiter('quiz-save', 1200, 60 * 60)
/** Guided plan: reads from the dashboard, plan page and player; pace changes and resets are rare. */
export const planReadRateLimiter = createPayloadRateLimiter('plan', 300, 15 * 60)
export const planWriteRateLimiter = createPayloadRateLimiter('plan-write', 20, 60 * 60)
export const adminRateLimiter = createPayloadRateLimiter('admin', 60, 15 * 60)
/** One call per 50 emails: a 1,000-email run from Studio is 20 calls. */
export const manualEnrolRateLimiter = createPayloadRateLimiter('manual-enrol', 60, 15 * 60)
export const ambassadorWithdrawRateLimiter = createPayloadRateLimiter('ambassador-withdraw', 5, 60 * 60)
export const leadRateLimiter = createPayloadRateLimiter('lead', 10, 15 * 60)
export const leadResumeRateLimiter = createPayloadRateLimiter('lead-resume', 30, 15 * 60)
export const leadUpdateRateLimiter = createPayloadRateLimiter('lead-update', 60, 15 * 60)
/** Preference centre reads and saves, per person in the signed link. */
export const emailPrefsRateLimiter = createPayloadRateLimiter('email-prefs', 30, 15 * 60)
/** Webhooks from email providers, per source IP (Resend sends in bursts). */
export const emailWebhookRateLimiter = createPayloadRateLimiter('email-webhook', 600, 60)
/** For endpoint files that define their own bucket (e.g. the Studio email editor). */
export const createPayloadRateLimiterFor = createPayloadRateLimiter
