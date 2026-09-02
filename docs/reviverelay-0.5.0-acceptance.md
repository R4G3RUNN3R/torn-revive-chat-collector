# ReviveRelay 0.5.0 Acceptance Gate

Version: `0.5.0`

This checklist is the mandatory real-browser acceptance gate for the direct-only ReviveRelay release. Automated source, server, privacy, and packaging verification must not be treated as a substitute for these Torn/Tampermonkey checks.

## Free/direct browser gate

- [ ] Panel appears in Torn/Tampermonkey.
- [ ] Sidebar shows `ReviveRelay → Revive Me!`.
- [ ] Sidebar survives Torn navigation and does not duplicate.
- [ ] Free requester can save Cash/Xanax preset.
- [ ] One click creates exactly one certified request.
- [ ] No chat needs to be open.
- [ ] Second Pro/trial reviver sees ★ CERTIFIED REQUEST.
- [ ] Free account cannot use reviver queue.
- [ ] 7-day trial unlocks reviver queue.
- [ ] Request cancellation/state transitions work.
- [ ] No public chat collection is observed.

## Paid Pro browser/payment gate

- [ ] Paid invoice/payment acceptance completed after paid tier is enabled.

## Promotion rule

Production-channel promotion is not authorized by this checklist alone. Promotion requires completion of the applicable acceptance gates and separate explicit approval.
