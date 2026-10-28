import type { CollectionBeforeChangeHook } from 'payload'
import { sanitizeText } from '../../utils/sanitize.js'

interface UserChangeData {
  firstName?: string
  lastName?: string
  referralCode?: string
  [key: string]: unknown
}

export const usersBeforeCreate: CollectionBeforeChangeHook = async ({ data }) => {
  const typedData = data as UserChangeData

  if (typeof typedData.firstName === 'string') {
    typedData.firstName = sanitizeText(typedData.firstName)
  }
  if (typeof typedData.lastName === 'string') {
    typedData.lastName = sanitizeText(typedData.lastName)
  }

  return typedData
}
