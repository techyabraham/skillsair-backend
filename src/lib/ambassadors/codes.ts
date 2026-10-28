import type { Payload } from 'payload'
import { generateReferralCode } from '../../utils/generate-code.js'

const MAX_ATTEMPTS = 10

/**
 * A referral code no ambassador and no user (users.referralCode, the legacy column) already has.
 * Tries up to 10 codes, then throws. The unique index on ambassadors.code still guards the insert.
 */
export async function generateUniqueAmbassadorCode(payload: Payload, generate: () => string = generateReferralCode): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generate()
    const [ambassadors, users] = await Promise.all([
      payload.count({ collection: 'ambassadors', where: { code: { equals: code } }, overrideAccess: true }),
      payload.count({ collection: 'users', where: { referralCode: { equals: code } }, overrideAccess: true }),
    ])
    if (ambassadors.totalDocs === 0 && users.totalDocs === 0) return code
  }
  throw new Error(`Could not generate a unique ambassador code in ${MAX_ATTEMPTS} attempts`)
}
