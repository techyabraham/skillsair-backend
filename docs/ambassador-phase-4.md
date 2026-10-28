# Ambassador Phase 4: payouts and administration

## Local changes

The payout service reserves available kobo in the ledger before initiating a transfer. `requestId` and `reference` are unique; every confirmed client request has a UUID v4 idempotency key. The `amb_` reference is reused for transfer verification and webhook matching. A transfer timeout or server error stays in `processing` and is reconciled against that reference; the service never starts a second transfer after an ambiguous initiation.

When a bank returns a transfer after Paystack marked it successful, the original paid payout ledger row remains immutable. The webhook appends one positive `payout_reversal` row keyed `payout-reversal:<payoutId>`. This restores the returned amount to available balance without rewriting the payout or counting the returned amount as earnings. If the transfer reverses while the ledger row is still reserved, that reservation is voided instead.

Each refund event has a stable provider or admin action ID. For repeated partial refunds before approval, the current pending remainder is voided and replaced with the cumulative remainder under `commission:order:<orderId>:partial:<refundId>` or `commission:invoice:<invoiceCode>:partial:<refundId>`. After approval, each distinct event appends a proportional reversal. Duplicate event IDs are idempotent. Refund webhooks without the required stable identifiers are rejected rather than guessed.

Studio adds the ambassador directory, application review, payout review, wallet and risk actions, an audited account reveal, and the order refund action. Manual review stays the default. Automatic transfers require `payoutMode=automatic`, an amount within `perTransferCapKobo`, the day's total within `dailyCapKobo`, and no open risk flags.

## Environment

No new phase-4 environment variables were introduced. Configure `PAYSTACK_SECRET_KEY` with a Paystack **test** key on staging. Configure `AMBASSADOR_ADMIN_EMAIL` for OTP-required and unresolved-transfer notices. Transfer OTP must be disabled on the Paystack test account before transfers can proceed. Keep production keys in runtime-only secret storage.

## Staging gate

Run these checks on staging with test keys after the migration has applied and the API, Studio and portal are deployed from the same revision:

1. Request the minimum withdrawal in manual-review mode. Confirm one requested payout and one reserved negative ledger row.
2. Approve it in Studio. Confirm the payout reaches processing, Paystack sends the test transfer, and a signed `transfer.success` event marks the existing ledger row paid.
3. In a separate test request, force a definite transfer failure. Confirm the payout is failed, the reserved row is void, and available balance returns.
4. Switch to automatic mode. Confirm a request above `perTransferCapKobo`, a request that exceeds the daily cap, and a request with an open risk flag remain in the manual review queue.
5. Replay success, failure and reversal webhooks. Confirm duplicates and out-of-order events do not create extra ledger rows or move money twice.
6. Send a `transfer.reversed` event after success. Confirm the paid payout row stays paid, one approved `payout_reversal` row is appended, and available balance is restored.
7. Review audit log rows for approval, rejection, status change, adjustment, refund and bank reveal. Confirm they contain before/after values without full account numbers.
8. In a production live check, the owner must be present, use their own account and the minimum payout setting approved for that check. Restore the normal minimum immediately afterward.

The optional portal Playwright flow can be enabled with an approved staging pilot account and `STAGING_PAYOUT_READY=true`; its admin and webhook calls are stubbed so the browser test does not move money. Backend database integration specs exercise payout reservation and reversal logic. Provider checks remain a separate staging gate.
