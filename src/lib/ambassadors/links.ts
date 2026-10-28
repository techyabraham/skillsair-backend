/** Builds a referral URL from the configured student-site origin. */
export function ambassadorCodeLink(code: string): string {
  const origin = (process.env.MAIN_SITE_URL ?? process.env.FRONTEND_URL ?? 'https://skillsair.com').replace(/\/$/, '')
  return `${origin}/?ref=${encodeURIComponent(code)}`
}
