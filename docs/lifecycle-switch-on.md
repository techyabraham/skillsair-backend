# Switching on the lifecycle emails (brief step 6)

The engine is built and tested; nothing is sent to real people until you switch it on here. Work through this on **staging first**, then production. Allow about two weeks for production: 48 hours of dry-run, then about 48 hours per track.

## 0. Before anything sends

- [ ] Backend deployed from `email-lifecycle/phase-1`, migrations run (`20261017_090000_email_lifecycle`, `20261018_090000_email_content`, `20261018_120000_message_outcomes`).
- [ ] `npm run migrate:followups -- --execute` run once (copies the old follow-up history, so nothing goes twice).
- [ ] Sender domains, DMARC and the Resend webhook set up: `docs/email-deliverability.md`. A Gmail test shows SPF, DKIM and DMARC `PASS` for both subdomains.
- [ ] WhatsApp templates 8–13 submitted to Meta (`docs/whatsapp-templates.md`). They can go live later; until approved, those WhatsApp steps are skipped and logged.
- [ ] `LIFECYCLE_DRY_RUN=true` (the default) and `LIFECYCLE_LIVE_TRACKS` empty.
- [ ] Optional content filled in the admin: **Email content** (founder anecdote, approved proof), each school's **free exercise**, each programme's **next programmes**, the **laptop-application deadline** on the scholarship window. Empty fields are simply left out.

## 1. Dry-run for 48 hours

The hourly job records what it *would* send as `dry_run` rows in **Messages**.

```bash
npm run lifecycle:dry-run
```

Check the report and **Admin → Lifecycle emails**:
- Volumes look sensible (no step going to thousands of people unexpectedly).
- Skip reasons make sense (`no_consent`, `learning_no_selling`, `stale`...).
- Open a few rows' people and confirm the step fits where they are.
- Preview every email: `/api/email/preview/index` (signed in as an admin).

## 2. Switch on one track at a time

Set `LIFECYCLE_DRY_RUN=false`, then grow `LIFECYCLE_LIVE_TRACKS`, restarting the backend each time. Watch **Admin → Lifecycle emails** for 48 hours between steps. Any red row (unsubscribes over 1% or complaints over 0.1%) means pause that track (remove it from the list) and look at the copy and audience.

| Order | `LIFECYCLE_LIVE_TRACKS` | What starts |
|---|---|---|
| 1 | `T,D` | Receipts, welcome, renewal notices, failed-payment emails (protect revenue) |
| 2 | `T,D,B` | Checkout help |
| 3 | `T,D,B,A` | Pre-payment sequence (A1–A7, W1). Warm-up limits apply (`docs/email-deliverability.md`) |
| 4 | `T,D,B,A,I` | Learning nudges |
| 5 | `T,D,B,A,I,R` | Win-back at the locked rate |
| 6 | `T,D,B,A,I,R,C` | Certificate emails |
| 7 | `T,D,B,A,I,R,C,G` | Next programme |
| 8 | `all` | Re-permission and sunset (X) |

`LIFECYCLE_MAX_MARKETING_PER_RUN` (default 500) caps marketing sends per hour; lower it during warm-up.

## 3. Acceptance checks on staging (brief section 16)

Use Paystack **test mode** and test cards. Never a live key on staging.

- [ ] **Lead without payment:** apply with consent → A0 at once, A1 after an hour, then A2–A5 daily (outside the weekly cap), A6 48 hours before close, A7 on closing day at 9am. Close the window → P1 the next day. Reopen → W1.
- [ ] **Unticked consent:** apply without consent → A0 only (transactional); `no_consent` rows for the rest; no WhatsApp marketing.
- [ ] **Paying stops sales:** pay during Track A → T1; no further A or B steps (stages are recomputed every run).
- [ ] **Checkout not finished:** start checkout, abandon → B1 after 1 hour, payment-help WhatsApp after 2, B2 at 24 hours.
- [ ] **Failed renewal:** a test card that fails renewal → D1 (email + WhatsApp), access kept 3 days, D2, D3, then T6 and access paused. T6's button restarts at ₦2,000 a month **with the window closed**.
- [ ] **Graduates:** completing a programme → T8 (billing stopped); a new programme at ₦2,000 a month within 3 days, the price of the day after that. Buying the certificate → T9, then Track G.
- [ ] **Brand-new user, window closed:** cannot buy the ₦2,000 plan.
- [ ] **No selling while learning:** someone studying one programme gets no A, R, C or G emails.
- [ ] **Unsubscribe:** Gmail shows its own "Unsubscribe" link on marketing emails; using it stops that category at once, and the message shows as unsubscribed in the dashboard.
- [ ] **Bounces:** send to `bounced@resend.dev` → the address is suppressed; only a password reset still reaches it.
- [ ] **Regression:** registration, login, password reset, Apply → offer → checkout → callback, monthly subscription (new, renewal, cancel), certificate purchase and the dashboard all still work.

## 4. Reading the dashboard

**Admin → Lifecycle emails** (`/admin/lifecycle`) shows each step over the last 30 days: sent, opened, clicked, converted, unsubscribed, spam, and A/B versions. Judge steps by **converted** (a subscription within 7 days of a click for A, B and G; a recovered payment for D; a restart for R; a certificate for C; a lesson within 72 hours for I). Opens are unreliable because Apple Mail opens emails automatically.

A/B subject lines run on A0, A1, A6, B1 and T6; each person always sees the same version. Pick a winner once each version has a few hundred sends, then move the winning line into the template's main subject (or set `LIFECYCLE_AB_TESTS=false`).
