import crypto from 'node:crypto'
import { logger } from './logger.js'

/**
 * Meta WhatsApp Cloud API client. Every send is a no-op unless WHATSAPP_ENABLED is
 * exactly "true", so development and tests never message real people.
 */

export interface TemplateParameter {
  type: 'text' | 'payload'
  text?: string
  payload?: string
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button'
  sub_type?: 'url' | 'quick_reply'
  index?: string
  parameters: TemplateParameter[]
}

export interface WhatsAppSendResult {
  sent: boolean
  skipped?: 'disabled' | 'not_configured'
  messageId?: string
  error?: string
}

export function whatsappEnabled(): boolean {
  return process.env.WHATSAPP_ENABLED === 'true'
}

function endpoint(): string | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const version = process.env.WHATSAPP_API_VERSION || '21.0'
  if (!phoneNumberId || !process.env.WHATSAPP_ACCESS_TOKEN) return null
  return `https://graph.facebook.com/v${version.replace(/^v/, '')}/${phoneNumberId}/messages`
}

/** The Graph API wants the number without the leading "+". */
function toWaId(e164: string): string {
  return e164.replace(/^\+/, '')
}

async function post(body: Record<string, unknown>, attempt = 1): Promise<WhatsAppSendResult> {
  if (!whatsappEnabled()) return { sent: false, skipped: 'disabled' }
  const url = endpoint()
  if (!url) {
    logger.warn({}, 'whatsapp_not_configured')
    return { sent: false, skipped: 'not_configured' }
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    })
    if (response.status >= 500 && attempt === 1) return post(body, 2)
    const result = (await response.json().catch(() => null)) as
      | { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } }
      | null
    if (!response.ok) {
      const error = result?.error?.message || `WhatsApp API error (${response.status})`
      logger.error({ status: response.status, code: result?.error?.code }, 'whatsapp_send_failed')
      return { sent: false, error }
    }
    return { sent: true, messageId: result?.messages?.[0]?.id }
  } catch (err) {
    if (attempt === 1) return post(body, 2)
    logger.error({ err }, 'whatsapp_send_failed')
    return { sent: false, error: err instanceof Error ? err.message : 'WhatsApp request failed' }
  }
}

export function sendTemplate(
  toE164: string,
  name: string,
  lang = 'en',
  components: TemplateComponent[] = [],
): Promise<WhatsAppSendResult> {
  return post({
    to: toWaId(toE164),
    type: 'template',
    template: { name, language: { code: lang }, ...(components.length ? { components } : {}) },
  })
}

/** Free-form text. Only valid inside the 24-hour window that opens when the person messages us. */
export function sendText(toE164: string, body: string): Promise<WhatsAppSendResult> {
  return post({ to: toWaId(toE164), type: 'text', text: { preview_url: true, body } })
}

export function bodyParams(...values: string[]): TemplateComponent {
  return { type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }
}

export function urlButton(index: number, suffix: string): TemplateComponent {
  return { type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text: suffix }] }
}

export function quickReplyButton(index: number, payload: string): TemplateComponent {
  return { type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] }
}

/** Verifies Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifyWhatsAppSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret || !header?.startsWith('sha256=')) return false
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8')
  const actual = Buffer.from(header.slice('sha256='.length), 'utf8')
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}
