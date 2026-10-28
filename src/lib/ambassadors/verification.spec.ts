import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import type { AmbassadorDoc } from './types.js'

const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), expire: vi.fn(), eval: vi.fn() }))
const sendEmailMock = vi.hoisted(() => vi.fn())

vi.mock('../redis.js', () => ({ redis: redisMock }))
vi.mock('../resend.js', () => ({ sendEmail: sendEmailMock }))

import { issueVerification, maskEmail } from './verification.js'
import { hashToken } from '../../utils/generate-code.js'

describe('ambassador verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMock.get.mockResolvedValue(null)
    redisMock.set.mockResolvedValue('OK')
    sendEmailMock.mockResolvedValue('email-id')
  })

  it('masks an email without changing the mail recipient', () => {
    expect(maskEmail('tolu.adeyemi@gmail.com')).toBe('t•••@gmail.com')
    expect(maskEmail('a@skillsair.com')).toBe('a•••@skillsair.com')
  })

  it('stores only hashes and emails one code with a verification link', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({ id: 9, email: 'tolu@example.com', firstName: 'Tolu' }),
    } as unknown as Payload
    const ambassador = { id: 41, user: 9, username: 'tolu', status: 'pending', source: 'self' } as AmbassadorDoc

    const result = await issueVerification(payload, ambassador)

    expect(result).toEqual({ email: 'tolu@example.com', firstName: 'Tolu', resendAfterSeconds: 60 })
    expect(redisMock.set).toHaveBeenCalledTimes(2)
    const [otpKey, rawRecord] = redisMock.set.mock.calls[0] as [string, string, ...unknown[]]
    const record = JSON.parse(rawRecord) as { otpHash: string; tokenHash: string; attempts: number }
    expect(otpKey).toBe('amb:otp:41')
    expect(record).toMatchObject({ attempts: 0 })
    expect(record.otpHash).toMatch(/^[a-f0-9]{64}$/)
    expect(record.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(redisMock.set.mock.calls[1]?.[0]).toBe(`amb:vtok:${record.tokenHash}`)
    expect(redisMock.set.mock.calls[1]?.[1]).toBe('41')
    expect(sendEmailMock).toHaveBeenCalledOnce()
    const mail = sendEmailMock.mock.calls[0]?.[1] as { html: string; text: string }
    const otp = mail.text.match(/code is (\d{6})/)?.[1]
    const token = mail.text.match(/verify your email: https:\/\/ambassador\.skillsair\.com\/verify\?token=([a-f0-9]+)/i)?.[1]
    expect(otp).toBeDefined()
    expect(token).toHaveLength(64)
    expect(record.otpHash).toBe(hashToken(otp!))
    expect(record.tokenHash).toBe(hashToken(token!))
    expect(mail.html).toContain(otp!)
    expect(mail.html).toContain('/verify?token=')
  })
})
