# ReviveRelay 0.6.4 Review Hotfix

Client-only private-review hotfix discovered during live 0.6.3 browser acceptance.

- Hardens **ReviveRelay → Revive Me!** against Torn sidebar event interception by handling the ReviveRelay action through a window-level capture/delegation boundary in addition to the existing direct listener.
- Deduplicates each browser event so capture plus direct-listener delivery cannot create two requests from one click.
- Preserves the 0.6.3 reconciliation fix for Torn-replaced/listenerless sidebar nodes.
- Adds a user-controlled **Desktop notifications for new certified requests** checkbox under Settings → Notifications. It defaults to on for existing behavior and can be turned off without disabling the reviver queue or Accept controls.
- Adds regression coverage for the capture/delegation path and the notification preference.
- No server API contract, subscription, merchant, OWNER, trial, queue, transaction, database, or stable-production behavior changes.
- Published 0.6.3 review bytes remain immutable.
- Public production remains 0.4.4.
