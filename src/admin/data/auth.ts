/**
 * Server-side role checks for Studio views and data (brief 11). Always pass the full request
 * identity (`initPageResult.req.user` / `req.user`), never a client-filtered user prop.
 */
import type { PayloadRequest } from 'payload'

export type StudioRole = 'admin' | 'instructor' | 'student' | null

export interface StudioUser {
  id: number | string
  role: StudioRole
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}

export function studioUser(req: Pick<PayloadRequest, 'user'> | null | undefined): StudioUser | null {
  const user = req?.user as (Record<string, unknown> & { id?: number | string }) | null | undefined
  if (!user || user.id === undefined || user.collection !== 'users') return null
  const role = user.role === 'admin' || user.role === 'instructor' || user.role === 'student' ? user.role : null
  return {
    id: user.id,
    role,
    firstName: typeof user.firstName === 'string' ? user.firstName : null,
    lastName: typeof user.lastName === 'string' ? user.lastName : null,
    email: typeof user.email === 'string' ? user.email : null,
  }
}

export function isAdmin(req: Pick<PayloadRequest, 'user'> | null | undefined): boolean {
  return studioUser(req)?.role === 'admin'
}

export function isStaff(req: Pick<PayloadRequest, 'user'> | null | undefined): boolean {
  const role = studioUser(req)?.role
  return role === 'admin' || role === 'instructor'
}

export class StudioForbiddenError extends Error {
  constructor(message = 'Not available for your role') {
    super(message)
    this.name = 'StudioForbiddenError'
  }
}

/** Throws unless the request belongs to an admin. Call before any overrideAccess query. */
export function assertAdmin(req: Pick<PayloadRequest, 'user'> | null | undefined): StudioUser {
  const user = studioUser(req)
  if (user?.role !== 'admin') throw new StudioForbiddenError()
  return user
}

/** Throws unless the request belongs to an admin or instructor. */
export function assertStaff(req: Pick<PayloadRequest, 'user'> | null | undefined): StudioUser {
  const user = studioUser(req)
  if (user?.role !== 'admin' && user?.role !== 'instructor') throw new StudioForbiddenError()
  return user
}
