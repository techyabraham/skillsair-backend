/**
 * In-memory stand-in for the ioredis client, swapped in for `ioredis` by src/test/setup.ts. It
 * implements only the commands the code uses: GET, SET (with EX/PX and NX), DEL, INCR, EXPIRE,
 * TTL and the compare-and-delete EVAL script used to release locks. Expiry follows the real clock.
 */
const COMPARE_AND_DELETE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"

interface Entry {
  value: string
  expiresAt: number | null
}

// One store for every client, like one Redis server.
const store = new Map<string, Entry>()

export function resetFakeRedis(): void {
  store.clear()
}

export class FakeRedis {
  private store = store

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key)
    if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry
  }

  on(): this {
    return this
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    let expiresAt: number | null = null
    let nx = false
    for (let i = 0; i < args.length; i++) {
      const flag = String(args[i]).toUpperCase()
      if (flag === 'EX') expiresAt = Date.now() + Number(args[++i]) * 1000
      else if (flag === 'PX') expiresAt = Date.now() + Number(args[++i])
      else if (flag === 'NX') nx = true
    }
    if (nx && this.live(key)) return null
    this.store.set(key, { value: String(value), expiresAt })
    return 'OK'
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0
    for (const key of keys) if (this.live(key) && this.store.delete(key)) removed++
    return removed
  }

  async incr(key: string): Promise<number> {
    const entry = this.live(key)
    const next = Number(entry?.value ?? 0) + 1
    this.store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null })
    return next
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.live(key)
    if (!entry) return 0
    entry.expiresAt = Date.now() + seconds * 1000
    return 1
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key)
    if (!entry) return -2
    if (entry.expiresAt === null) return -1
    return Math.ceil((entry.expiresAt - Date.now()) / 1000)
  }

  async eval(script: string, _numKeys: number, key: string, token: string): Promise<number> {
    if (script !== COMPARE_AND_DELETE) throw new Error('FakeRedis only runs the compare-and-delete script')
    if (this.live(key)?.value !== token) return 0
    this.store.delete(key)
    return 1
  }
}
