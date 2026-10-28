import crypto from 'node:crypto'
import { AppError } from '../types/index.js'
import type {
  PaystackTransferData,
  PaystackTransferRecipientData,
  PaystackInitializeRequest,
  PaystackInitializeResponse,
  PaystackVerifyResponse,
} from '../types/paystack.js'
import { logger } from './logger.js'

const PAYSTACK_BASE_URL = 'https://api.paystack.co'

export class PaystackTransferError extends Error {
  constructor(readonly code: 'paystack_otp_enabled' | 'ambiguous' | 'definite_failure') {
    super(code === 'paystack_otp_enabled' ? 'Paystack transfers require OTP approval' : code === 'ambiguous' ? 'Paystack transfer outcome is unknown' : 'Paystack could not process this transfer')
    this.name = 'PaystackTransferError'
  }
}

export interface PaystackBank {
  code: string
  name: string
  active: boolean
  currency?: string
  country?: string
}

interface PaystackBankListResponse {
  status: boolean
  message?: string
  data: PaystackBank[]
  meta?: { next?: string | null }
}

interface PaystackResolveResponse {
  status: boolean
  message?: string
  data?: { account_name?: string; account_number?: string }
}

/**
 * The ambassador bank endpoints deliberately use a separate, sanitised request path: account
 * numbers are part of Paystack's resolve query string and must never reach logs or exceptions.
 */
async function paystackBankRequest<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${getSecretKey()}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    logger.warn({ path: path.split('?')[0] }, 'paystack_bank_request_unavailable')
    throw new AppError('SERVICE_BUSY', 'Bank verification is temporarily unavailable')
  }

  let body: T & { status?: boolean; message?: string }
  try {
    body = (await response.json()) as T & { status?: boolean; message?: string }
  } catch {
    logger.warn({ path: path.split('?')[0], status: response.status }, 'paystack_bank_response_invalid')
    throw new AppError('SERVICE_BUSY', 'Bank verification is temporarily unavailable')
  }

  if (!response.ok || body.status === false) {
    const message = typeof body.message === 'string' ? body.message : ''
    if (path.startsWith('/bank/resolve?') && /could not resolve|not found|invalid account|account number.*bank code/i.test(message)) {
      throw new AppError('VALIDATION_ERROR', "We couldn't find this account. Check the number and bank.", {
        accountNumber: "We couldn't find this account. Check the number and bank.",
      })
    }
    logger.warn({ path: path.split('?')[0], status: response.status }, 'paystack_bank_request_failed')
    throw new AppError('SERVICE_BUSY', 'Bank verification is temporarily unavailable')
  }
  return body
}

/** Lists active NGN banks in Nigeria, following Paystack's cursor pagination when present. */
export async function listNigerianPaystackBanks(): Promise<PaystackBank[]> {
  const rows: PaystackBank[] = []
  let cursor: string | null = null
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ country: 'nigeria', currency: 'NGN', perPage: '100', use_cursor: 'true' })
    if (cursor) query.set('next', cursor)
    const result = await paystackBankRequest<PaystackBankListResponse>(`/bank?${query.toString()}`)
    rows.push(...(result.data ?? []))
    cursor = result.meta?.next ?? null
    if (!cursor) break
  }
  return rows.filter((bank) => bank.active === true && bank.currency === 'NGN')
}

/** Resolves a 10-digit Nigerian account without putting the account number in logs. */
export async function resolveNigerianBankAccount(bankCode: string, accountNumber: string): Promise<string> {
  const query = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode })
  const result = await paystackBankRequest<PaystackResolveResponse>(`/bank/resolve?${query.toString()}`)
  const name = result.data?.account_name?.trim()
  if (!name) throw new AppError('SERVICE_BUSY', 'Bank verification is temporarily unavailable')
  return name
}

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not configured')
  return key
}

interface PaystackEnvelope<T> { status: boolean; message?: string; data?: T }

/**
 * Transfers use a separate request path from ordinary Paystack calls: a timeout or 5xx after an
 * initiate request is ambiguous, so callers must reconcile by the original reference and never
 * issue a second transfer with a new reference.
 */
async function paystackTransferRequest<T>(path: string, init: RequestInit, operation: 'recipient' | 'initiate' | 'verify'): Promise<T> {
  let secret: string
  try { secret = getSecretKey() }
  catch { throw new PaystackTransferError('definite_failure') }
  let response: Response
  try {
    response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    })
  } catch {
    logger.warn({ operation }, 'ambassador_paystack_transfer_transport_ambiguous')
    throw new PaystackTransferError('ambiguous')
  }
  let body: PaystackEnvelope<T>
  try {
    body = await response.json() as PaystackEnvelope<T>
  } catch {
    logger.warn({ operation, status: response.status }, 'ambassador_paystack_transfer_response_invalid')
    throw new PaystackTransferError(response.status >= 500 || operation === 'initiate' ? 'ambiguous' : 'definite_failure')
  }
  if (!response.ok || body.status !== true || !body.data) {
    if (operation === 'initiate' && /transfer requires otp|otp to continue/i.test(body.message ?? '')) {
      throw new PaystackTransferError('paystack_otp_enabled')
    }
    logger.warn({ operation, status: response.status }, 'ambassador_paystack_transfer_request_failed')
    if (operation === 'verify' || response.status >= 500) throw new PaystackTransferError('ambiguous')
    throw new PaystackTransferError('definite_failure')
  }
  const data = body.data as T & { status?: string }
  if (operation === 'initiate' && data.status === 'otp') throw new PaystackTransferError('paystack_otp_enabled')
  return data
}

export async function createTransferRecipient(args: { name: string; accountNumber: string; bankCode: string }): Promise<string> {
  const data = await paystackTransferRequest<PaystackTransferRecipientData>('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({ type: 'nuban', name: args.name, account_number: args.accountNumber, bank_code: args.bankCode, currency: 'NGN' }),
  }, 'recipient')
  if (typeof data.recipient_code !== 'string' || !data.recipient_code) throw new PaystackTransferError('ambiguous')
  return data.recipient_code
}

export async function initiateTransfer(args: { amountKobo: number; recipientCode: string; reference: string; reason: string }): Promise<PaystackTransferData> {
  if (!Number.isSafeInteger(args.amountKobo) || args.amountKobo <= 0) throw new AppError('VALIDATION_ERROR', 'Transfer amount must be a positive integer kobo value')
  return paystackTransferRequest<PaystackTransferData>('/transfer', {
    method: 'POST',
    body: JSON.stringify({ source: 'balance', amount: args.amountKobo, recipient: args.recipientCode, reference: args.reference, reason: args.reason, currency: 'NGN' }),
  }, 'initiate')
}

export async function verifyTransfer(reference: string): Promise<PaystackTransferData> {
  const transfer = await paystackTransferRequest<PaystackTransferData>(`/transfer/verify/${encodeURIComponent(reference)}`, { method: 'GET' }, 'verify')
  if (transfer.status === 'otp') throw new PaystackTransferError('paystack_otp_enabled')
  return transfer
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

/** A Paystack plan's amount (kobo), for the plan-fee update script. */
export async function getPlan(code: string): Promise<{ plan_code: string; name: string; amount: number; interval: string; currency: string }> {
  const response = await paystackRequest<{ data: { plan_code: string; name: string; amount: number; interval: string; currency: string } }>(
    `/plan/${encodeURIComponent(code)}`, { method: 'GET' },
  )
  return response.data
}

/**
 * Changes what a Paystack plan charges (amount in naira). Existing subscribers keep the amount
 * they signed up for; only new subscriptions use the new amount.
 */
export async function updatePlanAmount(code: string, amountNgn: number): Promise<void> {
  await paystackRequest<{ status: boolean }>(`/plan/${encodeURIComponent(code)}`, {
    method: 'PUT',
    body: JSON.stringify({ amount: Math.round(amountNgn * 100), update_existing_subscriptions: false }),
  })
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

/** A Paystack-hosted page where the subscriber can change the card on their subscription (or cancel). */
export async function subscriptionManageLink(subscriptionCode: string): Promise<string> {
  const response = await paystackRequest<{ data: { link: string } }>(`/subscription/${encodeURIComponent(subscriptionCode)}/manage/link`, { method: 'GET' })
  return response.data.link
}
