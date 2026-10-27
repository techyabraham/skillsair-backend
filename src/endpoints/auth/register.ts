import type { Endpoint, PayloadRequest } from 'payload'
import { z } from 'zod'
import { parseBody, sendSuccess, asyncHandler, readJsonBody } from '../../middleware/validate.js'
import { accountIdentity, authAccountRateLimiter, authIpRateLimiter } from '../../lib/rate-limiter.js'
import { sanitizeText, isStrongPassword, isValidE164Phone } from '../../utils/sanitize.js'
import { generateAuthTokenPair, verifyLeadToken } from '../../lib/jwt.js'
import { findLeadByEmail, normalizePhone, scoreLeadEvent, type LeadDoc } from '../../lib/leads.js'
import { logger } from '../../lib/logger.js'
import { AppError } from '../../types/index.js'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).refine(isStrongPassword, {
    message: 'Password must include uppercase, lowercase, a digit, and a special character',
  }),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().min(7).max(25),
  referralCode: z.string().optional(),
  marketingConsent: z.boolean().optional(),
  marketingConsentText: z.string().max(1000).optional(),
  leadToken: z.string().max(2000).optional(),
})

interface UserDoc {
  id: number
  email: string
  role: 'admin' | 'instructor' | 'student'
  firstName: string
  lastName: string
}

async function handler(req: PayloadRequest): Promise<Response> {
  const body = parseBody(registerSchema, await readJsonBody(req))
  await authAccountRateLimiter.check(req, accountIdentity(body.email))
  await authIpRateLimiter.check(req)

  const phone = normalizePhone(body.phone)
  if (!phone || !isValidE164Phone(phone)) {
    throw new AppError('VALIDATION_ERROR', 'Enter a valid WhatsApp number, like 0818 000 0000', {
      phone: 'Invalid phone format',
    })
  }

  const payload = req.payload

  // A lead token links this account to the application that started it.
  let lead: LeadDoc | null = null
  if (body.leadToken) {
    try {
      const { leadId } = verifyLeadToken(body.leadToken)
      lead = (await payload
        .findByID({ collection: 'leads', id: leadId, depth: 0, overrideAccess: true })
        .catch(() => null)) as unknown as LeadDoc | null
    } catch {
      lead = null
    }
  }
  if (!lead) lead = await findLeadByEmail(payload, body.email)

  const now = new Date().toISOString()
  const consentFromForm = body.marketingConsent === true
  const consentFromLead = !consentFromForm && Boolean(lead?.marketingConsent) && !lead?.optedOutAt
  const consent = consentFromForm || consentFromLead

  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: body.email.toLowerCase() } },
    limit: 1,
  })
  if (existing.totalDocs > 0) {
    throw new AppError('ALREADY_EXISTS', 'An account with this email already exists')
  }

  let referredBy: number | undefined
  if (body.referralCode) {
    const referrer = await payload.find({
      collection: 'users',
      where: { referralCode: { equals: body.referralCode.toUpperCase() } },
      limit: 1,
    })
    if (referrer.totalDocs > 0) {
      referredBy = referrer.docs[0]?.id as number
    }
  }

  const created = (await payload.create({
    collection: 'users',
    data: {
      email: body.email.toLowerCase(),
      password: body.password,
      firstName: sanitizeText(body.firstName),
      lastName: sanitizeText(body.lastName),
      phone,
      role: 'student',
      isStudent: true,
      referredBy,
      ...(consent
        ? {
            marketingConsent: 'opted_in',
            marketingConsentAt: consentFromLead ? lead?.marketingConsentAt ?? now : now,
            marketingConsentSource: consentFromLead ? 'lead' : 'web_register',
            lifecycle: { emailPrefs: { offers: true, learningReminders: true } },
          }
        : {}),
    },
    overrideAccess: true,
  })) as unknown as UserDoc

  if (referredBy) {
    await payload.create({
      collection: 'referrals',
      data: {
        referrer: referredBy,
        referredUser: created.id,
        referralCode: body.referralCode?.toUpperCase() ?? '',
        status: 'registered',
      },
      overrideAccess: true,
    })
  }

  if (lead) {
    try {
      await payload.update({
        collection: 'leads',
        id: lead.id,
        data: {
          user: created.id,
          ...scoreLeadEvent(lead, { type: 'account_created' }),
          ...(consentFromForm
            ? {
                marketingConsent: true,
                marketingConsentAt: now,
                marketingConsentText: body.marketingConsentText ? sanitizeText(body.marketingConsentText) : lead.marketingConsentText,
                optedOutAt: null,
              }
            : {}),
        },
        depth: 0,
        overrideAccess: true,
      })
    } catch (err) {
      logger.error({ err, leadId: lead.id }, 'register_lead_link_failed')
    }
  }

  const tokens = generateAuthTokenPair(created.id, created.role)
  return sendSuccess(
    {
      user: {
        id: created.id,
        email: created.email,
        firstName: created.firstName,
        lastName: created.lastName,
        role: created.role,
      },
      ...tokens,
    },
    undefined,
    201,
  )
}

export const registerEndpoint: Endpoint = {
  path: '/auth/register',
  method: 'post',
  handler: asyncHandler(handler),
}
