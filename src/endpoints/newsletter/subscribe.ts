import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'

const schema = z.object({ email: z.string().trim().email().max(254) })

async function handler(req: PayloadRequest): Promise<Response> {
  const { email: rawEmail } = parseBody(schema, await readJsonBody(req))
  const email = rawEmail.toLowerCase()
  const existing = await req.payload.find({
    collection: 'newsletter-subscribers',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })
  const subscriber = existing.docs[0]

  if (subscriber) {
    if (subscriber.status === 'unsubscribed') {
      await req.payload.update({
        collection: 'newsletter-subscribers',
        id: subscriber.id,
        data: { status: 'subscribed', subscribedAt: new Date().toISOString() },
        overrideAccess: true,
      })
    }
  } else {
    await req.payload.create({
      collection: 'newsletter-subscribers',
      data: { email, status: 'subscribed', source: 'website' },
      overrideAccess: true,
    })
  }

  return sendSuccess({ subscribed: true })
}

export const newsletterSubscribeEndpoint: Endpoint = {
  path: '/newsletter/subscribe',
  method: 'post',
  handler: asyncHandler(handler),
}
