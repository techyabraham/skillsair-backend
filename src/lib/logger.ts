import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'

export const logger = pino({
  level: isProduction ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.cardNumber',
      '*.cvv',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

export function logSecurityEvent(
  event:
    | 'failed_login'
    | 'account_locked'
    | 'rate_limited'
    | 'invalid_token'
    | 'webhook_signature_failure'
    | 'access_expired'
    | 'insufficient_permission',
  details: Record<string, unknown>,
): void {
  logger.warn({ securityEvent: event, ...details }, `security_event:${event}`)
}
