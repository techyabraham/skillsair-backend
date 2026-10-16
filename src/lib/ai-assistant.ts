import { Anthropic, APIError, RateLimitError } from '@anthropic-ai/sdk'
import type { BetaTextBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { logger } from './logger.js'
import { ASSISTANT_SYSTEM_PROMPT } from '../content/assistant-knowledge.js'

/**
 * Optional WhatsApp FAQ assistant (phase 3). Off unless WHATSAPP_AI_ASSISTANT is exactly
 * "true". It answers free-text questions from the FAQ facts only, always introduces itself
 * as SkillsAir's assistant (never as Imisi), and the lead still joins Imisi's queue.
 */

const MODEL = process.env.WHATSAPP_AI_MODEL || 'claude-opus-5-5'
const PREFIX = "SkillsAir's assistant 🤖: "

let client: Anthropic | null = null

export function assistantEnabled(): boolean {
  return process.env.WHATSAPP_AI_ASSISTANT === 'true'
}

export interface AssistantContext {
  firstName: string
  programme?: string
  windowOpen?: boolean
  price?: number
  standardPrice?: number
  closesOn?: string
  requirements?: string[]
  phoneFriendly?: boolean
}

function contextBlock(context: AssistantContext): string {
  const naira = (amount: number) => `₦${amount.toLocaleString('en-NG')}`
  const lines = [`Applicant first name: ${context.firstName}`]
  if (context.programme) {
    lines.push(`Programme applied for: ${context.programme}`)
    if (context.windowOpen && context.price !== undefined) {
      lines.push(`Access Scholarship price: ${naira(context.price)} a month (standard fee ${naira(context.standardPrice ?? 100000)} once), window closes ${context.closesOn}.`)
    } else if (context.standardPrice !== undefined) {
      lines.push(`No scholarship window is open now; the standard fee ${naira(context.standardPrice)} applies.`)
    }
    if (context.requirements?.length) lines.push(`What they'll need: ${context.requirements.join(', ')}`)
    lines.push(context.phoneFriendly ? 'This programme works fully on a phone.' : 'This programme needs a laptop for some of the work.')
  } else {
    lines.push('They have not chosen a programme yet; point them to https://skillsair.com/apply.')
  }
  return lines.join('\n')
}

/** Returns a reply ready to send on WhatsApp, or null when the assistant is off or can't answer. */
export async function assistantReply(question: string, context: AssistantContext): Promise<string | null> {
  if (!assistantEnabled()) return null
  client ??= new Anthropic()
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // Chat replies: keep effort low for speed and cost.
      output_config: { effort: 'low' },
      // Server-side refusal fallback: if a safety classifier declines, the API retries on a suitable model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `<applicant_context>\n${contextBlock(context)}\n</applicant_context>\n\n<whatsapp_message>\n${question.slice(0, 2000)}\n</whatsapp_message>`,
        },
      ],
    })
    if (response.stop_reason === 'refusal') return null
    const text = response.content
      .filter((block): block is BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()
    return text ? `${PREFIX}${text.slice(0, 1500)}` : null
  } catch (err) {
    if (err instanceof RateLimitError) logger.warn({}, 'assistant_rate_limited')
    else if (err instanceof APIError) logger.error({ status: err.status }, 'assistant_api_error')
    else logger.error({ err }, 'assistant_failed')
    return null
  }
}
