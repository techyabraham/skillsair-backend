import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'

/** Learner preferences the site remembers across devices (the video player's captions, size and speed). */
const preferencesSchema = z.object({
  captions: z.boolean().optional(),
  captionSize: z.enum(['s', 'm', 'l']).optional(),
  playbackRate: z.number().min(0.5).max(2).optional(),
}).strict()

type Preferences = z.infer<typeof preferencesSchema>

async function getHandler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const doc = await req.payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true }) as unknown as { preferences?: Preferences | null }
  return sendSuccess({ preferences: doc.preferences ?? {} })
}

async function patchHandler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  const body = parseBody(preferencesSchema, await readJsonBody(req))
  const doc = await req.payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true }) as unknown as { preferences?: Preferences | null }
  const preferences = { ...(doc.preferences ?? {}), ...body }
  await req.payload.update({ collection: 'users', id: user.id, data: { preferences } as never, overrideAccess: true })
  return sendSuccess({ preferences })
}

export const getPreferencesEndpoint: Endpoint = { path: '/profile/preferences', method: 'get', handler: asyncHandler(getHandler) }
export const updatePreferencesEndpoint: Endpoint = { path: '/profile/preferences', method: 'patch', handler: asyncHandler(patchHandler) }
