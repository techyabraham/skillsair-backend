import crypto from 'node:crypto'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // excludes ambiguous chars (0,O,1,I)

function randomAlphabetString(length: number): string {
  const bytes = crypto.randomBytes(length)
  let result = ''
  for (let i = 0; i < length; i++) {
    result += ALPHABET[bytes[i]! % ALPHABET.length]
  }
  return result
}

/** 8-char uppercase referral code, e.g. "K7M2P9XQ". */
export function generateReferralCode(): string {
  return randomAlphabetString(8)
}

/** Certificate code in the format SAC-XXXXXXXX. */
export function generateCertificateCode(): string {
  return `SAC-${randomAlphabetString(8)}`
}

/** Paystack transaction reference: SAS-{type}-{userId}-{timestamp}. */
export function generatePaystackReference(type: string, userId: number): string {
  return `SAS-${type}-${userId}-${Date.now()}`
}

/** Secure random token for password reset, hex-encoded. */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
