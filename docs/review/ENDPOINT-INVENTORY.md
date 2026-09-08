# ReviveRelay 0.6.1 Endpoint Inventory

This inventory describes the direct 0.6.1 runtime surface. Legacy candidate route source files remain in the repository for history/tests, but `buildApp()` does not register `/v1/candidates` or `/v1/candidates/recent` in the direct runtime; direct-only tests require those routes to return 404.

## Public / bootstrap

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | Minimal service health response. |
| POST | `/v1/auth/bind` | One-time Torn identity binding; returns opaque ReviveRelay session. |
| GET | `/v1/client/version` | Channel-scoped immutable release manifest. |

## Authenticated account/session

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/me` | Public ReviveRelay identity/roles plus safe entitlement/subscription state. |
| DELETE | `/v1/account` | Explicit account-data deletion flow. |
| GET | `/v1/verification-credential` | Return safe masked/status/capability information only. |
| POST | `/v1/verification-credential` | Validate and bind encrypted ReviveRelay Verification credential. |
| DELETE | `/v1/verification-credential` | Revoke stored ReviveRelay Verification credential. |

## Requester

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/v1/requests` | Create/update the requester's direct certified AVAILABLE request. Request creation does not require persistent requester verification. |
| GET | `/v1/requests/active` | Read the authenticated requester's current active request. |
| POST | `/v1/requests/:id/cancel` | Cancel where server state still allows cancellation. |

## Reviver

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/reviver/eligibility` | Confirm current Torn permanent revive ability. |
| POST | `/v1/reviver/register` | Register an otherwise eligible reviver. |
| GET | `/v1/reviver/queue` | Return certified requests whose requesters have usable requester evidence capability. |
| POST | `/v1/requests/:id/accept` | Atomically accept one request. Rechecks requester verification before any payment window starts. |

Reviver-only surfaces also enforce server subscription policy, reviver registration/standing, usable reviver verification and current Torn revive ability as applicable.

## Transaction actions

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/transactions/:id` | Participant-scoped transaction view. |
| POST | `/v1/transactions/:id/check-payment` | Expedite payment evidence verification. |
| POST | `/v1/transactions/:id/retry-request` | Request retry after a genuine failed assigned attempt. |
| POST | `/v1/transactions/:id/retry-response` | Assigned reviver accepts/declines bounded retry offer. |
| POST | `/v1/transactions/:id/request-refund` | Request refund where state permits. |
| POST | `/v1/transactions/:id/check-refund` | Expedite refund evidence verification. |

The client does not submit arbitrary transaction states; these are named server transitions only.

## Reviver Pro / subscription

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/pro/status` | Entitlement plus public subscription mode/capability. |
| GET | `/v1/pro/plans` | Server-owned approved plan catalogue. |
| POST | `/v1/pro/trial` | Start one eligible 7-day Reviver Pro trial. |
| POST | `/v1/pro/invoices` | Create server-priced prepaid invoice in review/live mode. |
| GET | `/v1/pro/invoices/:id` | Read owner-scoped invoice/payment state. |

Payment destination returned by the server is **R4G3RUNN3R [3877028]** when payments are enabled. The user pays manually in Torn.

## Diagnostics

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/v1/telemetry/errors` | Bounded sanitized technical error envelopes; client diagnostics are off by default. |

## Conditional administration

The backend contains authenticated administrator-only Pro routes that are registered only when `ADMIN_API_TOKEN` is configured. They are not userscript-facing:

- `GET /v1/admin/pro/users/:tornId`
- `POST /v1/admin/pro/grant`
- `POST /v1/admin/pro/revoke`
- `POST /v1/admin/pro/refund`
- `POST /v1/admin/pro/correct`

Administrator credentials/tokens are not included in this review package.

## Network boundary

The 0.6.1 userscript's cross-origin application network permission is limited to `reviverelay.voidsmithindustries.com`. Torn API calls are made by the ReviveRelay backend. The userscript opens Torn key/settings/profile links only as explicit browser navigation; it does not use them as hidden non-API request channels.
