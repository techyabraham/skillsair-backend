import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { preferencesUrl } from '../../lib/email-tokens.js'
import { asyncHandler, jsonResponse } from '../../middleware/validate.js'
import { logger, logSecurityEvent } from '../../lib/logger.js'
import { sendText, verifyWhatsAppSignature, whatsappEnabled } from '../../lib/whatsapp.js'
import {
  appendLog,
  findLeadByPhone,
  formatLagosDate,
  hashPhone,
  isAdvisorHours,
  lastFollowUpAt,
  relationId,
  scoreLeadEvent,
  type LeadDoc,
  type LeadFollowUp,
  type LeadLogEntry,
} from '../../lib/leads.js'
import { resumeUrl } from '../../lib/lead-messaging.js'
import { assistantEnabled, assistantReply } from '../../lib/ai-assistant.js'
import { buildOffer, type OfferCourseDoc } from '../../lib/offers.js'
import {
  howItWorksReply,
  QUICK_REPLY_PAYLOADS,
  requirementsReply,
  START_REPLY,
  START_WORDS,
  STOP_REPLY,
  STOP_EMAIL_PREFS_LINE,
  STOP_WORDS,
  TALK_IN_HOURS,
  talkOutOfHours,
} from '../../content/whatsapp-replies.js'

const ACK_INTERVAL_MS = 12 * 60 * 60 * 1000

interface InboundMessage {
  from: string
  id: string
  type: string
  text?: { body?: string }
  button?: { payload?: string; text?: string }
  interactive?: { button_reply?: { id?: string; title?: string } }
}

interface StatusUpdate {
  id: string
  status: string
  recipient_id: string
  errors?: Array<{ title?: string; code?: number }>
}

interface WebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
        messages?: InboundMessage[]
        statuses?: StatusUpdate[]
      }
    }>
  }>
}

/** GET: Meta's one-time subscription check. */
async function verify(req: PayloadRequest): Promise<Response> {
  const url = new URL(req.url ?? '', 'http://localhost')
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge') ?? ''
  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  if (mode === 'subscribe' && expected && token === expected) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new Response('Forbidden', { status: 403 })
}

function messageIntent(message: InboundMessage): { payload: string; text: string } {
  const payload = message.button?.payload ?? message.interactive?.button_reply?.id ?? ''
  const text = message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title ?? ''
  return { payload: payload.trim().toUpperCase(), text: text.trim() }
}

/** Free text asking for a person goes straight to Imisi's queue, never to the assistant. */
const WANTS_HUMAN = /\b(talk to (imisi|someone|a person|a human)|real person|human|agent|customer care)\b/i
const AI_DAILY_CAP = 10
const AI_WINDOW_MS = 24 * 60 * 60 * 1000

const BUTTON_TEXT: Record<string, string> = {
  'HOW DOES IT WORK?': QUICK_REPLY_PAYLOADS.howItWorks,
  'WHAT DO I NEED?': QUICK_REPLY_PAYLOADS.requirements,
  'TALK TO IMISI': QUICK_REPLY_PAYLOADS.talk,
}

async function findOrCreateLead(payload: Payload, e164: string, profileName: string): Promise<LeadDoc> {
  const existing = await findLeadByPhone(payload, e164)
  if (existing) return existing
  // Someone messaged the WhatsApp number directly (e.g. the site's chat button) without applying.
  // The placeholder address is reserved (.invalid) and is never emailed.
  return (await payload.create({
    collection: 'leads',
    data: {
      firstName: profileName.slice(0, 100) || 'WhatsApp contact',
      email: `wa-${hashPhone(e164).slice(0, 16)}@whatsapp.invalid`,
      phone: e164,
      source: 'other',
      status: 'new',
      landingPath: 'whatsapp',
    },
    depth: 0,
    overrideAccess: true,
  })) as unknown as LeadDoc
}

async function updateLinkedUserConsent(payload: Payload, lead: LeadDoc, optedIn: boolean): Promise<void> {
  let userId = relationId(lead.user)
  if (!userId && !lead.email.endsWith('.invalid')) {
    const users = await payload.find({ collection: 'users', where: { email: { equals: lead.email } }, limit: 1, depth: 0, overrideAccess: true })
    userId = users.docs[0] ? Number(users.docs[0].id) : undefined
  }
  if (!userId) return
  await payload.update({
    collection: 'users',
    id: userId,
    data: {
      marketingConsent: optedIn ? 'opted_in' : 'opted_out',
      marketingConsentAt: new Date().toISOString(),
      marketingConsentSource: optedIn ? 'whatsapp_start' : 'whatsapp_stop',
    },
    overrideAccess: true,
  })
}

async function loadOfferForLead(payload: Payload, lead: LeadDoc) {
  const courseId = relationId(lead.course)
  if (!courseId) return null
  const course = (await payload
    .findByID({ collection: 'courses', id: courseId, depth: 1, overrideAccess: true })
    .catch(() => null)) as unknown as OfferCourseDoc | null
  return course ? buildOffer(payload, course) : null
}

async function handleMessage(payload: Payload, message: InboundMessage, profileName: string): Promise<void> {
  const e164 = `+${message.from.replace(/[^\d]/g, '')}`
  const lead = await findOrCreateLead(payload, e164, profileName)
  const now = new Date()
  const nowIso = now.toISOString()
  const { payload: buttonPayload, text } = messageIntent(message)
  const upper = text.toUpperCase()
  const intent = buttonPayload || BUTTON_TEXT[upper] || ''

  let log: LeadLogEntry[] = appendLog(lead, { direction: 'in', type: message.type, body: (text || buttonPayload).slice(0, 1000), at: nowIso })
  const followUps: LeadFollowUp[] = [...(lead.followUpsSent ?? [])]
  const data: Record<string, unknown> = { lastInboundAt: nowIso }
  let reply = ''

  if (STOP_WORDS.includes(upper)) {
    // Honour STOP immediately: no marketing templates are ever sent after this.
    Object.assign(data, { marketingConsent: false, optedOutAt: nowIso, lastEventAt: nowIso })
    await updateLinkedUserConsent(payload, lead, false)
    reply = `${STOP_REPLY}

${STOP_EMAIL_PREFS_LINE}${preferencesUrl({ type: 'lead', id: lead.id })}`
  } else if (START_WORDS.includes(upper)) {
    Object.assign(data, {
      marketingConsent: true,
      marketingConsentAt: nowIso,
      marketingConsentText: 'Replied START on WhatsApp to receive SkillsAir updates.',
      optedOutAt: null,
      lastEventAt: nowIso,
    })
    await updateLinkedUserConsent(payload, lead, true)
    reply = START_REPLY
  } else if (intent === QUICK_REPLY_PAYLOADS.howItWorks || intent === QUICK_REPLY_PAYLOADS.requirements) {
    const offer = await loadOfferForLead(payload, lead)
    data.lastEventAt = nowIso
    if (!offer) {
      Object.assign(data, scoreLeadEvent(lead, { type: 'free_text' }))
      reply = isAdvisorHours(now) ? TALK_IN_HOURS : talkOutOfHours(resumeUrl(lead))
    } else if (intent === QUICK_REPLY_PAYLOADS.howItWorks) {
      reply = howItWorksReply({
        date: formatLagosDate(offer.closesAt),
        offerLink: resumeUrl(lead),
        windowOpen: offer.windowOpen,
        price: offer.price,
        standardPrice: offer.standardPrice,
        certificatePrice: offer.certificatePrice,
      })
    } else {
      reply = requirementsReply(
        offer.programme,
        offer.requirements.join(', '),
        offer.phoneFriendly,
        offer.phoneFriendlyAlternatives.map((course) => course.title).join(', '),
      )
    }
  } else if (intent === QUICK_REPLY_PAYLOADS.talk || WANTS_HUMAN.test(text)) {
    Object.assign(data, scoreLeadEvent(lead, { type: 'talk' }))
    reply = isAdvisorHours(now) ? TALK_IN_HOURS : talkOutOfHours(resumeUrl(lead))
  } else {
    Object.assign(data, scoreLeadEvent(lead, { type: 'free_text' }))
    // Optional assistant (off by default): answers from the FAQ facts, capped per lead per day.
    const aiRepliesToday = followUps.filter((item) => item.key === 'ai_reply' && now.getTime() - new Date(item.sentAt).getTime() < AI_WINDOW_MS).length
    if (assistantEnabled() && text && aiRepliesToday < AI_DAILY_CAP) {
      const offer = await loadOfferForLead(payload, lead)
      const answer = await assistantReply(text, {
        firstName: lead.firstName,
        programme: offer?.programme,
        windowOpen: offer?.windowOpen,
        price: offer?.price,
        standardPrice: offer?.standardPrice,
        closesOn: formatLagosDate(offer?.closesAt),
        requirements: offer?.requirements,
        phoneFriendly: offer?.phoneFriendly,
      })
      if (answer) {
        reply = answer
        followUps.push({ key: 'ai_reply', sentAt: nowIso })
      }
    }
    // Otherwise acknowledge free text at most once every 12 hours.
    if (!reply && now.getTime() - lastFollowUpAt(lead, 'wa_ack') > ACK_INTERVAL_MS) {
      reply = isAdvisorHours(now) ? TALK_IN_HOURS : talkOutOfHours(resumeUrl(lead))
      followUps.push({ key: 'wa_ack', sentAt: nowIso })
    }
  }

  if (reply) {
    const result = await sendText(e164, reply)
    if (result.sent || result.skipped) {
      log = appendLog({ whatsappLog: log }, { direction: 'out', type: result.sent ? 'text' : `text_${result.skipped}`, body: reply.slice(0, 1000), at: new Date().toISOString() })
    } else {
      log = appendLog({ whatsappLog: log }, { direction: 'out', type: 'error', body: result.error ?? 'failed', at: new Date().toISOString() })
    }
  }

  await payload.update({
    collection: 'leads',
    id: lead.id,
    data: { ...data, whatsappLog: log, followUpsSent: followUps },
    depth: 0,
    overrideAccess: true,
  })
}

async function handleStatus(payload: Payload, status: StatusUpdate): Promise<void> {
  if (!['delivered', 'read', 'failed'].includes(status.status)) return
  const lead = await findLeadByPhone(payload, `+${status.recipient_id}`)
  if (!lead) return
  const error = status.errors?.[0]
  await payload.update({
    collection: 'leads',
    id: lead.id,
    data: {
      whatsappLog: appendLog(lead, {
        direction: 'out',
        type: `status_${status.status}`,
        body: error ? `${status.id}: ${error.title ?? ''} (${error.code ?? ''})` : status.id,
        at: new Date().toISOString(),
      }),
    },
    depth: 0,
    overrideAccess: true,
  })
}

/** POST: inbound messages, button taps and delivery statuses. Always answers 200 once the signature checks out. */
async function receive(req: PayloadRequest): Promise<Response> {
  const rawBody = typeof req.text === 'function' ? await req.text() : ''
  if (!rawBody || !verifyWhatsAppSignature(rawBody, req.headers.get('x-hub-signature-256'))) {
    logSecurityEvent('webhook_signature_failure', { provider: 'whatsapp' })
    return jsonResponse({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Invalid signature' } }, 401)
  }

  let body: WebhookBody
  try {
    body = JSON.parse(rawBody) as WebhookBody
  } catch {
    return jsonResponse({ received: true })
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {}
      const names = new Map((value.contacts ?? []).map((contact) => [contact.wa_id ?? '', contact.profile?.name ?? '']))
      for (const message of value.messages ?? []) {
        try {
          await handleMessage(req.payload, message, names.get(message.from) ?? '')
        } catch (err) {
          logger.error({ err, messageId: message.id }, 'whatsapp_inbound_failed')
        }
      }
      for (const status of value.statuses ?? []) {
        try {
          await handleStatus(req.payload, status)
        } catch (err) {
          logger.error({ err, messageId: status.id }, 'whatsapp_status_failed')
        }
      }
    }
  }

  if (!whatsappEnabled()) logger.debug({}, 'whatsapp_webhook_received_while_disabled')
  return jsonResponse({ received: true })
}

export const whatsappVerifyEndpoint: Endpoint = {
  path: '/whatsapp/webhook',
  method: 'get',
  handler: asyncHandler(verify),
}

export const whatsappWebhookEndpoint: Endpoint = {
  path: '/whatsapp/webhook',
  method: 'post',
  handler: asyncHandler(receive),
}
