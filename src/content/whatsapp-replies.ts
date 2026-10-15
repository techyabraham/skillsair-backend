/**
 * Free-form WhatsApp replies (Section 7.5 of the rebuild brief). These are only sent
 * inside the 24-hour window that opens when the person messages or taps a button.
 * Every message speaks as Imisi; an AI assistant must never present itself as Imisi.
 */

export const QUICK_REPLY_PAYLOADS = {
  howItWorks: 'HOW_IT_WORKS',
  requirements: 'REQUIREMENTS',
  talk: 'TALK',
} as const

export const STOP_WORDS = ['STOP', 'UNSUBSCRIBE', 'STOP ALL']
export const START_WORDS = ['START']

const naira = (amount: number) => `₦${amount.toLocaleString('en-NG')}`

export interface HowItWorksFacts {
  date: string
  offerLink: string
  windowOpen: boolean
  price: number
  standardPrice: number
  certificatePrice: number
}

export function howItWorksReply({ date, offerLink, windowOpen, price, standardPrice, certificatePrice }: HowItWorksFacts): string {
  const priceLine = windowOpen
    ? `💳 ${naira(price)} to start with your Access Scholarship (standard fee ${naira(standardPrice)})`
    : `💳 Standard fee ${naira(standardPrice)}. We'll message you when the next Access Scholarship window opens`
  return [
    "Here's how SkillsAir works 👇",
    '',
    '📚 Self-paced: start today, take up to 3 months, about 8 hours a week',
    priceLine,
    `🎓 When you finish: a verifiable certificate for ${naira(certificatePrice)}`,
    '🎁 Free CV & LinkedIn and Freelancing courses',
    '🤝 Certified graduates get access to internship openings from our partner firms',
    '',
    date ? `Your offer is here, valid until ${date}: ${offerLink}` : `Your offer is here: ${offerLink}`,
  ].join('\n')
}

export function requirementsReply(programme: string, requirementsShort: string, phoneFriendly: boolean, phoneFriendlyList: string): string {
  const intro = requirementsShort
    ? `Good question. For ${programme}, you'll need: ${requirementsShort}.`
    : `Good question. ${programme} lists exactly what you'll need on its programme page.`
  if (phoneFriendly) return `${intro}\n\nGood news: you can do this one fully on your phone 📱`
  const alternatives = phoneFriendlyList
    ? ` If you only have a phone right now, these programmes work fully on a phone: ${phoneFriendlyList}.`
    : ''
  return `${intro}\n\nThis one needs a laptop for some of the work.${alternatives}`
}

export const TALK_IN_HOURS = 'Sure! I\'ll reply here shortly. While you wait, what would you like to know?'

export function talkOutOfHours(offerLink: string): string {
  return `Thanks for reaching out! I'm available Monday to Saturday, 9am–6pm, and I'll reply as soon as I'm back. Your offer is still here: ${offerLink}`
}

export const STOP_REPLY = "Done. You won't get any more messages from SkillsAir. If you change your mind, reply START."

export const START_REPLY = "Welcome back! You'll get SkillsAir updates here again."
