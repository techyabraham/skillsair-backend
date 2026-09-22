import type { NextFunction, Request, Response } from 'express'

/** Extra security headers beyond helmet's defaults, applied to every response at the Express layer. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
}

/** Headers specific to streamed paid video content: never cache, never prompt download. */
export function streamSecurityHeaders(headers: Headers): void {
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Disposition', 'inline')
}
