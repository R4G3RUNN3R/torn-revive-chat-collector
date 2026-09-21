# ReviveRelay

ReviveRelay is a Torn userscript and isolated Voidsmith backend for direct, certified revive requests. Version **0.6.1** is the private Torn review candidate. Public production remains **0.4.4** until Torn review, manual browser acceptance, and explicit owner approval are complete.

## Runtime model

ReviveRelay 0.6.1 is direct-only. It does **not scrape public chat**, does not collect Faction/Company/private chat, and does not make automated non-API Torn game requests. Requesters create certified requests through the ReviveRelay API; eligible revivers receive the server-certified queue and may manually accept a request.

Requester access is free. A requester can create a request immediately, but the request cannot enter the reviver queue or be accepted until the connected Torn API key has a usable requester-evidence capability. ReviveRelay uses one Torn API key for the whole account: the same key that binds Torn identity also supplies verification evidence, so there is no separate requester key to create or maintain.

Reviver access additionally requires:

- an active reviver registration;
- Torn-confirmed permanent revive ability;
- a usable reviver-capable ReviveRelay Verification credential;
- Reviver Pro entitlement when subscription mode is `review` or `live`.

Reviver access uses the same connected Torn API key; no second key is required. The recommended Custom Torn API key covers **Basic, Profile, Revives, Perks and restricted Money/Items transaction-log categories** so it satisfies both requester and reviver evidence at once. A Broad/Full Access Torn API key may be accepted when it contains the required evidence access, but the UI warns that it grants more access than ReviveRelay needs and offers to replace it with the recommended Custom Torn API key.

### Review runtime isolation

The 0.6.1 review client uses `https://reviverelay.voidsmithindustries.com/review/v1/` and requires a compatible server-declared `review` runtime contract. Stable public 0.4.4 continues to use `/v1/` and is unchanged. Missing, malformed, stable-channel or incompatible review metadata fails closed; it never grants free/Pro access by absence.

## Subscription modes

The backend owns one of three modes:

- `free`: requester and otherwise-eligible reviver access operate without Pro payment;
- `review`: the full prepaid subscription model is visible and functional on the private Torn review channel;
- `live`: the same paid model is available for public operation only after approval and explicit promotion.

Approved launch pricing is server-owned:

| Plan | Xanax | Torn cash |
| --- | ---: | ---: |
| Monthly | 10 Xanax | $10,000,000 |
| 6 Months | 55 Xanax | $55,000,000 |
| Yearly | 100 Xanax | $100,000,000 |

Payment recipient: **R4G3RUNN3R [3877028]**.

The Reviver Pro trial is **7 days and one-time per canonical Torn identity**. Reinstalling the userscript, replacing the session or the connected Torn API key, or deleting/reactivating the ReviveRelay account does not reset the original server-side trial timestamps.

The canonical payment-recipient identity receives server-derived `OWNER` Pro with **Lifetime** access. OWNER requires no trial or subscription invoice, but it still must satisfy reviver verification, permanent Torn revive ability, registration and transaction-safety checks.

The `$` values above mean **Torn in-game cash**, not real-world currency. ReviveRelay never sends cash or items automatically. The user manually sends the exact invoice payment in Torn and the server verifies receipt from the restricted merchant incoming-payment evidence. Paid public launch is **awaiting Torn approval**.

## Transaction safety

The server is authoritative for request state, acceptance, payment deadlines, revive verification, refunds, Pro entitlement, invoice prices and payment evidence. Important protections include:

- exactly one active request per requester;
- requester verification required inside the same database transaction that accepts a request;
- unverified requester requests hidden from the reviver queue;
- atomic request acceptance so two revivers cannot both win;
- exact payment/refund evidence matching and idempotent Torn log references;
- encrypted-at-rest user verification credentials;
- no plaintext Torn API key returned after binding;
- server-side eligibility and entitlement checks on protected reviver actions;
- immutable review/stable release channels and exact build provenance.

## Privacy and diagnostics

The same pasted Torn API key is used once to bind Torn identity and to establish the persistent ReviveRelay Verification credential, encrypted server-side, used only for the evidence required by the user's ReviveRelay role. The raw key itself is never stored in Tampermonkey, local storage or logs.

Sanitized diagnostics are **off by default**. If enabled, diagnostics exclude Torn API keys, bearer/session tokens, payment receiver credentials, raw Torn API responses, request bodies and public chat content. Raw telemetry occurrences are subject to the implemented retention job; aggregate error fingerprints may be kept for regression analysis.

Users can revoke ReviveRelay Verification and can request deletion of ReviveRelay account data from Settings. Operational account/session/credential data is removed or invalidated where safe. Minimal billing/payment and security/audit evidence may be retained where needed to prevent payment-evidence reuse and support refunds, disputes or service integrity.

See `PRIVACY.md`, `SECURITY.md`, and `TORN-API-DISCLOSURE.md` for the review disclosures.

## Review package

Torn review material lives under `docs/review/` and includes:

- staff summary;
- ReviveRelay endpoint inventory;
- Torn API inventory;
- payment verification flow;
- review checklist;
- screenshot checklist for Request, Reviver, Activity, Pro and Settings;
- exact build manifest;
- automated verification report.

The review package explicitly asks Torn staff to confirm whether ReviveRelay's **certified-request network notifications**, which originate from ReviveRelay server requests rather than unfocused Torn-page scraping, are acceptable under Torn's scripting rules.

## Source and release structure

The tracked `torn-revive-chat-collector.user.js` file is the current userscript source template despite its historical filename. The current 0.7.2 review client is direct-only and supports both desktop userscript managers and TornPDA through one shared runtime adapter. Historical chat-related modules remain in the repository for regression/history purposes but are excluded from the generated review bundle.

Installable review artifact:

`dist/review/ReviveRelay-0.7.2.user.js`

### Updates

ReviveRelay preserves native userscript update semantics instead of executing downloaded code itself. Each build carries `@version`, `@updateURL` and `@downloadURL` for its own release channel. The in-client update manager validates the expected channel, version and exact distribution URLs and checks automatically on startup and on a persisted 12-hour cadence. The Settings action **Check & install update** performs a fresh validation and, if a newer Review build exists, immediately opens the canonical Voidsmith installer so Tampermonkey or TornPDA can perform the update. A separate **Install update** button remains available after detection as a retry/fallback. Review builds update only within the review channel; Stable builds update only within the stable channel.

TornPDA 3.16+ can install remote `.user.js` scripts and update installed scripts from its script manager, including its bulk update action. ReviveRelay does not use remote `eval`, self-modifying JavaScript or TornPDA's global API key as part of updates. Released artifacts remain immutable and carry version, Git commit, build timestamp and channel-specific update/download URLs.

## Development and verification

Node.js 20+ is required. Database-backed server verification requires a disposable PostgreSQL 16 instance provided through `TEST_DATABASE_URL`. Never point automated verification at the production ReviveRelay database.

To reproduce the exact artifact recorded in `docs/review/BUILD-MANIFEST.json`, first check out its `artifactSourceCommit`. A later documentation-only commit has a different Git SHA by definition, so rebuilding there intentionally produces different embedded provenance even when executable source bytes are unchanged.

```bash
npm run build
npm run test:client
TEST_DATABASE_URL=postgres://... npm run test:server
npm run audit:review
TEST_DATABASE_URL=postgres://... npm run verify:review
```

No production API key, session token, database password, encryption secret, merchant API credential or collected Torn content belongs in this repository.
