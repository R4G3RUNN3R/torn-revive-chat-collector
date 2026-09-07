# ReviveRelay 0.6.0 Torn API Inventory

The ReviveRelay backend uses official Torn API v2 endpoints. User keys are supplied in the API-key header rather than query-string URLs.

| Endpoint | Used with | Reason |
| --- | --- | --- |
| `/key/info` | identity and verification keys | Confirm key owner and granted selections/access. |
| `/user/basic` | one-time identity key | Resolve Torn ID/name during ReviveRelay account binding. The key is not stored. |
| `/user/profile` | requester/combined ReviveRelay Verification | Capture the requester profile/hospital state required to distinguish revive outcomes from self-exit/natural expiry. |
| `/user/revives` | requester/combined and reviver verification | Read incoming requester revives and outgoing assigned-reviver evidence within bounded windows. |
| `/user/perks` | reviver verification | Confirm the permanent `Ability to revive` before reviver registration/queue access. |
| `/user/log` | reviver verification and merchant subscription verification | Read only bounded Money/Items evidence needed for Cash/Xanax payment and refund reconciliation. |
| `/torn/logcategories` | reviver verification setup | Resolve current log category names when the custom key can read them. Torn error 16 on a restricted key uses the bounded known ReviveRelay transaction categories rather than requesting broader permissions. |

## Recommended requester key

- Basic
- Profile
- Revives

A request can be created before this credential is connected, but the server does not place the request into the reviver queue and does not allow `Accept` until requester evidence capability is present.

## Recommended reviver / combined key

- Basic
- Profile
- Revives
- Perks
- Log categories 14-17 for the restricted Money/Items incoming/outgoing evidence ReviveRelay uses

A reviver/combined key also satisfies requester evidence. ReviveRelay marks a broader user key as broader than recommended instead of pretending it is narrowly scoped.

## Subscription merchant key

The subscription worker uses a separate **restricted merchant** credential for **R4G3RUNN3R [3877028]**. It is validated as belonging to the canonical payment recipient and is restricted to incoming Money/Items evidence needed to confirm prepaid invoices. It is never returned to or embedded in the userscript.

## What ReviveRelay does not use

The 0.6.0 runtime has **no public chat collection**, does not scrape Torn chat, and does not use background/unfocused page data as a substitute for the official API. ReviveRelay does not need the user's Torn password.

ReviveRelay also does not use the API to execute payments or revives. Payment to R4G3RUNN3R [3877028] and the actual revive are **manual Torn actions**.

## Review status

The API-based Reviver Pro model includes a 7-day trial and the proposed prices of 10 Xanax / $10,000,000 monthly, 55 Xanax / $55,000,000 for 6 months, and 100 Xanax / $100,000,000 yearly. Paid public launch is awaiting Torn approval.
