# ReviveRelay Subscription Model

ReviveRelay requester access is free. Reviver-side queue access can be controlled by the server subscription mode: `free`, `review`, or `live`.

## Modes

- **free**: no Reviver Pro payment is required; other reviver eligibility/security gates still apply.
- **review**: the full prepaid Pro workflow is enabled for the private Torn review channel.
- **live**: the same prepaid workflow may be used publicly only after Torn approval and explicit production promotion.

Paid public launch is **awaiting Torn approval**. Public production remains 0.4.4 while the 0.6.1 review candidate is evaluated.

## 7-day trial

An eligible reviver may activate the implemented **7-day** Reviver Pro trial once. The trial is **one-time per canonical Torn identity**, with server-authoritative start/end timestamps. Reinstalling the userscript, clearing local storage, creating a new session, replacing the verification key, deleting/reactivating the ReviveRelay account, or restarting the application does not reset trial usage. Trial activation requires the reviver verification capability and current Torn permanent revive ability. Paid time stacks after any remaining trial/paid entitlement rather than destroying unused time.

## OWNER lifetime access

The authenticated Torn identity matching the canonical payment recipient **R4G3RUNN3R [3877028]** receives server-derived state `OWNER` with **Lifetime** Reviver Pro access and no expiry. OWNER is not accepted from userscript state or request data. It requires no trial or subscription invoice and is prevented from purchasing itself, while all normal reviver verification, Torn ability, registration and transaction-safety checks still apply.

## Approved launch plans

The server owns the plan catalogue and invoice values. The userscript does not supply an authoritative price or duration.

| Plan | Duration | Xanax | Torn cash |
| --- | --- | ---: | ---: |
| Monthly | 1 calendar month | 10 Xanax | $10,000,000 |
| 6 Months | 6 calendar months | 55 Xanax | $55,000,000 |
| Yearly | 12 calendar months | 100 Xanax | $100,000,000 |

`$` means Torn in-game cash, not real-world currency.

Canonical payment recipient: **R4G3RUNN3R [3877028]**.

## Invoice and payment flow

1. The user selects a server-known plan and either Xanax or Torn cash.
2. The server creates the invoice using server-owned plan price, calendar duration, merchant Torn ID and a 24-hour invoice expiry.
3. Any previous pending invoice for that user is cancelled atomically when a replacement is created.
4. The user sends the exact payment **manually in Torn** to R4G3RUNN3R [3877028]. ReviveRelay never sends cash or items for the user.
5. The server reads the canonical merchant's **restricted merchant incoming-payment** evidence.
6. Sender Torn ID, currency/asset, exact expected amount and evidence timestamp must match the invoice window.
7. A unique Torn log/evidence reference may activate only one invoice.
8. On successful evidence match the invoice becomes paid and the entitlement extends exactly once.

The merchant API credential is server-side only, encrypted/configured outside the userscript, and is not disclosed in responses.

## Entitlement rules

The implemented entitlement states include trial, active, expired/revoked and no entitlement. Protected reviver endpoints use server-side entitlement state when `review` or `live` mode requires it. The userscript cannot grant itself Pro access.

Prepaid subscriptions do not auto-renew. There is no automatic recurring charge and no real-world payment processor. New paid time extends from the existing valid-until date when appropriate, using UTC calendar-month arithmetic.

## Refund/audit model

Subscription invoices and payment evidence remain durable for replay protection and audit. Administrative refund/correction operations preserve the paid invoice/evidence history and record an immutable adjustment rather than deleting the original evidence.

## Review question

The subscription model is intentionally present and functional in `review` mode so Torn staff can inspect what would be launched. Public paid operation will not be promoted until Torn approval is received.
