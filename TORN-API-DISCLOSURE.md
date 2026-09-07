# ReviveRelay Torn API Disclosure

ReviveRelay 0.6.0 uses the official Torn API for identity, evidence and eligibility checks. The userscript does not require the user's Torn password.

## Data Storage

The one-time identity key is not stored. A separate ReviveRelay Verification key may be stored encrypted at rest on the ReviveRelay server so later transaction/revive evidence can be checked without asking the user to paste the key every time. Plaintext stored credentials are not returned to the client.

## Data Sharing

ReviveRelay does not sell API-derived data or share it with advertisers or unrelated third parties. API calls are made only to Torn for the stated service purposes.

## Purpose of Use

The implemented Torn API calls are:

| Torn API operation | Purpose |
| --- | --- |
| `/key/info` | Resolve API-key owner and granted selections/access. |
| `/user/basic` | Resolve identity during one-time ReviveRelay account binding. |
| `/user/profile` | Obtain requester hospital/profile state required for revive outcome evidence. |
| `/user/revives` | Read incoming/outgoing revive evidence for requester/reviver verification. |
| `/user/perks` | Confirm permanent `Ability to revive` before reviver access. |
| `/user/log` | Read narrowly scoped Money/Items transaction evidence for revive payments/refunds and merchant subscription receipt verification. |
| `/torn/logcategories` | Resolve current log category metadata where the key permits it; restricted-key permission failure uses the known bounded transaction categories rather than broadening access. |

ReviveRelay 0.6.0 performs **no public chat collection** and does not scrape Torn chat or unfocused Torn pages.

## Key Storage & Sharing

Persistent ReviveRelay Verification credentials are encrypted server-side with AES-GCM. The encryption key is held outside PostgreSQL. The application does not intentionally write plaintext credentials to normal logs, telemetry or user-facing responses.

Users can revoke the stored ReviveRelay Verification credential from ReviveRelay Settings. To revoke the Torn API key itself, the user must also delete it in Torn API settings.

## Recommended Key Access Level

### Requester verification

Recommended restricted custom key:

- Basic
- Profile
- Revives

This is sufficient for the requester evidence ReviveRelay needs before the request may be accepted and for later revive/hospital outcome checks.

### Reviver / combined verification

Recommended restricted custom key:

- Basic
- Profile
- Revives
- Perks
- Log access restricted to categories 14, 15, 16 and 17 used for Money/Items incoming/outgoing evidence

The reviver key also satisfies requester evidence so a reviver can use `Revive Me` without replacing keys.

### Subscription merchant verification

The server uses a separate **restricted merchant** credential for the canonical receiving Torn account **R4G3RUNN3R [3877028]**. It is validated to the merchant identity and restricted incoming Money/Items evidence needed to verify prepaid Pro receipts. The merchant credential is never sent to the userscript.

## Broad keys

A user-supplied Broad/Full key may be accepted when it belongs to the authenticated Torn user and contains the evidence permissions ReviveRelay needs. ReviveRelay warns that this grants more access than necessary and recommends replacing it with the restricted key.

## Manual Torn-action boundary

ReviveRelay reads evidence through the official API but does not automatically execute Torn game actions. Subscription payment is sent **manually** by the user in Torn. Actual reviving is a manual Torn action by the reviver. ReviveRelay does not auto-accept a request, send cash/items, bypass CAPTCHA, or make hidden non-API Torn requests.

## Review status

Requester access is free. Reviver Pro has a 7-day trial and the prepaid review pricing described in `SUBSCRIPTION-MODEL.md`. Paid public launch is awaiting Torn approval.

Torn reviewers are specifically asked to confirm whether **certified-request network notifications**, generated from ReviveRelay's own server-side direct request network and not from Torn-page scraping, are acceptable under Torn's scripting rules.
