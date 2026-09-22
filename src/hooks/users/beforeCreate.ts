import type { CollectionBeforeChangeHook, BasePayload } from 'payload'
import { generateReferralCode } from '../../utils/generate-code.js'
import { sanitizeText } from '../../utils/sanitize.js'

interface UserChangeData {
  firstName?: string
  lastName?: string
  referralCode?: string
  [key: string]: unknown
}

async function generateUniqueReferralCode(payload: BasePayload): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode()
    const existing = await payload.find({
      collection: 'users',
      where: { referralCode: { equals: code } },
      limit: 1,
    })
    if (existing.totalDocs === 0) return code
  }
  throw new Error('Unable to generate a unique referral code')
}

export const usersBeforeCreate: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  const typedData = data as UserChangeData

  if (typeof typedData.firstName === 'string') {
    typedData.firstName = sanitizeText(typedData.firstName)
  }
  if (typeof typedData.lastName === 'string') {
    typedData.lastName = sanitizeText(typedData.lastName)
  }

  if (operation === 'create' && !typedData.referralCode) {
    typedData.referralCode = await generateUniqueReferralCode(req.payload)
  }

  return typedData
}
