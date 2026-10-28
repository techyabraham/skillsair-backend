import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }))
const paystackMock = vi.hoisted(() => ({ list: vi.fn(), resolve: vi.fn() }))

vi.mock('../redis.js', () => ({ redis: redisMock }))
vi.mock('../paystack.js', () => ({ listNigerianPaystackBanks: paystackMock.list, resolveNigerianBankAccount: paystackMock.resolve }))

import { getNigerianBanks, resolveBankAccount } from './banks.js'

describe('ambassador Nigerian banks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMock.get.mockResolvedValue(null)
    redisMock.set.mockResolvedValue('OK')
  })

  it('filters active NGN banks, sorts them, and caches for one day', async () => {
    paystackMock.list.mockResolvedValue([
      { code: '002', name: 'Zenith Bank', active: true, currency: 'NGN' },
      { code: '003', name: 'Inactive Bank', active: false, currency: 'NGN' },
      { code: '004', name: 'Dollar Bank', active: true, currency: 'USD' },
      { code: '001', name: 'Access Bank', active: true, currency: 'NGN' },
    ])

    await expect(getNigerianBanks()).resolves.toEqual([
      { code: '001', name: 'Access Bank' },
      { code: '002', name: 'Zenith Bank' },
    ])
    expect(redisMock.set).toHaveBeenCalledWith('amb:banks:v1', JSON.stringify([
      { code: '001', name: 'Access Bank' },
      { code: '002', name: 'Zenith Bank' },
    ]), 'EX', 86_400)
  })

  it('uses a valid cached list without calling Paystack', async () => {
    redisMock.get.mockResolvedValue(JSON.stringify([{ code: '058', name: 'GTBank' }]))
    await expect(getNigerianBanks()).resolves.toEqual([{ code: '058', name: 'GTBank' }])
    expect(paystackMock.list).not.toHaveBeenCalled()
  })

  it('resolves through Paystack without changing the returned account name', async () => {
    paystackMock.resolve.mockResolvedValue('TOLU ADEYEMI')
    await expect(resolveBankAccount('058', '0123456789')).resolves.toBe('TOLU ADEYEMI')
    expect(paystackMock.resolve).toHaveBeenCalledWith('058', '0123456789')
  })
})
