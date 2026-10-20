/**
 * Data for the Studio nav: the scholarship window chip (public facts) and, for admins, the
 * queue and past-due badges. Counts are cached for 60 seconds per process.
 */
import type { PayloadRequest } from 'payload'
import { isAdmin } from './auth.js'
import { cached } from './cache.js'
import { windowIsOpen } from '../../lib/pricing.js'

export interface WindowState {
  isOpen: boolean
  opensAt: string | null
  closesAt: string | null
  cohortLabel: string | null
  laptopsPerCohort: number | null
}

export async function getWindowState(req: PayloadRequest): Promise<WindowState> {
  const { value } = await cached('window', async () => {
    const doc = (await req.payload.findGlobal({ slug: 'scholarship-window', depth: 0 })) as unknown as Record<string, unknown>
    const closesAt = typeof doc.closesAt === 'string' ? doc.closesAt : null
    const opensAt = typeof doc.opensAt === 'string' ? doc.opensAt : null
    // The same rule as checkout, so the chip never disagrees with the price learners see.
    const isOpen = windowIsOpen({ isOpen: Boolean(doc.isOpen), opensAt, closesAt })
    return {
      isOpen,
      opensAt,
      closesAt,
      cohortLabel: typeof doc.cohortLabel === 'string' ? doc.cohortLabel : null,
      laptopsPerCohort: typeof doc.laptopsPerCohort === 'number' ? doc.laptopsPerCohort : null,
    }
  }, 30_000)
  return value
}

export interface NavCounts {
  queue: number
  pastDue: number
}

export async function getNavCounts(req: PayloadRequest): Promise<NavCounts | null> {
  if (!isAdmin(req)) return null
  const { value } = await cached('nav-counts', async () => {
    const [queue, pastDue] = await Promise.all([
      req.payload.count({ collection: 'leads', where: { needsHuman: { equals: true } }, overrideAccess: true }),
      req.payload.count({ collection: 'subscriptions', where: { status: { equals: 'past_due' } }, overrideAccess: true }),
    ])
    return { queue: queue.totalDocs, pastDue: pastDue.totalDocs }
  }, 30_000)
  return value
}
