/**
 * Access and validation shared by the ambassador collections and settings (AMBASSADORS.md
 * section 4). Through Payload's REST/GraphQL only admins may read or write; the ledger, payouts
 * and audit log are written only by server code with overrideAccess.
 */
import type { Access, FieldAccess, PayloadRequest } from 'payload'
import { resolveAuthUser } from '../../middleware/authenticate.js'
import { decryptField } from '../../utils/sanitize.js'

/** An admin from Payload's admin session (Studio) or from the app's JWT, like Users does. */
export async function isAdminRequest(req: PayloadRequest): Promise<boolean> {
  const user = (req.user as { role?: string } | null | undefined) ?? await resolveAuthUser(req)
  return user?.role === 'admin'
}

export const adminOnly: Access = ({ req }) => isAdminRequest(req)
export const adminOnlyField: FieldAccess = ({ req }) => isAdminRequest(req)
export const nobody: Access = () => false

type Validate = (value: unknown) => true | string

const empty = (value: unknown) => value === null || value === undefined || value === ''

/** A signed integer number of kobo (safe integer). */
export const signedKobo = (required: boolean): Validate => (value) => {
  if (empty(value)) return required ? 'Required' : true
  return typeof value === 'number' && Number.isSafeInteger(value) ? true : 'Must be a whole number of kobo'
}

/** An integer number of kobo, at least min. */
export const koboAtLeast = (min: number, required: boolean): Validate => (value) => {
  if (empty(value)) return required ? 'Required' : true
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return 'Must be a whole number of kobo'
  return value >= min ? true : `Must be at least ${min} kobo`
}

/** An integer in [min, max]. */
export const integerBetween = (min: number, max: number, required = false): Validate => (value) => {
  if (empty(value)) return required ? 'Required' : true
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'Must be a whole number'
  return value >= min && value <= max ? true : `Must be from ${min} to ${max}`
}

export const rateBps: Validate = integerBetween(0, 10_000)

export const matches = (pattern: RegExp, message: string, required: boolean): Validate => (value) => {
  if (empty(value)) return required ? 'Required' : true
  return typeof value === 'string' && pattern.test(value) ? true : message
}

export const AMBASSADOR_CODE = /^[A-Z0-9]{8}$/
export const AMBASSADOR_USERNAME = /^[a-z0-9._]{3,30}$/
export const ACCOUNT_NUMBER = /^\d{10}$/

/**
 * Payload runs field beforeChange hooks (which encrypt) before validation, so the value may be
 * ciphertext: decrypt first, then check for 10 digits.
 */
export const encryptedAccountNumber: Validate = (value) => {
  if (empty(value)) return 'Required'
  if (typeof value !== 'string') return 'Account number must be 10 digits'
  let plain = value
  try {
    plain = decryptField(value)
  } catch {
    return 'Account number could not be read'
  }
  return ACCOUNT_NUMBER.test(plain) ? true : 'Account number must be 10 digits'
}
