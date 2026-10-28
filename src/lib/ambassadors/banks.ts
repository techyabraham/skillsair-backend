import { AppError } from '../../types/index.js'
import { redis } from '../redis.js'
import { listNigerianPaystackBanks, resolveNigerianBankAccount } from '../paystack.js'

export interface NigerianBankOption {
  code: string
  name: string
}

const BANKS_CACHE_KEY = 'amb:banks:v1'
const BANKS_CACHE_SECONDS = 24 * 60 * 60

/** Paystack is the source of truth; the validated result is cached for one day. */
export async function getNigerianBanks(): Promise<NigerianBankOption[]> {
  const cached = await redis.get(BANKS_CACHE_KEY)
  if (cached) {
    try {
      const rows = JSON.parse(cached) as NigerianBankOption[]
      if (Array.isArray(rows) && rows.every((row) => typeof row.code === 'string' && typeof row.name === 'string')) return rows
    } catch {
      await redis.del(BANKS_CACHE_KEY)
    }
  }

  const banks = (await listNigerianPaystackBanks())
    .filter((bank) => bank.active === true && bank.currency === 'NGN')
    .map(({ code, name }) => ({ code, name }))
    .filter((bank) => bank.code.length > 0 && bank.name.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name, 'en-NG'))
  if (!banks.length) throw new AppError('SERVICE_BUSY', 'The bank directory is temporarily unavailable')
  await redis.set(BANKS_CACHE_KEY, JSON.stringify(banks), 'EX', BANKS_CACHE_SECONDS)
  return banks
}

export async function resolveBankAccount(bankCode: string, accountNumber: string): Promise<string> {
  return resolveNigerianBankAccount(bankCode, accountNumber)
}
