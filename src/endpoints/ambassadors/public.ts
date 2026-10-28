import type { Endpoint } from 'payload'
import { z } from 'zod'
import { AppError } from '../../types/index.js'
import { isStrongPassword } from '../../utils/sanitize.js'
import { generateUniqueAmbassadorCode } from '../../lib/ambassadors/codes.js'
import { getAmbassadorSettings } from '../../lib/ambassadors/settings.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { asyncHandler, parseBody, readJsonBody, sendSuccess } from '../../middleware/validate.js'
import { createPayloadRateLimiterFor, accountIdentity } from '../../lib/rate-limiter.js'
import { getNigerianBanks, resolveBankAccount } from '../../lib/ambassadors/banks.js'
import { issueVerification, maskEmail, verifyAmbassadorEmail, resendAmbassadorVerification } from '../../lib/ambassadors/verification.js'
import { hashToken } from '../../utils/generate-code.js'
import { withTransaction } from '../../lib/ambassadors/ledger.js'
import type { AmbassadorDoc } from '../../lib/ambassadors/types.js'

const applyRateLimiter = createPayloadRateLimiterFor('ambassador-apply', 5, 60 * 60)
const bankResolveRateLimiter = createPayloadRateLimiterFor('ambassador-bank-resolve', 20, 60 * 60)
const otpRateLimiter = createPayloadRateLimiterFor('ambassador-otp-verify', 10, 15 * 60)
const resendRateLimiter = createPayloadRateLimiterFor('ambassador-resend-verification', 5, 60 * 60)

const bankSchema = z.object({ bankCode: z.string().trim().min(1).max(20), accountNumber: z.string().regex(/^\d{10}$/) })
const existingApplicantSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._]{3,30}$/),
  promotionPlan: z.string().trim().max(2000),
  about: z.string().trim().max(2000),
  heardAbout: z.string().trim().max(200).optional().default(''),
  bank: bankSchema.optional(),
})
const newApplicantSchema = existingApplicantSchema.extend({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(1),
  confirmPassword: z.string().min(1),
})
const resolveSchema = bankSchema
const verifySchema = z.union([
  z.object({ email: z.string().trim().email().max(254), code: z.string().regex(/^\d{6}$/) }),
  z.object({ token: z.string().min(32).max(256) }),
])
const resendSchema = z.object({ email: z.string().trim().email().max(254) })

function withCacheControl(data: unknown, seconds: number): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${seconds}, s-maxage=${seconds}` },
  })
}

function publicBankError(): AppError {
  return new AppError('VALIDATION_ERROR', "We couldn't find this account. Check the number and bank.", {
    accountNumber: "We couldn't find this account. Check the number and bank.",
  })
}

async function bankDetails(bankCode: string): Promise<{ code: string; name: string }> {
  const bank = (await getNigerianBanks()).find((row) => row.code === bankCode)
  if (!bank) throw new AppError('VALIDATION_ERROR', 'Choose a supported Nigerian bank.', { bankCode: 'Choose a supported Nigerian bank.' })
  return bank
}

export const ambassadorConfigEndpoint: Endpoint = {
  path: '/ambassadors/config',
  method: 'get',
  handler: asyncHandler(async (req) => {
    const settings = await getAmbassadorSettings(req.payload)
    return withCacheControl({
      programOpen: settings.programOpen,
      commissionPercent: settings.commissionRateBps / 100,
      approvalDelayDays: settings.approvalDelayDays,
      minPayoutKobo: settings.minPayoutKobo,
      payoutsEnabled: settings.payoutsEnabled,
      payoutMode: settings.payoutMode,
      heardAboutOptions: settings.heardAboutOptions,
      shareMessage: settings.shareMessage,
    }, 300)
  }),
}

export const ambassadorBanksEndpoint: Endpoint = {
  path: '/ambassadors/banks',
  method: 'get',
  handler: asyncHandler(async () => sendSuccess(await getNigerianBanks())),
}

export const ambassadorResolveBankEndpoint: Endpoint = {
  path: '/ambassadors/banks/resolve',
  method: 'post',
  handler: asyncHandler(async (req) => {
    await bankResolveRateLimiter.check(req)
    const body = parseBody(resolveSchema, await readJsonBody(req))
    await bankDetails(body.bankCode)
    try {
      return sendSuccess({ accountName: await resolveBankAccount(body.bankCode, body.accountNumber) })
    } catch (error) {
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') throw publicBankError()
      throw error
    }
  }),
}

export const ambassadorApplyEndpoint: Endpoint = {
  path: '/ambassadors/apply',
  method: 'post',
  handler: asyncHandler(async (req) => {
    await applyRateLimiter.check(req)
    const settings = await getAmbassadorSettings(req.payload)
    if (!settings.programOpen) throw new AppError('FEATURE_DISABLED', 'Applications are currently closed.')

    const signedIn = Boolean(req.headers.get('authorization'))
    let firstName = ''
    let lastName = ''
    let email = ''
    let password: string | null = null
    let applicantUserId: number | null = null
    let username = ''
    let promotionPlan = ''
    let about = ''
    let heardAbout = ''
    let bankInput: z.infer<typeof bankSchema> | undefined

    if (signedIn) {
      const body = parseBody(existingApplicantSchema, await readJsonBody(req))
      const user = await requireAuth(req)
      applicantUserId = user.id
      email = user.email
      username = body.username
      promotionPlan = body.promotionPlan
      about = body.about
      heardAbout = body.heardAbout ?? ''
      bankInput = body.bank
      const existing = await req.payload.find({ collection: 'ambassadors', where: { user: { equals: user.id } }, limit: 1, depth: 0, overrideAccess: true })
      if (existing.docs.length) throw new AppError('ALREADY_EXISTS', 'You already have an ambassador application.')
    } else {
      const body = parseBody(newApplicantSchema, await readJsonBody(req))
      if (body.password !== body.confirmPassword) throw new AppError('VALIDATION_ERROR', 'Passwords do not match.', { confirmPassword: 'Passwords do not match.' })
      if (!isStrongPassword(body.password)) throw new AppError('VALIDATION_ERROR', 'Use at least 8 characters, including uppercase and lowercase letters, a number, and a symbol.', { password: 'Use at least 8 characters, including uppercase and lowercase letters, a number, and a symbol.' })
      firstName = body.firstName
      lastName = body.lastName
      email = body.email.trim().toLowerCase()
      password = body.password
      username = body.username
      promotionPlan = body.promotionPlan
      about = body.about
      heardAbout = body.heardAbout ?? ''
      bankInput = body.bank
      const userExists = await req.payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, depth: 0, overrideAccess: true })
      if (userExists.docs.length) throw new AppError('ALREADY_EXISTS', 'You already have a SkillsAir account. Sign in to apply with it.', { email: 'You already have a SkillsAir account. Sign in to apply with it.' })
    }

    const usernameExists = await req.payload.find({ collection: 'ambassadors', where: { username: { equals: username } }, limit: 1, depth: 0, overrideAccess: true })
    if (usernameExists.docs.length) throw new AppError('ALREADY_EXISTS', 'That username is already taken.', { username: 'That username is already taken.' })

    const bank = bankInput ? await bankDetails(bankInput.bankCode) : null
    const accountName = bankInput ? await resolveBankAccount(bankInput.bankCode, bankInput.accountNumber).catch((error: unknown) => {
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') throw publicBankError()
      throw error
    }) : null
    const code = await generateUniqueAmbassadorCode(req.payload)
    let createdUserId: number | null = applicantUserId
    let createdAmbassadorId: number | null = null
    let createdBankId: number | null = null

    try {
      const result = await withTransaction(req.payload, async (txReq) => {
        let applicant: { id: number; email: string }
        if (applicantUserId !== null) {
          applicant = { id: applicantUserId, email }
        } else {
          if (!password) throw new AppError('VALIDATION_ERROR', 'A password is required.', { password: 'A password is required.' })
          applicant = await req.payload.create({
            collection: 'users',
            data: {
              firstName,
              lastName,
              email,
              password,
              role: 'student',
              isStudent: false,
              isVerified: false,
              isActive: true,
              marketingConsent: 'unknown',
            },
            overrideAccess: true,
            context: { skipWelcomeEmail: true },
            req: txReq,
          }) as unknown as { id: number; email: string }
        }
        createdUserId = applicant.id
        const ambassador = await req.payload.create({
          collection: 'ambassadors',
          data: {
            user: applicant.id,
            code,
            username,
            status: 'pending',
            source: 'self',
            promotionPlan,
            about,
            heardAbout,
          },
          overrideAccess: true,
          req: txReq,
        }) as unknown as AmbassadorDoc
        createdAmbassadorId = ambassador.id
        if (bankInput && bank && accountName) {
          const account = await req.payload.create({
            collection: 'ambassador-bank-accounts',
            data: {
              ambassador: ambassador.id,
              bankCode: bank.code,
              bankName: bank.name,
              accountName,
              accountNumber: bankInput.accountNumber,
              accountLast4: bankInput.accountNumber.slice(-4),
              resolvedAt: new Date().toISOString(),
              isCurrent: true,
            },
            overrideAccess: true,
            req: txReq,
          })
          createdBankId = Number(account.id)
        }
        return ambassador
      })

      const verification = await issueVerification(req.payload, result)
      return sendSuccess({
        ambassadorId: result.id,
        status: result.status,
        verification: { sentTo: maskEmail(verification.email), resendAfterSeconds: verification.resendAfterSeconds },
      }, undefined, 201)
    } catch (error) {
      if (!signedIn) {
        // The user, ambassador and bank account are rolled back together when Payload transactions
        // are available; these deletes are the compensating path if Redis/setup failed after commit.
        if (createdBankId) await req.payload.delete({ collection: 'ambassador-bank-accounts', id: createdBankId, overrideAccess: true }).catch(() => undefined)
        if (createdAmbassadorId) await req.payload.delete({ collection: 'ambassadors', id: createdAmbassadorId, overrideAccess: true }).catch(() => undefined)
        if (createdUserId) await req.payload.delete({ collection: 'users', id: createdUserId, overrideAccess: true }).catch(() => undefined)
      }
      throw error
    }
  }),
}

export const ambassadorVerifyEmailEndpoint: Endpoint = {
  path: '/ambassadors/verify-email',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const body = parseBody(verifySchema, await readJsonBody(req))
    const identity = 'email' in body ? accountIdentity(body.email) : `token:${hashToken(body.token)}`
    await otpRateLimiter.check(req, identity)
    const status = await verifyAmbassadorEmail(req.payload, body)
    return sendSuccess({ status })
  }),
}

export const ambassadorResendVerificationEndpoint: Endpoint = {
  path: '/ambassadors/resend-verification',
  method: 'post',
  handler: asyncHandler(async (req) => {
    const body = parseBody(resendSchema, await readJsonBody(req))
    try {
      await resendRateLimiter.check(req, accountIdentity(body.email))
      await resendAmbassadorVerification(req.payload, body.email)
    } catch {
      // This endpoint always has the same response, including when the limiter, Redis or mail fails.
    }
    return sendSuccess({ sent: true })
  }),
}
