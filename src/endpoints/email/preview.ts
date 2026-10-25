import type { Endpoint, PayloadRequest } from 'payload'
import { asyncHandler, getParam, sendSuccess } from '../../middleware/validate.js'
import { requireAdmin } from '../../middleware/authorize.js'
import { emailTemplates } from '../../emails/index.js'
import { escapeHtml } from '../../emails/layout.js'
import { AppError } from '../../types/index.js'
import { ensureOverrideStore } from '../../emails/override-store.js'

/**
 * GET /api/email/preview/:template (admins only): renders a template with its sample data.
 * ?format=text returns the plain-text part; ?format=json returns subject, preheader and text;
 * "index" lists every template. Shows the published wording (Studio → Emails).
 */
async function preview(req: PayloadRequest): Promise<Response> {
  // Studio opens this with its session cookie; API clients use a bearer token.
  if ((req.user as { role?: string } | null | undefined)?.role !== 'admin') await requireAdmin(req)
  await ensureOverrideStore(req.payload)
  const id = getParam(req, 'template')
  const format = new URL(req.url ?? '', 'http://localhost').searchParams.get('format') ?? 'html'
  if (id === 'index') {
    const items = Object.values(emailTemplates).map((template) => {
      const rendered = template.renderSample()
      return { id: template.id, kind: template.kind, track: template.track, stepId: template.stepId, subject: rendered.subject, preheader: rendered.preheader }
    })
    if (format === 'json') return sendSuccess(items)
    const rows = items
      .map((item) => `<tr><td><a href="./${encodeURIComponent(item.id)}">${escapeHtml(item.id)}</a></td><td>${item.kind}</td><td>${escapeHtml(item.stepId)}</td><td>${escapeHtml(item.subject)}<br /><small>${escapeHtml(item.preheader)}</small></td></tr>`)
      .join('')
    return new Response(`<!DOCTYPE html><meta charset="utf-8"><title>Email previews</title><table cellpadding="6">${rows}</table>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  const template = emailTemplates[id]
  if (!template) throw new AppError('NOT_FOUND', 'No email template with that name')
  const rendered = template.renderSample()
  if (format === 'json') return sendSuccess({ id, kind: template.kind, subject: rendered.subject, preheader: rendered.preheader, text: rendered.text })
  if (format === 'text') return new Response(rendered.text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  return new Response(rendered.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export const emailPreviewEndpoint: Endpoint = { path: '/email/preview/:template', method: 'get', handler: asyncHandler(preview) }
