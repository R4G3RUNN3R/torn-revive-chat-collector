# ReviveRelay 0.6.3 Review Hotfix

Client-only private-review hotfix discovered during live 0.6.2 browser acceptance.

- Fixes the Torn sidebar action when Torn replaces or clones the ReviveRelay button node while preserving its visible READY state but dropping the JavaScript click listener.
- Sidebar reconciliation now idempotently binds activation to the live node, so replacement nodes recover without duplicate handlers on intact nodes.
- Adds regression coverage reproducing the observed READY/no-request condition before the fix and proving activation after reconciliation.
- No server API contract, subscription, merchant, OWNER, trial, queue, transaction, database, or stable-production behavior changes.
- Published 0.6.2 review bytes remain immutable.
- Public production remains 0.4.4.
