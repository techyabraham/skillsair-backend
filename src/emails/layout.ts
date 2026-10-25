/**
 * The plain, letter-like layout every SkillsAir email uses: single column, 600px max,
 * system fonts, 16px body, one orange button (also repeated as a plain link), a small text
 * logo and no images, so it reads like a note from Imisi and stays dark-mode safe.
 * Every email has a hidden preheader and a plain-text part.
 */
import { getSettings } from './override-store.js'

export type EmailKind = 'transactional' | 'service' | 'marketing'

/** A paragraph (plain text; **bold** allowed), a list, a table of label/value rows, or small print. */
export type Block =
  | string
  | { list: string[]; ordered?: boolean }
  | { rows: Array<{ label: string; value: string; struck?: boolean; strong?: boolean }>; caption?: string }
  | { small: string }

export interface EmailButton {
  label: string
  url: string
}

export interface EmailBody {
  blocks: Block[]
  button?: EmailButton
  ps?: string
}

export interface FooterLinks {
  /** Preference centre, for marketing and service email. */
  preferencesUrl?: string
  /** Visible "Unsubscribe" link (the one-click header is set separately). */
  unsubscribeUrl?: string
}

export interface LayoutInput extends EmailBody, FooterLinks {
  kind: EmailKind
  subject: string
  preheader: string
}

export const COMPANY_LINE = 'SKILLS AIR LIMITED (RC 9272398), Osifila Street, Anifowose, Ikeja, Lagos.'
export const SIGN_OFF_NAME = 'Imisi, SkillsAir'
export const SIGN_OFF_HELP = 'Questions? Reply to this email, or WhatsApp me on +234 818 212 6524 (Mon–Sat, 9am–6pm).'
/** The sign-off and company line, as set in Studio (Email settings), else the constants above. */
export const signOffName = () => getSettings().signOffName || SIGN_OFF_NAME
export const signOffHelp = () => getSettings().signOffHelp || SIGN_OFF_HELP
export const companyLine = () => getSettings().companyLine || COMPANY_LINE
const CTA = '#c2410c'
const INK = '#1f2937'
const MUTED = '#6b7280'
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function frontendOrigin(): string {
  return (process.env.FRONTEND_URL ?? 'https://skillsair.com').replace(/\/+$/, '')
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Escapes text, then turns **bold** into <strong>. */
function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1')

/**
 * Adds utm_source=email&utm_medium={kind}&utm_campaign={track}&utm_content={stepId} to links
 * on the SkillsAir website. Other hosts (Paystack, LinkedIn) are left untouched.
 */
export function withUtm(url: string, kind: EmailKind, campaign: string, content: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  const site = new URL(frontendOrigin())
  const sameSite = parsed.hostname === site.hostname || parsed.hostname === `www.${site.hostname}`
  if (!sameSite) return url
  parsed.searchParams.set('utm_source', 'email')
  parsed.searchParams.set('utm_medium', kind)
  parsed.searchParams.set('utm_campaign', campaign)
  parsed.searchParams.set('utm_content', content)
  return parsed.toString()
}

function blockHtml(block: Block): string {
  const p = `margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};`
  if (typeof block === 'string') return `<p style="${p}">${inline(block)}</p>`
  if ('list' in block) {
    const tag = block.ordered ? 'ol' : 'ul'
    const items = block.list.map((item) => `<li style="margin:0 0 8px;">${inline(item)}</li>`).join('')
    return `<${tag} style="margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.6;color:${INK};">${items}</${tag}>`
  }
  if ('rows' in block) {
    const rows = block.rows
      .map((row) => {
        const value = row.struck ? `<s>${inline(row.value)}</s>` : row.strong ? `<strong>${inline(row.value)}</strong>` : inline(row.value)
        return `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:15px;color:${MUTED};">${inline(row.label)}</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:15px;color:${INK};text-align:right;">${value}</td></tr>`
      })
      .join('')
    const caption = block.caption ? `<p style="margin:8px 0 16px;font-size:13px;line-height:1.5;color:${MUTED};">${inline(block.caption)}</p>` : ''
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;">${rows}</table>${caption}`
  }
  return `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${MUTED};">${inline(block.small)}</p>`
}

function blockText(block: Block): string {
  if (typeof block === 'string') return plain(block)
  if ('list' in block) return block.list.map((item, index) => `${block.ordered ? `${index + 1}.` : '•'} ${plain(item)}`).join('\n')
  if ('rows' in block) {
    const rows = block.rows.map((row) => `${plain(row.label)}: ${plain(row.value)}${row.struck ? ' (no longer applies)' : ''}`).join('\n')
    return block.caption ? `${rows}\n${plain(block.caption)}` : rows
  }
  return plain(block.small)
}

function footerHtml(input: LayoutInput): string {
  const link = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="color:${MUTED};text-decoration:underline;">${label}</a>`
  const privacy = link(`${frontendOrigin()}/privacy`, 'Privacy notice')
  if (input.kind === 'transactional') {
    return `This is an account email about your SkillsAir application, payments or learning.<br />${escapeHtml(companyLine())} We never sell your data. ${privacy}`
  }
  const links = [
    input.preferencesUrl ? link(input.preferencesUrl, 'Email preferences') : '',
    input.unsubscribeUrl ? link(input.unsubscribeUrl, 'Unsubscribe') : '',
  ].filter(Boolean).join(' · ')
  const why =
    input.kind === 'service'
      ? "You're getting this because you're learning with SkillsAir."
      : "You're getting this because you applied for a SkillsAir programme and said yes to updates."
  return `${why} ${links}<br />${escapeHtml(companyLine())} We never sell your data. ${privacy}`
}

export function renderHtml(input: LayoutInput): string {
  const button = input.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:8px;background:${CTA};">
        <a href="${escapeHtml(input.button.url)}" style="display:inline-block;min-height:44px;line-height:44px;padding:0 24px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;font-family:${FONT};">${escapeHtml(input.button.label)}</a>
      </td></tr></table>`
    : ''
  const ps = input.ps ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};"><strong>P.S.</strong> ${inline(input.ps)}</p>` : ''
  const fallbackLink = input.button
    ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${MUTED};">Button not working? Use this link: <a href="${escapeHtml(input.button.url)}" style="color:${CTA};word-break:break-all;">${escapeHtml(input.button.url)}</a></p>`
    : ''
  // Hidden preheader, padded so mail apps don't pull body text into the preview.
  const preheader = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(input.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
  <tr><td align="center" style="padding:24px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${FONT};">
      <tr><td style="padding:0 0 24px;font-size:15px;font-weight:700;letter-spacing:0.2px;color:#0d1b4b;">SkillsAir</td></tr>
      <tr><td>
        ${input.blocks.map(blockHtml).join('\n        ')}
        ${button}
        <p style="margin:0 0 4px;font-size:16px;line-height:1.6;color:${INK};">${escapeHtml(signOffName())}</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:${MUTED};">${escapeHtml(signOffHelp())}</p>
        ${ps}
        ${fallbackLink}
      </td></tr>
      <tr><td style="padding:20px 0 0;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:${MUTED};">${footerHtml(input)}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

export function renderText(input: LayoutInput): string {
  const parts = input.blocks.map(blockText)
  if (input.button) parts.push(`${input.button.label}: ${input.button.url}`)
  parts.push(`${signOffName()}\n${signOffHelp()}`)
  if (input.ps) parts.push(`P.S. ${plain(input.ps)}`)
  const footer: string[] = []
  if (input.kind === 'transactional') {
    footer.push('This is an account email about your SkillsAir application, payments or learning.')
  } else {
    footer.push(
      input.kind === 'service'
        ? "You're getting this because you're learning with SkillsAir."
        : "You're getting this because you applied for a SkillsAir programme and said yes to updates.",
    )
    if (input.preferencesUrl) footer.push(`Email preferences: ${input.preferencesUrl}`)
    if (input.unsubscribeUrl) footer.push(`Unsubscribe: ${input.unsubscribeUrl}`)
  }
  footer.push(`${companyLine()} We never sell your data. Privacy notice: ${frontendOrigin()}/privacy`)
  parts.push(`--\n${footer.join('\n')}`)
  return parts.join('\n\n')
}
