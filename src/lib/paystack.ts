import crypto from 'node:crypto'
import { AppError } from '../types/index.js'
import type {
  PaystackInitializeRequest,
  PaystackInitializeResponse,
  PaystackVerifyResponse,
} from '../types/paystack.js'
import { logger } from './logger.js'

const PAYSTACK_BASE_URL = 'https://api.paystack.co'

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not configured')
  return key
}

async function paystackRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const body = (await response.json()) as T & { status?: boolean; message?: string }
  if (!response.ok || body.status === false) {
    logger.error({ path, status: response.status, body }, 'paystack_request_failed')
    throw new AppError('INTERNAL_ERROR', body.message ?? 'Paystack request failed')
  }
  return body
}

export async function initializeTransaction(
  payload: PaystackInitializeRequest,
): Promise<PaystackInitializeResponse> {
  return paystackRequest<PaystackInitializeResponse>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function verifyTransaction(reference: string): Promise<PaystackVerifyResponse> {
  return paystackRequest<PaystackVerifyResponse>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: 'GET' },
  )
}

export async function verifyPlanConfiguration(code: string, amountNgn: number, interval: 'monthly' | 'annually'): Promise<void> {
  const response = await paystackRequest<{ data: { plan_code: string; amount: number; currency: string; interval: string } }>(
    `/plan/${encodeURIComponent(code)}`, { method: 'GET' },
  )
  if (response.data.plan_code !== code || response.data.amount !== Math.round(amountNgn * 100) || response.data.currency !== 'NGN' || response.data.interval !== interval) {
    throw new AppError('VALIDATION_ERROR', 'Paystack plan does not match the SkillsAir price and billing interval')
  }
}

/** Creates a Paystack plan (used by the one-off pricing seed). Amount in naira. */
export async function createPlan(name: string, amountNgn: number, interval: 'monthly' | 'annually'): Promise<string> {
  const response = await paystackRequest<{ data: { plan_code: string } }>('/plan', {
    method: 'POST',
    body: JSON.stringify({ name, amount: Math.round(amountNgn * 100), interval, currency: 'NGN' }),
  })
  return response.data.plan_code
}

export async function disableSubscription(subscriptionCode: string, emailToken: string): Promise<void> {
  await paystackRequest<{ status: boolean; message: string }>('/subscription/disable', {
    method: 'POST',
    body: JSON.stringify({ code: subscriptionCode, token: emailToken }),
  })
}

/** Verifies the HMAC-SHA512 signature Paystack sends on every webhook request. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false
  const webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET ?? getSecretKey()
  const expectedHash = crypto.createHmac('sha512', webhookSecret).update(rawBody).digest('hex')
  const expected = Buffer.from(expectedHash, 'utf8')
  const actual = Buffer.from(signatureHeader, 'utf8')
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}
