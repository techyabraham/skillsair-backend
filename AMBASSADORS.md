# SkillsAir Ambassadors — Project Brief

You are a senior TypeScript engineer on SkillsAir, a Nigerian e-learning platform. You are building "Ambassadors", SkillsAir's own affiliate program. This brief is the source of truth for every ambassador task. If existing code contradicts it, STOP and report the conflict; do not guess or silently pick one.

====================================================================
1. REPOSITORIES AND WHAT CHANGES WHERE
====================================================================

A. techyabraham/skillsair-backend  (all business logic lives here)
   - Payload CMS 3 on Express, Node >= 20, TypeScript, ESM ("type": "module", imports end in .js).
   - PostgreSQL via @payloadcms/db-postgres. Redis via ioredis (src/lib/redis.ts).
   - Paystack (src/lib/paystack.ts), Resend email (src/lib/resend.ts), node-cron jobs (src/jobs/*.ts).
   - Custom endpoints are Payload `Endpoint` objects registered in payload.config.ts.
   - The Payload admin ("SkillsAir Studio", cms.skillsair.com) is a separate Next.js service built from THIS repo (Dockerfile.admin). Ambassador admin screens are built here.
   - Owns: every ambassador collection, the settings global, every /ambassadors/* endpoint, jobs, emails, Paystack transfers, admin views.

B. techyabraham/skillsair  (student site, skillsair.com)
   - Next.js 14 App Router, React 18, Tailwind 3. BFF pattern: browser -> Next route handlers in src/app/api/* -> backend. Session in httpOnly cookies sa_backend_access / sa_backend_refresh. Helpers in src/lib/backend-api.ts (backendFetch, backendPayload, backendToken, backendAuthCookieOptions).
   - Only three changes, all in phase 2: referral capture middleware, forwarding attribution on registration, forwarding attribution on checkout.

C. techyabraham/skillsair-ambassadors  (NEW, ambassador.skillsair.com)
   - Next.js 16 App Router, React 19, TypeScript strict, Tailwind. UI only: it stores no business data and talks only to the backend.

====================================================================
2. PRODUCT RULES (NON-NEGOTIABLE)
====================================================================

R1  Not every user is an ambassador. A user is an ambassador only when an `ambassadors` record exists for them. Ways in: self-application on the portal, admin creates a new user as ambassador, admin converts an existing user, WordPress import.
R2  One login system. An ambassador is a normal `users` record (role "student"). A student may also be an ambassador with the same email and password. Never create a second account for the same email.
R3  Status: pending | active | blocked. Only ACTIVE ambassadors can: be attributed new customers, earn new commissions, use dashboard endpoints, withdraw. A pending or blocked ambassador can log in to the portal and sees a status screen only. Blocking keeps all history; approved money stays in the wallet but cannot be withdrawn while blocked.
R4  Self-applicants must verify their email (one email containing a 6-digit OTP AND a verification link) before status can become active. Admin-created, admin-converted and imported ambassadors count as verified.
R5  Applications land as `pending` and an admin approves them (setting defaultApplicationStatus, default "pending"; if set to "active", verification alone activates).
R6  Referral link: https://skillsair.com/?skr=<CODE>. CODE = 8 uppercase characters from generateReferralCode() in src/utils/generate-code.ts, unique across ambassadors. `?skr=` works on ANY skillsair.com URL (home, a course page, pricing). Legacy WordPress links `?ref=<numeric WordPress user id>` MUST keep working: they resolve through ambassadors.legacyWpRef.
R7  Attribution: first click wins (setting attributionModel, default "first_click"). The browser keeps the referral for cookieDays (default 30). Once a user account is attributed, the attribution is permanent (setting attributionLifetimeDays, default null = forever). A user can never be attributed to their own ambassador profile.
R8  Commission: rate from settings (commissionRateBps, default 5000 = 50%) applied to the amount the customer actually paid, for: course purchases, the first subscription payment, every subscription renewal. Certificate purchases are excluded by default (setting commissionableTypes). The rate and the amount are copied onto every ledger row when it is created; changing the setting NEVER changes existing rows.
R9  Commission lifecycle: created `pending` with availableAt = paidAt + approvalDelayDays (default 7). A job approves it once availableAt has passed. Refund before approval -> commission becomes `void`. Refund after approval (whether or not it was paid out) -> a new negative `reversal` row, which can make the available balance negative; future earnings pay it back.
R10 Withdrawals: any amount >= minPayoutKobo (default 500000 = ₦5,000) and <= available balance; requires a current bank account resolved through Paystack and past its holdUntil. payoutMode "manual_review" (default: an admin approves each payout) or "automatic" (transfer starts immediately when amount <= perTransferCapKobo, the day's total <= dailyCapKobo, and the ambassador has no open risk flag).
R11 Ambassadors can see: clicks, unique visitors, prospects (referred users with no paid order), customers (referred users with >= 1 paid order), renewals, and referred users' first name, last initial and email (setting showReferredEmails, default true). Never learning progress, quiz results or anything about course consumption.

====================================================================
3. MONEY RULES
====================================================================

M1  All ambassador money is INTEGER KOBO in a JS number (safe up to 2^53). Never floats for money. Validate with Number.isSafeInteger.
M2  Orders store naira as a number (orders.amount). Convert exactly once: toKobo(naira) = Math.round(naira * 100). Paystack webhook amounts are already kobo.
M3  commissionKobo = Math.floor(saleKobo * rateBps / 10000). Partial refund reversal = Math.floor(commissionKobo * refundedKobo / saleKobo).
M4  The ledger (collection `ambassador-ledger`) is APPEND-ONLY. After insert, these never change: ambassador, type, amountKobo, saleKobo, rateBps, idempotencyKey, createdAt. Only `status` and `payout` change, and only through the functions in src/lib/ambassadors/ledger.ts.
M5  Ledger row types, signs and allowed statuses:
      commission  (+)  pending -> approved | void
      reversal    (-)  approved (counts immediately)
      adjustment  (+/-) approved (admin-only, note required)
      payout      (-)  reserved -> paid | void   (void = transfer failed or rejected; the money returns)
      payout_reversal (+) approved (Paystack confirms a previously paid transfer was returned)
    A paid payout is never changed to void. A transfer reversal appends payout_reversal for the
    same amount; the paid payout and its ledger row remain immutable. A reversal before success
    voids the still-reserved payout instead.
M6  Wallet figures are DERIVED from the ledger on every read; never store balances or counters:
      pendingKobo     = SUM(amountKobo) WHERE type='commission' AND status='pending'
      availableKobo   = SUM(amountKobo) WHERE (type IN ('commission','reversal','adjustment','payout_reversal') AND status='approved')
                                         OR (type='payout' AND status IN ('reserved','paid'))
      inFlightKobo    = -SUM(amountKobo) WHERE type='payout' AND status='reserved'
      paidOutKobo     = -SUM(amountKobo) WHERE type='payout' AND status='paid'
      totalEarnedKobo = SUM(amountKobo) WHERE (type='commission' AND status IN ('pending','approved'))
                                         OR type IN ('reversal','adjustment')
    payout_reversal restores available money and does not count as earnings.
    availableKobo can be negative. Compute all five in ONE SQL aggregate query.
M7  Every ledger row has a unique idempotencyKey. Formats (exact):
      commission:order:<orderId>
      commission:order:<orderId>:partial:<refundId> (current remainder after each distinct partial refund before approval)
      commission:invoice:<paystackInvoiceCode>
      commission:invoice:<paystackInvoiceCode>:partial:<refundId> (renewal remainder after a partial refund before approval)
      reversal:order:<orderId>:<paystackRefundIdOrAdminActionId>
      reversal:invoice:<paystackInvoiceCode>:<paystackRefundIdOrAdminActionId>
      payout:<payoutId>
      payout-reversal:<payoutId>
      adjustment:<uuid v4>
      import:wp-commission:<wpCommissionId>
      import:wp-withdrawal:<wpWithdrawalId>
    Insert with the key. A unique-violation on the key means "already done": return the existing row as success. That is how webhooks, retries and jobs stay safe to run twice. Each partial refund has its own stable provider refund ID in the replacement key; successive replacements void the prior pending remainder and create one new current remainder.
M8  Display: whole naira as "₦12,500" using Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }); balances with 2 decimals. One formatter, src/lib/money.ts in each repo.

====================================================================
4. DATA MODEL (Payload, admin group "Ambassadors")
====================================================================

All collections: timestamps: true. Files under src/collections/ambassadors/. Field names are exact.

ambassadors
  user               relationship users, required, unique, indexed
  code               text, required, unique, indexed, /^[A-Z0-9]{8}$/
  username           text, required, unique, lowercase, /^[a-z0-9._]{3,30}$/  (public handle shown in the portal; login stays email)
  legacyWpRef        text, unique, optional, digits only
  status             select pending|active|blocked, default pending, indexed
  source             select self|admin|wp_import, required
  emailVerifiedAt    date
  promotionPlan      textarea, max 2000
  about              textarea, max 2000
  heardAbout         text, max 200
  approvedAt, approvedBy (relationship users), blockedAt, blockedReason (text, max 500)
  riskFlags          array { kind: select shared_bank|self_referral_suspected|velocity|manual, note: text, openedAt: date, resolvedAt: date, resolvedBy: relationship users }

ambassador-bank-accounts
  ambassador         relationship ambassadors, required, indexed
  bankCode           text, required        bankName text, required
  accountName        text, required (exactly as Paystack resolve returned it)
  accountNumber      text, required, 10 digits, ENCRYPTED at rest with encryptField/decryptField hooks (copy the pattern in src/collections/Affiliates.ts)
  accountLast4       text, required
  resolvedAt         date, required
  paystackRecipientCode text
  isCurrent          checkbox (service enforces at most one current per ambassador)
  holdUntil          date (set to now + newBankHoldHours when this replaces an earlier account)

referral-clicks
  ambassador (relationship, indexed), visitorHash (text, sha256 hex), landingPath (text, max 300), referrerHost (text, max 200), utmSource, utmMedium, utmCampaign (text, max 100 each), isUnique (checkbox). Compound index (ambassador, createdAt).

referral-attributions
  referredUser       relationship users, required, UNIQUE
  ambassador         relationship ambassadors, required, indexed
  firstClickAt       date
  attributedAt       date, required
  source             select cookie_register|cookie_checkout|legacy_wp|admin|wp_import
  lockedUntil        date (null = permanent)

ambassador-ledger
  ambassador (relationship, required, indexed), type (select, M5), status (select, M5, indexed), amountKobo (number, integer, signed, required), saleKobo (number, integer), rateBps (number, integer 0..10000), order (relationship orders), subscription (relationship subscriptions), invoiceCode (text), payout (relationship ambassador-payouts), referredUser (relationship users), productType (select course|subscription|renewal|certificate|none), productTitle (text snapshot), availableAt (date, indexed), idempotencyKey (text, required, unique), note (text, max 500), createdBy (relationship users).
  Compound index (ambassador, type, status).

ambassador-payouts
  ambassador (relationship, required, indexed), amountKobo (integer > 0), status (select requested|approved|processing|success|failed|rejected, indexed), bankAccount (relationship), bankName, accountName, accountLast4, recipientCode (snapshots at request time), reference (text, unique, Paystack transfer reference), requestId (text, unique, client Idempotency-Key), paystackTransferCode, failureReason (text), reviewedBy (relationship users), reviewedAt, processedAt (dates), providerPayload (json, admin-only read).

ambassador-audit-log
  actor (relationship users), action (text), targetCollection (text), targetId (text), before (json), after (json), ip (text). Never updated or deleted.

GLOBAL ambassador-settings (src/globals/AmbassadorSettings.ts)
  programOpen bool true | defaultApplicationStatus pending|active = pending
  commissionRateBps int 0..10000 = 5000 (admin description: "Applies to new commissions only")
  commissionableTypes multi course,subscription,renewal,certificate = [course, subscription, renewal]
  approvalDelayDays int 0..60 = 7 | cookieDays int 1..365 = 30
  attributionModel first_click|last_click = first_click | attributionLifetimeDays int|null = null
  minPayoutKobo int = 500000 | payoutsEnabled bool true | payoutMode manual_review|automatic = manual_review
  perTransferCapKobo int = 20000000 (₦200,000) | dailyCapKobo int = 100000000 (₦1,000,000)
  newBankHoldHours int = 48 | showReferredEmails bool true
  heardAboutOptions array text = Instagram, Facebook, WhatsApp, X (Twitter), TikTok, YouTube, A friend, Other
  shareMessage text = "I'm learning job-ready tech skills on SkillsAir. Start here: {link}"

ACCESS (all ambassador collections and the global):
  - read/create/update/delete through Payload's REST/GraphQL: ADMIN ONLY. Ledger, payouts and audit log: create/update/delete = () => false for everyone, admins included; they are written only by server code with overrideAccess: true.
  - Ambassadors never read collections directly. They use /ambassadors/me/* endpoints, which select and shape fields explicitly. This is what keeps accountNumber, providerPayload and other people's data out of reach.
  - Access functions must recognise admins from BOTH Payload's admin session (req.user) and the custom JWT (resolveAuthUser in src/middleware/authenticate.ts), exactly like src/collections/Users.ts does.

====================================================================
5. HOUSE CONVENTIONS (copy the existing code's style exactly)
====================================================================

C1  Endpoints: `Endpoint` with path, method, handler: asyncHandler(fn). Body: parseBody(zodSchema, await readJsonBody(req)). Route params: getParam(req, 'id'). Success: sendSuccess(data, meta?, status?). Errors: throw new AppError(code, message, fields?) using the existing ErrorCode union in src/types/index.ts. Do not add error codes; express ambassador states as INSUFFICIENT_PERMISSION with fields { reason: 'not_ambassador' | 'pending' | 'blocked' | 'email_unverified' }.
C2  Auth: requireAuth(req) for users. New helpers in src/lib/ambassadors/access.ts: requireAmbassador(req) -> { user, ambassador } (active only), loadAmbassadorForUser(req) (any status), requireAdmin(req) (accepts Payload admin session OR custom JWT with role admin).
C3  Rate limits: reuse createPayloadRateLimiter in src/lib/rate-limiter.ts (export it or add named limiters there).
C4  Locks: move the Redis lock in src/lib/order-fulfillment.ts (SET NX EX + compare-and-delete Lua) into src/lib/locks.ts as withLock(key, ttlSeconds, fn); reuse it everywhere.
C5  Logging: logger from src/lib/logger.ts, snake_case event names prefixed "ambassador_". NEVER log account numbers, OTPs, tokens, passwords or full emails of referred users.
C6  Email: sendEmail + template functions written in the style of src/lib/resend.ts, placed in src/lib/ambassadors/emails.ts. Email failures are logged and never fail the request that triggered them.
C7  Jobs: src/jobs/<name>.ts exporting register<Name>Job(config), registered in server.ts inside the existing production-only block, using withLock so two API instances never run the same job at once.
C8  Schema changes: follow MIGRATION.md "Database schema migrations" exactly (disposable local Postgres, `npm run migrate:create -- <name>`, review .ts and .json, commit both; never generate against staging or production). Run `npm run generate:types` and use the generated types; no `any`.
C9  Tests: vitest (add it in phase 1, script `npm test`). Pure functions get unit tests. Ledger, attribution and payout logic get integration tests against a disposable Postgres through Payload's local API.
C10 Every new environment variable goes into .env.example with a comment and into README.md.
C11 Text: UK English, Nigerian context. Naira per M8. No emoji in UI or emails.

====================================================================
6. SECURITY REQUIREMENTS
====================================================================

S1  Fix the existing hole first: src/collections/Affiliates.ts `update` lets a user edit the affiliate record whose id equals their user id. Admin-only.
S2  Self-referral: never attribute or pay when the buyer is the ambassador's own user. Raise a risk flag (not a block) when the buyer shares the ambassador's phone or payout account number, or two ambassadors share an account number.
S3  Every Paystack webhook: verify the signature with verifyWebhookSignature before parsing (already done in the dispatcher). Transfer events whose reference does not start with "amb_" are ignored.
S4  Withdrawals: Redis lock per ambassador, balance re-checked inside the lock, Idempotency-Key required, new bank account hold, caps in automatic mode.
S5  OTPs and link tokens are stored hashed (hashToken) with TTL and attempt limits; responses never reveal whether an email exists.
S6  Rate limits: track 60/min per IP, apply 5/hour per IP, bank resolve 20/hour per IP, OTP verify 10 per 15 min per email, resend 5/hour per email, withdraw 5/hour per user.
S7  Every admin action that changes money or status writes ambassador-audit-log. Revealing a full account number is an audited action.
S8  CORS: add https://ambassador.skillsair.com to CORS_ORIGINS; never use a wildcard.

====================================================================
7. HOW YOU WORK
====================================================================

W1  One phase per session. Branch: ambassadors/phase-<n>-<slug>. Small, focused commits. Finish with a pull request.
W2  Before editing: read every file the phase prompt lists, then reply with a PLAN (files to add or change, and why; schema changes; risks; questions). Wait for approval.
W3  Never invent APIs. For Payload, Next.js and Paystack, check the installed package's types or the official docs for the installed version. If unsure, write the question in the PR instead of guessing.
W4  Do not touch unrelated code. No drive-by reformatting or dependency upgrades.
W5  No secrets in code. Test with Paystack TEST keys only until the phase-4 live gate.
W6  Definition of done for every phase: `npm run typecheck`, `npm run lint` and `npm test` pass; migration reviewed; README updated; the phase's gate demonstrated with steps and evidence in the PR description.
