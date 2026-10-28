# Ambassador earning engine

Phase 2 connects referral links to verified payments. Phase 3 (portal) begins only after the staging gate below has passed. The portal's intended public hostname is **ambassadors.skillsair.com**, as specified by the owner on 28 October 2026.

## Configuration and deployment

- Set `AMBASSADOR_ATTRIBUTION_SECRET` to a separate random secret of at least 32 characters on the **backend API and worker**. It signs HS256 referral cookies and must be identical on those services. Do not expose it to the student site or browser. Rotating it invalidates existing signed referral cookies.
- Deploy the backend before the student-site middleware. This phase needs no new database migration; it uses the Phase 1 tables and order metadata.
- Keep `SKILLSAIR_BACKEND_URL` on the student site pointed at the backend origin. The existing shared BFF secret should match so rate limits apply to the actual visitor.
- Scheduled work follows the existing `APP_ROLE` convention. The ambassador job runs every 15 minutes, with its own fail-closed Redis lock. It approves at most 500 due commissions, sends one notification per ambassador, then repairs missing commissions on fulfilled successful orders paid in the last 14 days.

## Behaviour

- `?ref=` works on every page handled by the existing middleware. It preserves the homepage experiment assignment on ordinary requests. Tracking times out after 1.5 seconds, then falls back to a code cookie. All referral cookies are host-only and HttpOnly.
- The tracking endpoint counts unique visitor/user-agent pairs once per ambassador per UTC day. Only the referrer hostname is stored. Bots and link previews do not count.
- Registration forwards `attribution`, clears its cookie after success, and never fails because attribution failed. The legacy `referralCode` request field temporarily resolves ambassador codes or WordPress IDs. Ordinary users no longer receive referral codes.
- Course, subscription and certificate checkout forward attribution and snapshot the ambassador and attribution IDs in order metadata. Reassignment cannot move an existing order's commission.
- Commission failures cannot prevent course access. The order safety net repairs them. Invoice webhook replay retries a missing renewal commission even when the subscription period was already updated.
- Integer kobo, immutable rate snapshots and the existing ledger transitions remain unchanged. Certificates are excluded by default.

## Refund contract and review cases

Paystack's [refund notification documentation](https://paystack.com/docs/payments/refunds/) uses `transaction_reference`, `refund_reference`, `amount` (which can be a string), `currency` and `status`. This differs from its Refund API object, whose `transaction` may be a numeric ID. The handler accepts the webhook form, validates it, and requires a stable refund reference or ID. Signature validation precedes parsing. A shape-only log records whether identifiers were present; it excludes customer data, notes, tokens and account details. Confirm the shape with a test-mode staging event before deployment approval.

Order refund receipts are kept in order metadata inside the same database transaction as ledger changes. Replaying a refund cannot debit twice or exceed the order's amount. A full refund marks the order refunded. A pending partial refund voids the original and creates the brief's single `:partial` replacement, preserving its availability date. Approved refunds append negative reversal rows and may make the available balance negative.

The owner explicitly chose to retain the brief's key formats and transitions. These cases require manual review:

- A second partial refund while the replacement commission is still pending: there is no second valid replacement key.
- A partial renewal refund: the brief has no partial invoice commission key.
- A renewal reversal with no initial order: the required reversal key needs an order ID.
- A processed refund without a stable provider refund identifier: the handler refuses to guess an idempotency key.
- A historical partial-refunded order with no commission: the repair job flags it instead of awarding the original full commission.
- Phase 4's requested reversal of an already paid payout conflicts with the brief's prohibition on `paid -> void`. Do not weaken this transition silently when implementing payouts.

Unsupported ledger cases produce `refund_review_required` audit entries and refuse the unsupported money operation. They must be resolved by an authorised, audited adjustment workflow. No real refund or transfer is initiated by this phase.

## Verification and staging gate

Local checks use `TEST_DATABASE_URI` on a disposable localhost database. No production provider credentials, outbound email or production migration is needed. Integration tests mock Redis and email.

1. Set Paystack TEST credentials in staging and temporarily set approval delay to zero. Record the existing value so it can be restored.
2. Create an active, verified ambassador in Studio. Open a course URL with their code in a private browser: the URL is cleaned, `sa_ref` is HttpOnly, and one click exists. A reload adds no click.
3. Register and pay for the course with a test card. Check one pending commission equal to 50% of the actual stored order amount, converted once to kobo. The order amount includes any checkout fee passed to the learner.
4. Run/wait for the approval job. Check the available wallet balance and one approval email.
5. Replay `charge.success`: one enrollment and commission remain.
6. Process a test refund through Paystack. Verify its sanitised shape log, one reversal, and the reduced wallet. Replay it: no further change.
7. Buy through the ambassador's own link: no attribution or commission.
8. Verify a subscription's initial payment earns through its order; replay its initial invoice without another commission. A renewal earns once despite repeated events.
9. Check both a numeric legacy link and a new referral code, then restore approval delay.

Staging execution, pilot approval, production payment, portal screenshots and Lighthouse results must be recorded when actually performed. Local tests do not establish those gates.
