# Deploying the SkillsAir career-pathway rebuild

This guide covers both services, so the same file lives in both repositories (`skillsair/docs/DEPLOYMENT.md` and `skillsair-backend/docs/DEPLOYMENT.md`). Keep the two copies in sync.

| Repository | Branch | What it deploys |
|---|---|---|
| `techyabraham/skillsair-backend` | `backend-rebuild/phase-1` | API (`Dockerfile`, port 3001), Payload admin (`Dockerfile.admin`, port 3000), migration runner (`Dockerfile.migrate`) |
| `techyabraham/skillsair` | `frontend-rebuild/phase-1` | Next.js site (`Dockerfile`, port 3000) |

Rollback tags were already on the remotes before this work: `pre-rebuild-backend` and `pre-rebuild`.

---

## 1. What changes when you deploy

**Backend**
- New `leads` collection, `laptop-applications` collection and `scholarship-window` global.
- New course fields: `standardPrice`, `standardMonthlyPrice`, `durationMonths`, `weeklyHours`, `phoneFriendly`.
- The **Access Scholarship is ₦2,000 a month**, billed by Paystack through each programme's scholarship plan (card only, renews monthly, cancel anytime). Scholarship plans can only be started while a window is open; learners who joined keep their rate. Outside a window: ₦40,000 a month (standard plan) or ₦100,000 once. A one-off programme payment is always the standard fee.
- Plans gain a `kind` (`scholarship` or `standard`); the public plans list never shows the scholarship plan.
- `POST /api/auth/register` now **requires a phone number**.
- New endpoints: `/api/leads` (and `/me`, `/resume/:code`, `/unsubscribe`, `/:id/whatsapp-reply`, `/:id/done`), `/api/offers/:courseSlug`, `/api/whatsapp/webhook`, `/api/laptop-applications/mine` and `/apply`.
- New background jobs: daily lead summary (08:30 WAT), hourly follow-ups, and a 15-minute scholarship-window check.
- Three schema migrations: `20261015_120000_rebuild_leads_pricing` (which also seeds the October 2026 window), `20261016_090000_laptop_applications` and `20261016_150000_plan_kind`.
- All ten schools always appear on the site; schools without published programmes show "Programmes coming soon" and take waitlist sign-ups.

**Frontend**
- The new public site: home, schools, programmes, Apply flow, offer, account step, legal pages, quiz, FAQ, contact, about, scholarship and outcomes.
- Public course APIs no longer return prices; checkout reads prices from the personal offer.
- `/courses` and `/courses/:slug` now 301 to `/schools` and `/programmes/:slug`.

> **Order matters.** The new backend requires a phone number at registration, and the new frontend depends on the new backend endpoints. Deploy the backend, run the migration, then deploy the frontend straight away. Only change course prices (the pricing seed) **after** the new frontend is live.

---

## 2. Before you start

1. **Back up the production database** (Coolify → PostgreSQL resource → Backups → "Backup now", or `pg_dump`). Don't continue without a fresh backup.
2. **Generate secrets** on your own machine and keep them in a password manager:
   ```bash
   openssl rand -hex 32
   ```
   You need one value for `BFF_SHARED_SECRET` (the **same** value on both services) and one for `WHATSAPP_VERIFY_TOKEN`.
3. **Submit the 8 WhatsApp templates now.** Meta's review can take a few days. The exact names, copy, buttons and sample values are in `skillsair-backend/docs/whatsapp-templates.md`. You can deploy safely before approval: nothing is sent while `WHATSAPP_ENABLED` is not `true`.
4. **Resend:** make sure the domain used by `EMAIL_FROM` is verified in Resend, because the offer and follow-up emails are sent from it.
5. **Build check.** The frontend has not been built locally, because AGENTS.md asks agents not to run `npm run build`. TypeScript, lint and runtime checks against a local backend all pass. The production Docker build runs `npm run build`, so do the first deploy to a **staging** application if you have one, or watch the first production build log closely.

---

## 3. Environment variables

### Backend: API service (runtime)

Keep all existing variables. Add:

| Variable | Value | Notes |
|---|---|---|
| `BFF_SHARED_SECRET` | 32+ random characters | Same value as the frontend. Lets per-IP rate limits apply to each visitor instead of to the whole frontend server. **Without it, the frontend's traffic shares one IP budget** (300 requests per 15 minutes, and 10 lead submissions per 15 minutes). |
| `LEAD_SUMMARY_EMAIL` | `hello@mail.skillsair.com` | Daily lead summary recipient |
| `ADMIN_URL` | e.g. `https://admin.skillsair.com` | Origin of the Payload admin, used for links in the daily summary. Defaults to `BACKEND_URL`. |
| `WHATSAPP_ENABLED` | `false` at first | Set to `true` only after the go-live checks in section 6 |
| `WHATSAPP_ACCESS_TOKEN` | System-user token | Meta Business settings → System users |
| `WHATSAPP_PHONE_NUMBER_ID` | From WhatsApp Manager | |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | From WhatsApp Manager | |
| `WHATSAPP_APP_SECRET` | Meta app secret | Used to verify `X-Hub-Signature-256` |
| `WHATSAPP_VERIFY_TOKEN` | Random string | Also entered in the Meta webhook settings |
| `WHATSAPP_API_VERSION` | `21.0` (or current) | |
| `CERTIFICATE_PRICE_NGN` | `10000` | Already present; now also the default when unset |
| `WHATSAPP_AI_ASSISTANT` | `false` | Optional FAQ assistant on WhatsApp. Leave off until WhatsApp is live and you've tested it. |
| `ANTHROPIC_API_KEY` | Anthropic API key | Only needed when the assistant is on |
| `WHATSAPP_AI_MODEL` | `claude-opus-5-5` | Model the assistant uses |

Check that `FRONTEND_URL=https://skillsair.com`: the personal resume links (`/r/<code>`) and email buttons use it. Also check that `CORS_ORIGINS` includes the frontend origin.

### Backend: admin service

The admin service shares the same database and config. Give it the same database, Payload and encryption variables as the API (as you do today). The WhatsApp variables are only needed on the API, because only the API sends messages; the admin's **WhatsApp reply** button sends through the same codebase, so add the WhatsApp variables to the admin service too if Imisi will reply from the admin.

### Backend: migration runner

The same `DATABASE_URI`, `PAYLOAD_SECRET` and settings as the API, from the **same commit**.

### Frontend

| Variable | Type | Value |
|---|---|---|
| `SKILLSAIR_BACKEND_URL` | Runtime | `https://kiwi.skillsair.com` (origin only, no `/api`) |
| `NEXT_PUBLIC_SITE_URL` | **Build** and runtime | `https://skillsair.com` |
| `BFF_SHARED_SECRET` | Runtime, **secret** | Same value as the backend. Never prefix with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_GA_ID` | **Build** | Optional. Leave empty until supplied; nothing loads while empty. |
| `NEXT_PUBLIC_META_PIXEL_ID` | **Build** | Optional, as above |
| `NEXT_PUBLIC_FEATURE_LAPTOP_SUPPORT` | **Build** | `true` (set `false` to hide laptop-support copy) |

`NEXT_PUBLIC_*` values are baked into the browser bundle when the image is built. In Coolify, tick **"Build Variable"** for them, then redeploy whenever they change. The Dockerfile passes them as build arguments.

You can remove the old WordPress and WooCommerce variables from the frontend (`WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`, `TUTOR_API_*`, `NEXT_PUBLIC_WP_API` and similar) once you're confident the legacy video route is no longer needed. **Rotate the WooCommerce keys either way**: they have appeared in local notes in plain text.

---

## 4. Deploy, step by step

### Step 1: backend API and admin

1. In Coolify, point the **API** application at `techyabraham/skillsair-backend`, branch `backend-rebuild/phase-1` (or merge it to `master` first and deploy `master`).
2. Add the new variables from section 3 with `WHATSAPP_ENABLED=false`.
3. Point the **admin** application at the **same commit**. Its build runs `generate:importmap`, which picks up the new "Imisi's queue" panel on leads.
4. Deploy both. The API starts its jobs only when `NODE_ENV=production`.

> **Run exactly one API replica.** The cron jobs run inside the API process. Duplicate sends are mostly prevented (follow-ups are recorded per lead, and payment-help, welcome and window-open messages use Redis idempotency keys), but two replicas would still double the work and could race. If you scale out later, move the jobs to a single worker.

### Step 2: database migration

1. Run the one-off migration task (`Dockerfile.migrate`) from the same commit. It applies:
   - `20261015_120000_rebuild_leads_pricing`
   - `20261016_090000_laptop_applications`
   - `20261016_150000_plan_kind`
2. Check the result:
   ```bash
   npm run migrate:status
   ```
   Both should show as run.

Both migrations were verified against a fresh database built from all existing migrations. The resulting schema matches Payload's expected schema exactly, apart from a default-value quirk that already existed before this work. The first migration also adds an admin document-lock column that the newsletter migration missed. Without that column, opening a newsletter subscriber in the admin fails.

### Step 3: frontend

1. Point the frontend application at `techyabraham/skillsair`, branch `frontend-rebuild/phase-1`.
2. Set the variables from section 3 (build variables ticked as build-time).
3. Deploy. Coolify should route HTTPS traffic to container port **3000**.
4. The Dockerfile now copies `public/` into the runtime image (the old Dockerfile didn't), and it binds to `0.0.0.0`.

### Step 4: schools, monthly plans, course prices and phone-friendly flags

First make sure all ten schools exist in the backend with the exact names (existing ones are left alone):

```bash
npm run seed:schools
npm run seed:schools -- --execute
```

Then the prices. Run these only after the new frontend is live: the old frontend shows course prices publicly and sells one-off, and this seed changes the listed price to ₦2,000 (a month).

The seed also creates **two monthly Paystack plans per paid programme** (₦2,000/month "Access Scholarship" and ₦40,000/month "Standard"), so it needs `PAYSTACK_SECRET_KEY` on the machine you run it from. It only creates plans that don't exist yet. Use the **live** key in production; plans created with a test key don't exist in live mode.

From the API container (Coolify → API → Terminal), or locally against production with care:

```bash
npm run seed:rebuild-pricing
```

Read the dry-run report: which programmes get ₦2,000 a month (scholarship) / ₦100,000 once / ₦40,000 a month (standard), which plans would be created on Paystack, which free courses are left alone, and which titles were matched as phone-friendly. Then apply it:

```bash
npm run seed:rebuild-pricing -- --execute
```

Then check admin → Plans: each paid programme should have an active **scholarship** plan (₦2,000, monthly) and a **standard** plan (₦40,000, monthly), both with a Paystack plan code. A programme without a scholarship plan shows "monthly billing is being set up" on its offer instead of a pay button.

Then, in the admin → Courses:
- Confirm the phone-friendly matches (Canva Design, Smartphone Videography, Data Analysis, Product Management) and tick any others that genuinely work fully on a phone.
- Check that every programme has **Requirements** and **Objectives**: the offer page and the "What do I need?" WhatsApp reply use them.
- Add "who it's for / not for" sentences to course descriptions where possible. Until then, that section is hidden in production.

### Step 5: legal pages

```bash
npm run seed:legal-pages
npm run seed:legal-pages -- --execute
```

This creates **draft** pages for privacy, terms, refunds, cookies and laptop rules. Existing pages with those slugs are left alone. Paste the existing Privacy and Terms text, fill the `{{…}}` placeholders, and have the lawyer review. Then set each page's status to **Published**. Until a page is published, the site shows "This page is being updated", never a 404.

### Step 6: scholarship window

Admin → Globals → **Scholarship Window**. The migration seeds:

- open, closing **31 October 2026, 11:59pm WAT**
- cohort "October 2026 – January 2027 cohort" (1 Oct 2026 to 31 Jan 2027)
- 2 laptops per cohort

When the window closes, every programme is charged its standard fee automatically, and the announcement bar and countdowns disappear within about 5 minutes (the site caches the window for 5 minutes). Don't extend a window after its closing date has been announced.

---

## 5. Smoke test after deploying (about 20 minutes)

Use a real phone on mobile data for at least the Apply flow.

1. `GET https://skillsair.com/api/health` reports the backend as reachable.
2. Home, `/schools` (all ten schools), a school page and a programme page load. No page shows a price, except the FAQ answer "Why is it only ₦2,000 a month?", which comes from the brief and shows the ₦10,000 certificate beside it.
3. `curl -s https://skillsair.com/api/courses | grep -c '"price"'` prints `0`.
4. `/courses` redirects to `/schools`.
5. **Apply flow:** apply with a test email → offer page shows the standard fee struck through → **₦2,000 a month**, "closes Saturday 31 October, 11:59pm", and the ₦10,000 certificate line. Choose "Phone only" and confirm the laptop warning and phone-friendly alternatives appear.
6. Offer email A arrives, and its button opens `/r/<code>` → your offer on another device.
7. Create the account → checkout shows "₦2,000 today, then ₦2,000 each month", card only → pay with a **small real test** or Paystack test mode if available, then cancel the test subscription from the dashboard. Don't make large real charges. After paying you should land on `/dashboard/welcome`, and the lead should show **Paid** in the admin.
8. Admin → Leads: the test lead shows source, UTM, consent and score. Opening it shows the **Imisi's queue** panel.
9. `/privacy` etc. show either the published text or the holding message.
10. The next morning, the daily summary arrives at `hello@mail.skillsair.com` at 08:30 WAT.

Optional extra checks:
- **Closed-window pricing:** on a staging copy (not production), set the window's closing date in the past. The offer page shows the closed state, checkout charges ₦100,000, the announcement bar disappears, and the lead is marked **waitlist**.
- **Lighthouse (mobile)** on `/`, `/programmes/<slug>` and `/apply`. Targets: Performance ≥ 90, Accessibility ≥ 95. These have not been measured yet.

---

## 6. WhatsApp go-live

1. Meta app → WhatsApp → Configuration:
   - Callback URL: `https://kiwi.skillsair.com/api/whatsapp/webhook`
   - Verify token: your `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the `messages` field.
2. Wait until the templates show **Approved** in WhatsApp Manager. Write down any that Meta reclassified from utility to marketing.
3. Check whether the number supports **WhatsApp Business app coexistence**. If it does, Imisi can reply from the app. If not, use the reply box in the admin lead view (it only works within 24 hours of the person's last message).
4. Set `WHATSAPP_ENABLED=true` on the API (and the admin, if replying from there) and redeploy.
5. Test with your own number:
   - Apply → the `skillsair_offer_ready` template arrives within seconds.
   - Tap **Talk to Imisi** → the lead shows "Needs human", with score +40.
   - Reply **STOP** → you get the confirmation, `optedOutAt` is set, and no marketing templates follow.
   - Reply **START** → consent is restored.
6. Imisi's queue: admin → Leads → click **Imisi's queue** above the list (needs a human, highest score first). Open a lead to reply on WhatsApp (within 24 hours of their last message) or click **Mark done**.
7. Optional FAQ assistant: set `WHATSAPP_AI_ASSISTANT=true` and `ANTHROPIC_API_KEY` on the API. It answers free-text questions from the FAQ facts in `src/content/assistant-knowledge.ts`, introduces itself as "SkillsAir's assistant" (never as Imisi), stops at 10 replies per lead per day, and the lead still goes into Imisi's queue. Messages asking for a person ("talk to Imisi", "human", "agent") skip the assistant. Test it with your own number first, and keep `assistant-knowledge.ts` in step with the site's FAQ.

---

## 7. Rollback

- **Frontend:** redeploy the previous commit (tag `pre-rebuild`, or `main`). Note that it shows prices publicly and still sends an optional phone at registration, which the new backend rejects if the phone is empty. Roll the frontend back only together with the backend, or temporarily make the phone optional again.
- **Backend:** redeploy `pre-rebuild-backend`. The new tables are harmless to the old code, so leave them in place. If you must remove them, run the migrations' `down` steps (newest first) from the migration runner **after restoring a backup**, not on live data.
- **Prices:** if the pricing seed ran, set each course's `price` back from the admin (the dry-run output lists the old prices), or restore the backup.

---

## 8. Still needed from the owner

| Item | Where it goes |
|---|---|
| Does the ₦100,000 fee include the certificate? | `site.ts` (`standardFeeIncludesCertificate`) and copy |
| Is the certificate fee non-refundable once issued? | Refund policy page |
| Laptop rules: deadline, notification days, delivery method, FCCPC reference | Laptop rules page and `site.ts` |
| Founder photo, advisor (Imisi) photo, team members | `src/content/site.ts` (photo URLs; add the host to `next.config.mjs` if it's new) |
| GA4 and Meta Pixel IDs | Frontend build variables |
| WhatsApp IDs, token, app secret; template approval | Backend variables (section 3) |
| Existing Privacy and Terms text | Admin → Pages |
| Real stats, stories, partner logos | `src/content/proof.ts` with `verified: true`, only when evidenced |
