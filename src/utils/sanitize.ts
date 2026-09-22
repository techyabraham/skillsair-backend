import crypto from 'node:crypto'
import type { EncryptedPayload } from '../types/index.js'

const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/gi
const E164_PATTERN = /^\+[1-9]\d{6,14}$/
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'

/** Strips HTML tags from user-supplied text fields to prevent stored XSS. */
export function stripHtml(input: string): string {
  return input.replace(HTML_TAG_PATTERN, '').trim()
}

export function sanitizeText(input: unknown): string {
  if (typeof input !== 'string') return ''
  return stripHtml(input).slice(0, 10_000)
}

export function isValidE164Phone(phone: string): boolean {
  return E164_PATTERN.test(phone)
}

export function isValidPayloadId(id: unknown): id is string {
  return typeof id === 'string' && /^\d+$/.test(id) && Number(id) > 0
}

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(key, 'hex')
}

/** Encrypts sensitive at-rest fields (phone, bank account numbers) with AES-256-GCM. */
export function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const payload: EncryptedPayload = {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted.toString('hex'),
  }
  return JSON.stringify(payload)
}

export function decryptField(ciphertext: string): string {
  let payload: EncryptedPayload
  try {
    payload = JSON.parse(ciphertext) as EncryptedPayload
  } catch {
    return ciphertext
  }
  if (!payload.iv || !payload.authTag || !payload.data) return ciphertext
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    Buffer.from(payload.iv, 'hex'),
  )
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'hex')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

const PASSWORD_STRENGTH_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{8,}$/

export function isStrongPassword(password: string): boolean {
  return PASSWORD_STRENGTH_PATTERN.test(password)
}
