/**
 * Ambassador money (AMBASSADORS.md M1-M3, M8). Every amount is an integer number of kobo in a JS
 * number; floats never carry money. Orders store naira, so they are converted exactly once with
 * toKobo(). Products of two amounts are computed in BigInt so they stay exact beyond 2^53.
 */

function assertKobo(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer number of kobo`)
  if (value < 0) throw new RangeError(`${name} must not be negative`)
}

/** Naira (as stored on orders.amount) to integer kobo: Math.round(naira * 100). */
export function toKobo(naira: number): number {
  if (typeof naira !== 'number' || !Number.isFinite(naira)) throw new RangeError('Naira amount must be a finite number')
  if (naira < 0) throw new RangeError('Naira amount must not be negative')
  const kobo = Math.round(naira * 100)
  if (!Number.isSafeInteger(kobo)) throw new RangeError('Naira amount is too large')
  return kobo
}

/** Commission on a sale: floor(saleKobo * rateBps / 10000). */
export function commissionFor(saleKobo: number, rateBps: number): number {
  assertKobo(saleKobo, 'saleKobo')
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) throw new RangeError('rateBps must be an integer from 0 to 10000')
  return Number((BigInt(saleKobo) * BigInt(rateBps)) / 10_000n)
}

/**
 * The share of a commission that a (partial) refund takes back: floor(commission * refunded / sale).
 * Returned as a positive number; the reversal ledger row stores it negated.
 */
export function proportionalReversal(commissionKobo: number, refundedKobo: number, saleKobo: number): number {
  assertKobo(commissionKobo, 'commissionKobo')
  assertKobo(refundedKobo, 'refundedKobo')
  assertKobo(saleKobo, 'saleKobo')
  if (saleKobo === 0) throw new RangeError('saleKobo must be greater than zero')
  if (refundedKobo > saleKobo) throw new RangeError('refundedKobo cannot exceed saleKobo')
  return Number((BigInt(commissionKobo) * BigInt(refundedKobo)) / BigInt(saleKobo))
}

// minimumFractionDigits is set as well as maximum: NGN defaults to 2 minimum digits, and some
// ICU versions reject a maximum below the minimum.
const WHOLE_NAIRA = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0, maximumFractionDigits: 0 })
const NAIRA_AND_KOBO = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "₦12,500" (default, whole naira) or "₦45,200.00" with { decimals: 2 } for balances. Negative amounts keep their sign. */
export function formatNaira(kobo: number, opts: { decimals?: 0 | 2 } = {}): string {
  if (!Number.isSafeInteger(kobo)) throw new RangeError('kobo must be a safe integer')
  return (opts.decimals === 2 ? NAIRA_AND_KOBO : WHOLE_NAIRA).format(kobo / 100)
}
