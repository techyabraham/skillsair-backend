import crypto from 'node:crypto'

/**
 * Verifies a Svix-signed webhook (Resend uses Svix). The signed content is
 * `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 with the base64 secret after "whsec_";
 * the `svix-signature` header holds one or more space-separated "v1,<base64>" signatures.
 * Timestamps more than 5 minutes away are rejected to stop replays.
 */
export interface SvixHeaders {
  id: string | null
  timestamp: string | null
  signature: string | null
}

const TOLERANCE_SECONDS = 5 * 60

export function verifySvixSignature(rawBody: string, headers: SvixHeaders, secret: string | undefined, now = Date.now()): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false
  const timestamp = Number(headers.timestamp)
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > TOLERANCE_SECONDS) return false
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64')
  if (key.length === 0) return false
  const expected = crypto.createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest()
  return headers.signature.split(' ').some((entry) => {
    const [version, value] = entry.split(',')
    if (version !== 'v1' || !value) return false
    const given = Buffer.from(value, 'base64')
    return given.length === expected.length && crypto.timingSafeEqual(given, expected)
  })
}
