# ReviveRelay 0.6.1 Payment Verification Flow

This document covers the Reviver Pro subscription receipt flow. Revive transaction payments/refunds use separate participant evidence but the same principle: Torn actions remain manual and the server verifies bounded evidence.

## Merchant and approved plans

Canonical merchant: **R4G3RUNN3R [3877028]**.

- Monthly: 10 Xanax or $10,000,000 Torn cash
- 6 Months: 55 Xanax or $55,000,000 Torn cash
- Yearly: 100 Xanax or $100,000,000 Torn cash

The client sends only the selected plan ID and currency. The server owns the actual price and calendar duration.

## Sequence

1. Authenticated user selects an approved plan and Xanax or Torn cash.
2. `POST /v1/pro/invoices` validates that subscription payments are enabled (`review` or `live`) and creates a server-owned invoice.
3. The invoice records authenticated Torn owner, plan, exact amount, currency and a 24-hour expiry. A replacement invoice cancels the previous pending invoice atomically.
4. The UI displays the server-provided payment target **R4G3RUNN3R [3877028]** and instructs the user to send the amount **manually in Torn**.
5. ReviveRelay never automatically sends money/items and does not make a hidden non-API Torn payment request.
6. The background subscription scan validates a separate **restricted merchant** API credential belonging to the canonical receiving account.
7. Only incoming Money or Items evidence relevant to currencies represented by pending invoices is requested.
8. Evidence is normalized conservatively to Torn log reference, sender Torn ID, currency, amount and timestamp.
9. An invoice matches only evidence with the authenticated invoice owner as sender, exact currency/asset, exact expected amount and timestamp inside the invoice window.
10. The earliest unused matching evidence wins deterministically.
11. The Torn evidence/log reference is stored with a uniqueness constraint so it cannot activate a second invoice.
12. Invoice paid-state and entitlement extension are committed atomically/idempotently. Re-running the scan after success does not grant time twice.

## Security properties

- Merchant ID is server configuration, not client trust.
- Plan amount/duration are server catalogue values.
- Merchant credential is not embedded in the userscript or returned by the API.
- Wrong sender, amount, currency or timestamp is rejected.
- One Torn log ID cannot activate two invoices.
- Expired invoices are handled before active pending matching.
- Entitlement uses UTC calendar-month extension and stacks after remaining valid trial/paid time.
- Subscription is prepaid; no automatic recurring charge exists.

## Trial and public-launch boundary

Eligible revivers can receive a one-time **7-day** trial. Full payment handling is enabled in the private `review` mode specifically so Torn staff can inspect the intended monetization before launch.

Paid public launch is awaiting Torn approval. Public production remains 0.4.4 and has not been promoted to the 0.6.1 paid review candidate.

## Related privacy controls

User ReviveRelay Verification credentials are encrypted at rest. Account deletion removes active credentials/sessions but deliberately retains minimal billing/payment evidence needed for payment-reuse protection and audit history.

Sanitized diagnostics are off by default and do not include the merchant credential, user Torn API keys or raw payment log payloads.
