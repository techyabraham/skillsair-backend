import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { readAttribution, signAttributionToken } from './attribution-token.js'
const key = 'test-attribution-secret-0123456789-abcdef'
describe('attribution tokens', () => {
  beforeEach(() => { vi.stubEnv('AMBASSADOR_ATTRIBUTION_SECRET', key) })
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })
  it('signs HS256 tokens with the dedicated type, audience and expiry', () => {
    const value = { ambassadorId: 7, code: 'ABCDEFGH', clickedAt: new Date().toISOString() }
    const token = signAttributionToken(value, 30)
    const decoded = jwt.verify(token, key) as jwt.JwtPayload
    expect(decoded.type).toBe('amb_attr')
    expect(decoded.exp! - decoded.iat!).toBe(30 * 86400)
    expect(readAttribution(token)).toEqual({ ...value, signed: true })
  })
  it('accepts only the explicit fallback format, including legacy ids', () => {
    expect(readAttribution('code:abcdefgh')).toEqual({ code: 'ABCDEFGH', signed: false })
    expect(readAttribution('code:123')).toEqual({ code: '123', signed: false })
    for (const value of ['', 'ABCDEFGH', 'code:x', 'code:../bad', 'code:' + 'a'.repeat(17)]) expect(readAttribution(value)).toBeNull()
  })
  it('rejects tampering, wrong key, wrong claim and expired tokens', () => {
    const value = { ambassadorId: 7, code: 'ABCDEFGH', clickedAt: new Date().toISOString() }
    const token = signAttributionToken(value, 1)
    expect(readAttribution(token.slice(0, -4) + 'abcd')).toBeNull()
    expect(readAttribution(jwt.sign({ ...value, type: 'access' }, key, { audience: 'skillsair-attribution', expiresIn: 86400 }))).toBeNull()
    expect(readAttribution(jwt.sign({ ...value, type: 'amb_attr' }, 'different-secret', { audience: 'skillsair-attribution', expiresIn: 86400 }))).toBeNull()
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 2 * 86400000)
    expect(readAttribution(token)).toBeNull()
  })
  it('requires a configured key of at least 32 characters', () => {
    vi.stubEnv('AMBASSADOR_ATTRIBUTION_SECRET', 'short')
    expect(() => signAttributionToken({ ambassadorId: 1, code: 'ABCDEFGH', clickedAt: new Date().toISOString() }, 1)).toThrow('32')
  })
})
