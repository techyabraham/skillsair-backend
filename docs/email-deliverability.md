# Email deliverability: sender setup for SkillsAir

SkillsAir sends email through Resend on two subdomains, so a marketing complaint can never stop a receipt or a password reset from arriving.

| Stream | Address (env) | Used for |
|---|---|---|
| Transactional | `EMAIL_FROM_TRANSACTIONAL` = `imisi@notify.skillsair.com` | Receipts, payment failed, access paused, cancellation, completion, certificate, password reset, verification, the offer someone just asked for |
| Marketing and service | `EMAIL_FROM_MARKETING` = `imisi@mail.skillsair.com` | Sales sequences (Tracks A, B2–B3, R, C, G, X), learning nudges, upcoming-charge and expiring-card notices |

- The sender name is always **Imisi from SkillsAir** (`EMAIL_FROM_NAME`). Don't change it; people learn to recognise it.
- Replies go to `EMAIL_REPLY_TO` = `hello@skillsair.com`, which Imisi reads. Never send from a `noreply@` address.
- `EMAIL_FROM` (the old single address) is still read as a fallback for the transactional stream. Remove it once the two new variables are set.

## 1. Add both domains in Resend

In Resend: **Domains → Add domain**, once for `notify.skillsair.com` and once for `mail.skillsair.com`. Choose the region closest to your users (eu-west-1 is fine for Nigeria).

Resend then shows the exact DNS records for each domain. Copy them **exactly as Resend shows them**; the values below are the shape only, and the DKIM key is unique to your account.

| Type | Name (host) | Value | Purpose |
|---|---|---|---|
| TXT | `resend._domainkey.notify` | `p=MIGfMA0GCSq…` (from Resend) | DKIM signature for notify.skillsair.com |
| MX | `send.notify` | `feedback-smtp.<region>.amazonses.com`, priority 10 | Bounce handling (Return-Path) |
| TXT | `send.notify` | `v=spf1 include:amazonses.com ~all` | SPF for the Return-Path domain |
| TXT | `resend._domainkey.mail` | `p=MIGfMA0GCSq…` (from Resend) | DKIM for mail.skillsair.com |
| MX | `send.mail` | `feedback-smtp.<region>.amazonses.com`, priority 10 | Bounce handling |
| TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` | SPF |

Host names are shown relative to `skillsair.com`; some DNS panels want the full name (for example `resend._domainkey.notify.skillsair.com`). Wait for Resend to show both domains as **Verified**.

## 2. Add DMARC

Add one record for the organisational domain (it covers the subdomains unless they have their own):

| Type | Name | Value |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@skillsair.com; fo=1; adkim=r; aspf=r` |

- Start with `p=none` and read the aggregate reports sent to `dmarc@skillsair.com` (create that mailbox, or use a free DMARC report service).
- After **30 days** of clean reports (Resend's mail passes DKIM and SPF alignment, and nothing unexpected sends as skillsair.com), change to `p=quarantine`.
- If `skillsair.com` already has a DMARC record, edit it rather than adding a second one.

**Do not switch on any marketing track until DMARC passes for both subdomains.** Check it by sending a test to a Gmail account and opening **Show original**: SPF, DKIM and DMARC must all say `PASS`.

## 3. Webhooks (bounces, complaints, opens, clicks)

In Resend: **Webhooks → Add endpoint**.

- URL: `https://<backend host>/api/email/webhook` (the backend origin in `SKILLSAIR_BACKEND_URL`, for example `https://kiwi.skillsair.com/api/email/webhook`).
- Events: `email.bounced`, `email.complained`, `email.opened`, `email.clicked`, `email.delivered`.
- Copy the signing secret (`whsec_…`) into the backend's `RESEND_WEBHOOK_SECRET`. Requests without a valid signature are rejected.

What the backend does:
- **Hard bounce** or **spam complaint**: the address is suppressed (`emailSuppressed` on the user and the lead). It gets no further email of any kind except a password reset someone requests.
- **Click**: counts as engagement (`lastEngagedAt`) for the 90-day sunset rule.
- **Open**: recorded on the message only. Apple Mail Privacy Protection opens emails automatically, so opens alone don't count as engagement.

Turn on **click tracking** for `mail.skillsair.com` in Resend (open tracking is optional). Leave tracking off for `notify.skillsair.com`, so receipts and password links aren't rewritten.

## 4. One-click unsubscribe (Gmail and Yahoo bulk-sender rules)

Every marketing and service email carries:

```
List-Unsubscribe: <https://<backend host>/api/email/unsubscribe?token=…>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

The POST endpoint unsubscribes that email's category at once, without a login or a page. The visible footer links to the preference centre (`/email-preferences`) on the website.

A `mailto:` unsubscribe is only added when `EMAIL_UNSUBSCRIBE_MAILTO` is set. Set it only if that mailbox is actually processed (by a person or an inbound webhook); an unread mailto address breaks the promise to unsubscribe people.

## 5. Warm-up for the new marketing subdomain

`mail.skillsair.com` has no sending history, so mailbox providers will be cautious.

| Days | Marketing emails per day |
|---|---|
| 1–2 | 200 |
| 3–4 | 400 |
| 5–6 | 800 |
| 7–8 | 1,600 |
| then | keep doubling every 2 days |

Only double while the **bounce rate is under 2%** and **complaints are under 0.1%** (Resend dashboard, or the lifecycle admin view). If either goes over, hold the volume for two days and check the list source. Send to the most engaged people first: recent applicants before old imports.

Transactional email on `notify.skillsair.com` doesn't need a warm-up, because the volume follows real purchases.

## 6. Checklist before switching on marketing

- [ ] Both domains verified in Resend
- [ ] DMARC record live; a Gmail test shows SPF, DKIM and DMARC `PASS` for both subdomains
- [ ] `EMAIL_FROM_NAME`, `EMAIL_FROM_TRANSACTIONAL`, `EMAIL_FROM_MARKETING`, `EMAIL_REPLY_TO` set on the backend
- [ ] Webhook added and `RESEND_WEBHOOK_SECRET` set; a test bounce (Resend's `bounced@resend.dev`) marks the address suppressed
- [ ] Gmail shows its **Unsubscribe** link next to the sender on a marketing test email
- [ ] `hello@skillsair.com` is monitored for replies
