import type { PayloadRequest } from 'payload'
import type { ZodSchema, ZodError } from 'zod'
import { AppError } from '../types/index.js'
import { logger } from '../lib/logger.js'

function fieldsFromZodError(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    fields[key] = issue.message
  }
  return fields
}

/** Parses and validates a request body against a Zod schema, throwing a VALIDATION_ERROR AppError on failure. */
export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Request validation failed', fieldsFromZodError(result.error))
  }
  return result.data
}

/** Reads and JSON-parses the request body. Returns {} for empty bodies. */
export async function readJsonBody(req: PayloadRequest): Promise<unknown> {
  if (typeof req.json !== 'function') return {}
  try {
    return await req.json()
  } catch {
    return {}
  }
}

type HeadersInit = Record<string, string> | [string, string][] | Headers

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  })
}

export function sendSuccess<T>(data: T, meta?: Record<string, unknown>, status = 200): Response {
  return jsonResponse({ success: true, data, ...(meta ? { meta } : {}) }, status)
}

export function sendErrorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return jsonResponse(
      {
        success: false,
        error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) },
      },
      err.status,
    )
  }
  logger.error({ err }, 'unhandled_endpoint_error')
  return jsonResponse(
    { success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
    500,
  )
}

/** Reads a `:param` route segment populated by Payload's path-to-regexp matching. */
export function getParam(req: PayloadRequest, name: string): string {
  const value = req.routeParams?.[name]
  if (typeof value !== 'string' || !value) {
    throw new AppError('VALIDATION_ERROR', `Missing required route parameter: ${name}`)
  }
  return value
}

/** Best-effort client IP, trusting X-Forwarded-For/X-Real-IP set by the upstream Express layer. */
export function getClientIp(req: PayloadRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown'
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export type PayloadEndpointHandler = (req: PayloadRequest) => Promise<Response>

/** Wraps an async Payload endpoint handler so thrown AppErrors/unknown errors become the standard envelope. */
export function asyncHandler(handler: PayloadEndpointHandler): PayloadEndpointHandler {
  return async (req: PayloadRequest): Promise<Response> => {
    try {
      return await handler(req)
    } catch (err) {
      return sendErrorResponse(err)
    }
  }
}
