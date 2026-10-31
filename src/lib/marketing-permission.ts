/**
 * Who may receive marketing email and WhatsApp. Everyone who gives an email or phone number is on
 * the list by default, told so where they give it, and stays on it until they opt out: an
 * unsubscribe, a STOP reply or the preference centre. An opt-out always wins.
 */
export interface MarketingLead {
  optedOutAt?: string | null
}

export interface MarketingUser {
  marketingConsent?: 'unknown' | 'opted_in' | 'opted_out' | null
  lifecycle?: { emailPrefs?: { offers?: boolean | null } | null } | null
}

export function leadAllowsMarketing(lead: MarketingLead | null | undefined): boolean {
  return Boolean(lead) && !lead?.optedOutAt
}

export function userAllowsMarketing(user: MarketingUser, lead?: MarketingLead | null): boolean {
  if (lead?.optedOutAt || user.marketingConsent === 'opted_out') return false
  // opted_in with offers off is someone who turned offers off in the preference centre.
  if (user.marketingConsent === 'opted_in') return user.lifecycle?.emailPrefs?.offers === true
  return true
}
