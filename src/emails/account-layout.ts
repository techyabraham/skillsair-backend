/**
 * The account-email wrapper (green header, grey footer) that welcome, enrolment, access-extended
 * and the internal lead summary have always used. Kept as it was so those emails don't change;
 * wording inside it comes from copy slots, escaped here so an override can never inject HTML.
 */
const BRAND_COLOR = '#1B5E20'

export const accountSite = () => process.env.FRONTEND_URL ?? 'https://skillsair.com'

/** Escapes &, <, > and " (the wrapper's own rule; apostrophes stay as they are). */
export function escapeAccountHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Escapes text, then turns **bold** into <strong>. */
export const accountInline = (text: string) => escapeAccountHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

export const accountFooter = (site: string) => `You're receiving this email because you have an account with SkillsAir.
              <a href="${site}/unsubscribe" style="color:#a1a1aa;">Unsubscribe</a>`

export function accountButton(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;margin-top:16px;">${escapeAccountHtml(label)}</a>`
}

export function wrapAccountHtml(bodyHtml: string, footerHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background-color:${BRAND_COLOR};padding:24px 32px;">
              <h1 style="color:#ffffff;font-size:20px;margin:0;">SkillsAir</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#27272a;font-size:15px;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;background-color:#fafafa;color:#a1a1aa;font-size:12px;">
              ${footerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
