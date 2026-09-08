# ReviveRelay 0.6.1 Automated Verification

This report is the **pre-final review evidence record** for ReviveRelay 0.6.1. Task 10 will replace the interim artifact values and add the final full-suite counts after all code, documentation and deployment descriptors are committed. Nothing here claims Torn approval or completed browser acceptance.

## Current executable candidate

- Version/channel: `0.6.1` / `review`
- Review artifact: `dist/review/ReviveRelay-0.6.1.user.js`
- Interim artifact source commit: `05aef14616d23e4aa3991a2a6f45316b1a5cf3d8`
- Interim build timestamp: `2026-09-08T09:13:03.226Z`
- Interim SHA-256: `5859bd9951c97026f151e4ac5403a65fb96ab96e93dc09d97ec27276108c30d4`
- Interim size: `120361` bytes
- Final exact-candidate verification: **pending Task 10**

## Security/regression evidence already observed

Focused automated tests completed during implementation include:

- explicit review runtime contract and route metadata;
- canonical merchant OWNER derivation and spoof rejection;
- OWNER still requiring verification, Torn revive ability and registration;
- one-time trial persistence across session destruction, userscript reinstall simulation, verification-key replacement, account delete/reactivate and repository restart using disposable PostgreSQL 16;
- review-client fail-closed behavior for missing/stable/incompatible runtime metadata;
- `/review/v1/*` review API URL construction;
- OWNER/Lifetime UI with trial/invoice controls suppressed;
- dedicated review subscription scanning with no shared generic-job dependency;
- immutable 0.6.1 build/audit/provenance smoke checks.

All focused gates were green before their corresponding commits. Final client/server totals and final static-audit results will be recorded only after Task 10 executes the complete candidate verification.

## Production boundary

Public production remains **0.4.4**. Stable 0.4.4 is unchanged. This 0.6.1 evidence belongs to the private review channel only.
