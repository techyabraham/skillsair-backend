/**
 * Suggested answers for Imisi when people reply to the learning nudges (I2: "reply with a
 * number") and the win-back emails (R2: "money, time or the programme?"). Brief section 15.
 * Shown as quick inserts in Imisi's queue; edit the [bracketed] parts before sending.
 *
 * Replies to any SkillsAir email land in hello@skillsair.com (EMAIL_REPLY_TO), which Imisi reads.
 */
export interface QuickReply {
  label: string
  body: string
}

export const EMAIL_QUICK_REPLIES: QuickReply[] = [
  {
    label: '1 · No time',
    body: 'Totally understand. Try two 20-minute sessions this week instead of one long one. Pick a time you can protect, like first thing in the morning. Your next lesson is: [next lesson].',
  },
  {
    label: '2 · Stuck',
    body: "Tell me which lesson and what's confusing, and I'll point you to the right part, or ask the tutor.",
  },
  {
    label: "3 · Not sure it's for me",
    body: "That's worth knowing early. If you're within the refund window, I can help with that. If not, you might enjoy [a phone-friendly programme] more; your rate would stay at ₦2,000 a month.",
  },
  {
    label: 'Money',
    body: 'Your ₦2,000-a-month rate never expires, so come back whenever you’re ready. If someone can help, they can pay by bank transfer, OPay or their own card at checkout.',
  },
]
