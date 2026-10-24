/**
 * Error reporting to Sentry or a self-hosted GlitchTip (same protocol): set SENTRY_DSN to switch
 * it on. Without a DSN every call is a no-op. Only unexpected errors are reported (not AppErrors
 * such as validation or permission failures); request bodies, cookies and auth headers are never sent.
 */
import * as Sentry from '@sentry/node'

let enabled = false

export function initObservability(role: string): void {
  const dsn = process.env.SENTRY_DSN?.trim()
  if (!dsn || enabled) return
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SOURCE_COMMIT ?? process.env.GIT_SHA ?? undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    sendDefaultPii: false,
    initialScope: { tags: { role: role || 'api+jobs' } },
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies
        delete event.request.data
        if (event.request.headers) {
          for (const header of Object.keys(event.request.headers)) if (/authorization|cookie|x-skillsair/i.test(header)) delete event.request.headers[header]
        }
      }
      return event
    },
  })
  enabled = true
}

export function captureError(err: unknown, context: Record<string, string | number | boolean | null | undefined> = {}): void {
  if (!enabled) return
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) if (value !== undefined) scope.setTag(key, String(value))
    Sentry.captureException(err)
  })
}

/** Flushes queued events before the process exits (deploys, crashes). */
export async function flushObservability(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs).catch(() => undefined)
}
