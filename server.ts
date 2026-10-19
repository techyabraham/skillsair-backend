import express from 'express'
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { Readable } from 'node:stream'
import { loadEnv } from 'payload/node'
import { handleEndpoints } from 'payload'

import { generalApiRateLimiter } from './src/lib/rate-limiter.js'
import { securityHeaders } from './src/middleware/security-headers.js'
import { logger } from './src/lib/logger.js'

await loadEnv()

const { default: config } = await import('./payload.config.js')

const { registerSubscriptionRenewalJob } = await import('./src/jobs/subscription-renewal.js')
const { registerAccessExpiryJob } = await import('./src/jobs/access-expiry.js')
const { registerCertificateCleanupJob } = await import('./src/jobs/certificate-cleanup.js')
const { registerOrderFulfillmentJob } = await import('./src/jobs/order-fulfillment.js')
const { registerLeadDailySummaryJob } = await import('./src/jobs/lead-daily-summary.js')
const { registerLifecycleJob } = await import('./src/jobs/lifecycle.js')
const { registerScholarshipWindowJob } = await import('./src/jobs/scholarship-window.js')

const app = express()
const PORT = Number(process.env.PORT ?? 3001)

app.set('trust proxy', 1)
app.use(helmet())
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    credentials: true,
  }),
)
// Signed provider webhooks (Meta sends every delivery status) must not share the per-IP budget.
const SIGNED_WEBHOOK_PATHS = new Set(['/api/whatsapp/webhook'])
app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
  if (SIGNED_WEBHOOK_PATHS.has(req.path)) return next()
  return generalApiRateLimiter(req, res, next)
})
app.use(securityHeaders)
app.use((req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
  logger.info({ method: req.method, url: req.originalUrl }, 'incoming_request')
  next()
})

app.get('/health', (_req: ExpressRequest, res: ExpressResponse) => {
  res.json({ status: 'ok' })
})

function buildFetchHeaders(expressReq: ExpressRequest): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(expressReq.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

async function bufferRequestBody(expressReq: ExpressRequest): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of expressReq) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

app.use(async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
  try {
    const url = `${req.protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl}`
    const headers = buildFetchHeaders(req)
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const body = hasBody ? await bufferRequestBody(req) : undefined

    const fetchRequest = new Request(url, {
      method: req.method,
      headers,
      ...(body !== undefined ? { body } : {}),
    })

    const response = await handleEndpoints({ config, request: fetchRequest })

    res.status(response.status)
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    if (response.body) {
      Readable.fromWeb(response.body).pipe(res)
    } else {
      res.end()
    }
  } catch (err) {
    next(err)
  }
})

app.use((req: ExpressRequest, res: ExpressResponse) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.originalUrl}` },
  })
})

app.use((err: unknown, _req: ExpressRequest, res: ExpressResponse, _next: NextFunction) => {
  logger.error({ err }, 'unhandled_server_error')
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  })
})

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'server_started')
  if (process.env.NODE_ENV === 'production') {
    registerSubscriptionRenewalJob(config)
    registerAccessExpiryJob(config)
    registerCertificateCleanupJob(config)
    registerOrderFulfillmentJob(config)
    registerLeadDailySummaryJob(config)
    registerLifecycleJob(config)
    registerScholarshipWindowJob(config)
    logger.info({}, 'background_jobs_registered')
  }
})
