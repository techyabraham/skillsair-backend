import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { withLock } from './locks.js'
import { fulfillOrder } from './order-fulfillment.js'
import { redis } from './redis.js'
import { resetFakeRedis } from '../test/fake-redis.js'

beforeEach(() => resetFakeRedis())

describe('withLock', () => {
  it('runs fn, returns its value and releases the lock', async () => {
    expect(await withLock('k', 60, async () => 'done')).toBe('done')
    expect(await redis.get('k')).toBeNull()
  })

  it('returns null without running fn while another holder has the lock', async () => {
    await redis.set('k', 'someone-else', 'EX', 60, 'NX')
    const fn = vi.fn(async () => 'ran')
    expect(await withLock('k', 60, fn)).toBeNull()
    expect(fn).not.toHaveBeenCalled()
    expect(await redis.get('k')).toBe('someone-else')
  })

  it('lets exactly one of two concurrent callers in', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const first = withLock('k', 60, async () => { await gate; return 'first' })
    const second = await withLock('k', 60, async () => 'second')
    release()
    expect(second).toBeNull()
    expect(await first).toBe('first')
  })

  it('releases the lock when fn throws, and rethrows', async () => {
    await expect(withLock('k', 60, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await redis.get('k')).toBeNull()
  })

  it('never releases a lock someone else took after the TTL expired', async () => {
    await withLock('k', 60, async () => {
      await redis.del('k') // our lock expired...
      await redis.set('k', 'next-holder', 'EX', 60, 'NX') // ...and another instance took it
    })
    expect(await redis.get('k')).toBe('next-holder')
  })
})

describe('fulfillOrder keeps its locking behaviour', () => {
  function fakePayload(order: Record<string, unknown>) {
    const findByID = vi.fn(async () => order)
    return { payload: { findByID } as unknown as Payload, findByID }
  }

  it('locks order-fulfillment:<id> for 600 seconds while it works, then releases it', async () => {
    let held: { value: string | null; ttl: number } | undefined
    const { payload, findByID } = fakePayload({ id: 7, status: 'pending' })
    findByID.mockImplementation(async () => {
      held = { value: await redis.get('order-fulfillment:7'), ttl: await redis.ttl('order-fulfillment:7') }
      return { id: 7, status: 'pending' }
    })
    await fulfillOrder(payload, 7)
    expect(findByID).toHaveBeenCalledWith({ collection: 'orders', id: 7, depth: 0, overrideAccess: true })
    expect(held?.value).toBeTruthy()
    expect(held?.ttl).toBeGreaterThan(590)
    expect(held?.ttl).toBeLessThanOrEqual(600)
    expect(await redis.get('order-fulfillment:7')).toBeNull()
  })

  it('does nothing (and resolves) while another instance is fulfilling the same order', async () => {
    await redis.set('order-fulfillment:7', 'other-instance', 'EX', 600, 'NX')
    const { payload, findByID } = fakePayload({ id: 7, status: 'success' })
    await expect(fulfillOrder(payload, 7)).resolves.toBeUndefined()
    expect(findByID).not.toHaveBeenCalled()
    expect(await redis.get('order-fulfillment:7')).toBe('other-instance')
  })

  it('skips an order that is already fulfilled', async () => {
    const { payload, findByID } = fakePayload({ id: 8, status: 'success', fulfilledAt: '2026-10-01T00:00:00.000Z' })
    await fulfillOrder(payload, 8)
    expect(findByID).toHaveBeenCalledTimes(1)
  })

  it('propagates a failure and still releases the lock', async () => {
    const { payload, findByID } = fakePayload({})
    findByID.mockRejectedValue(new Error('db down'))
    await expect(fulfillOrder(payload, 9)).rejects.toThrow('db down')
    expect(await redis.get('order-fulfillment:9')).toBeNull()
  })
})
