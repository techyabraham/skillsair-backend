import { describe, expect, it } from 'vitest'
import { commissionFor, formatNaira, proportionalReversal, toKobo } from './money.js'

describe('toKobo', () => {
  it('converts naira to integer kobo', () => {
    expect(toKobo(0)).toBe(0)
    expect(toKobo(0.01)).toBe(1)
    expect(toKobo(25_000)).toBe(2_500_000)
  })

  it('rounds instead of truncating: ₦9,999.99 is 999999 kobo, not 999998', () => {
    expect(toKobo(9_999.99)).toBe(999_999)
    expect(toKobo(0.29)).toBe(29) // 0.29 * 100 === 28.999999999999996
  })

  it('throws on NaN, infinity, negative and unsafe amounts', () => {
    expect(() => toKobo(Number.NaN)).toThrow(RangeError)
    expect(() => toKobo(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => toKobo(-1)).toThrow(RangeError)
    expect(() => toKobo(-0.01)).toThrow(RangeError)
    expect(() => toKobo(Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
  })
})

describe('commissionFor', () => {
  it('applies the rate and floors', () => {
    expect(commissionFor(0, 5000)).toBe(0)
    expect(commissionFor(1, 5000)).toBe(0)
    expect(commissionFor(3, 5000)).toBe(1)
    expect(commissionFor(2_500_000, 5000)).toBe(1_250_000) // ₦25,000 at 50%
    expect(commissionFor(999_999, 5000)).toBe(499_999)
  })

  it('handles rate 0 and 10000', () => {
    expect(commissionFor(2_500_000, 0)).toBe(0)
    expect(commissionFor(2_500_000, 10_000)).toBe(2_500_000)
  })

  it('stays exact past 2^53 in the intermediate product', () => {
    expect(commissionFor(Number.MAX_SAFE_INTEGER, 10_000)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('throws on negative or fractional input and out-of-range rates', () => {
    expect(() => commissionFor(-1, 5000)).toThrow(RangeError)
    expect(() => commissionFor(1.5, 5000)).toThrow(RangeError)
    expect(() => commissionFor(100, -1)).toThrow(RangeError)
    expect(() => commissionFor(100, 10_001)).toThrow(RangeError)
    expect(() => commissionFor(100, 12.5)).toThrow(RangeError)
  })
})

describe('proportionalReversal', () => {
  it('takes back the full commission on a full refund', () => {
    expect(proportionalReversal(1_250_000, 2_500_000, 2_500_000)).toBe(1_250_000)
  })

  it('takes back half on a half refund', () => {
    expect(proportionalReversal(1_250_000, 1_250_000, 2_500_000)).toBe(625_000)
  })

  it('floors a 1 kobo refund', () => {
    expect(proportionalReversal(1_250_000, 1, 2_500_000)).toBe(0)
    expect(proportionalReversal(3, 1, 2)).toBe(1)
  })

  it('throws on negative input, a zero sale or a refund larger than the sale', () => {
    expect(() => proportionalReversal(-1, 1, 2)).toThrow(RangeError)
    expect(() => proportionalReversal(1, -1, 2)).toThrow(RangeError)
    expect(() => proportionalReversal(1, 0, 0)).toThrow(RangeError)
    expect(() => proportionalReversal(1, 3, 2)).toThrow(RangeError)
  })
})

describe('formatNaira', () => {
  // Exact Intl output, checked on Node 24.15 (ICU 78.2); not yet run on Node 20. The ₦ sign is U+20A6.
  it('formats whole naira by default', () => {
    expect(formatNaira(1_250_000)).toBe('₦12,500')
    expect(formatNaira(0)).toBe('₦0')
  })

  it('formats balances with 2 decimals', () => {
    expect(formatNaira(4_520_000, { decimals: 2 })).toBe('₦45,200.00')
    expect(formatNaira(1, { decimals: 2 })).toBe('₦0.01')
  })

  it('keeps the sign of negative balances', () => {
    expect(formatNaira(-1_000_000, { decimals: 2 })).toBe('-₦10,000.00')
  })

  it('throws on non-integer kobo', () => {
    expect(() => formatNaira(1.5)).toThrow(RangeError)
  })
})
