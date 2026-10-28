import type { Endpoint } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { createPayloadRateLimiterFor } from '../../lib/rate-limiter.js'
import { createHash } from 'node:crypto'
import { redis } from '../../lib/redis.js'
import { getAmbassadorSettings } from '../../lib/ambassadors/settings.js'
import { resolveReferral } from '../../lib/ambassadors/attribution.js'
import { readAttribution, signAttributionToken } from '../../lib/ambassadors/attribution-token.js'

const limiter = createPayloadRateLimiterFor('ambassador-track', 60, 60)
const schema = z.object({ ref: z.string().min(1).max(16).regex(/^[A-Za-z0-9]+$/), visitorId: z.string().uuid(), landingPath: z.string().max(300).startsWith('/'), referrer: z.string().max(500).optional(), existing: z.string().max(1000).optional(), utm: z.object({ source: z.string().max(100).optional(), medium: z.string().max(100).optional(), campaign: z.string().max(100).optional() }).optional() })
export const ambassadorTrackEndpoint: Endpoint = {
  path: '/ambassadors/track', method: 'post', handler: asyncHandler(async (req) => {
    await limiter.check(req)
    const body = parseBody(schema, await readJsonBody(req))
    const ua = req.headers.get('user-agent')
    if (!ua || /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|headless/i.test(ua)) return sendSuccess({ tracked: false })
    const ambassador = await resolveReferral(req.payload, body.ref)
    if (!ambassador) return sendSuccess({ tracked: false })
    const settings = await getAmbassadorSettings(req.payload)
    const hash = createHash('sha256').update(body.visitorId + ':' + ua).digest('hex')
    let host: string | undefined
    try { host = body.referrer ? new URL(body.referrer).hostname.slice(0, 200) : undefined } catch { /* malformed referrer is omitted */ }
    const unique = await redis.set('amb:uv:' + ambassador.id + ':' + hash + ':' + new Date().toISOString().slice(0, 10).replace(/-/g, ''), '1', 'EX', 93600, 'NX') === 'OK'
    await req.payload.create({ collection: 'referral-clicks', data: { ambassador: ambassador.id, visitorHash: hash, landingPath: body.landingPath, referrerHost: host, utmSource: body.utm?.source, utmMedium: body.utm?.medium, utmCampaign: body.utm?.campaign, isUnique: unique }, overrideAccess: true })
    const existing = readAttribution(body.existing)
    const token = existing?.signed && settings.attributionModel === 'first_click' ? body.existing! : signAttributionToken({ ambassadorId: ambassador.id, code: ambassador.code, clickedAt: new Date().toISOString() }, settings.cookieDays)
    return sendSuccess({ tracked: true, token, maxAgeSeconds: settings.cookieDays * 86400 })
  }),
}
