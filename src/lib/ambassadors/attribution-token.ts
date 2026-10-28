import jwt from 'jsonwebtoken'

export interface Attribution { ambassadorId?: number; code: string; clickedAt?: string; signed: boolean }
function secret(): string {
  const value = process.env.AMBASSADOR_ATTRIBUTION_SECRET
  if (!value || value.length < 32) throw new Error('AMBASSADOR_ATTRIBUTION_SECRET must contain at least 32 characters')
  return value
}
export function signAttributionToken(value: { ambassadorId: number; code: string; clickedAt: string }, ttlDays: number): string {
  if (!Number.isSafeInteger(value.ambassadorId) || value.ambassadorId <= 0 || !/^[A-Z0-9]{8}$/.test(value.code) || !Number.isFinite(Date.parse(value.clickedAt)) || !Number.isSafeInteger(ttlDays) || ttlDays < 1 || ttlDays > 365) throw new Error('Invalid attribution token input')
  return jwt.sign({ ...value, type: 'amb_attr' }, secret(), { algorithm: 'HS256', expiresIn: ttlDays * 86400, audience: 'skillsair-attribution' })
}
export function readAttribution(value: string | undefined): Attribution | null {
  if (!value || value.length > 1000) return null
  if (/^code:(?:[A-Za-z0-9]{8}|[0-9]{1,16})$/.test(value)) return { code: value.slice(5).toUpperCase(), signed: false }
  // Configuration errors are operational failures; do not silently turn them into invalid cookies.
  const key = secret()
  try {
    const raw = jwt.verify(value, key, { algorithms: ['HS256'], audience: 'skillsair-attribution' })
    if (typeof raw === 'string' || raw.type !== 'amb_attr' || !Number.isSafeInteger(raw.ambassadorId) || raw.ambassadorId <= 0 || typeof raw.code !== 'string' || !/^[A-Z0-9]{8}$/.test(raw.code) || typeof raw.clickedAt !== 'string' || !Number.isFinite(Date.parse(raw.clickedAt)) || Date.parse(raw.clickedAt) > Date.now() || !Number.isSafeInteger(raw.exp)) return null
    return { ambassadorId: raw.ambassadorId, code: raw.code, clickedAt: raw.clickedAt, signed: true }
  } catch { return null }
}
