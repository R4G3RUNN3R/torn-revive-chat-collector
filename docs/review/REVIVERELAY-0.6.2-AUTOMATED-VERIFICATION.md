# ReviveRelay 0.6.2 Automated Verification

This report records automated verification for the client-only ReviveRelay 0.6.2 private review hotfix discovered during live 0.6.1 browser acceptance. It does not claim completed manual browser acceptance or stable promotion.

## Browser-discovered defect

On 2026-09-10, OWNER browser acceptance showed that clicking **Set up Reviver Verification** opened Settings but left **Revive Me preset** expanded while **ReviveRelay Verification** remained collapsed. Root-cause tracing found that all contextual Settings buttons used the same destination-less `data-rr-open-settings` handler, while automatic verification expansion required the `reviver` role even though verification occurs before reviver registration.

The fix is committed at `7e7059d161011238e0cd1b3a12a0becdfa90b555` and adds explicit contextual Settings destinations. `Configure Revive Me preset` targets the preset section; requester/reviver verification prompts target ReviveRelay Verification. The review release boundary is commit `49515f2e380936b2e4088968fc81546f9df52772`.

## Exact executable candidate

- Version/channel: `0.6.2` / `review`
- Review artifact: `dist/review/ReviveRelay-0.6.2.user.js`
- Artifact source commit: `49515f2e380936b2e4088968fc81546f9df52772`
- Build timestamp: `2026-09-10T06:53:12.352Z`
- SHA-256: `c8a8dc842313d22b14a62cb01ce9e61ace82540ed9068dbb052233d3d8090c71`
- Metadata SHA-256: `426638b3440c8adcf16af3a2a8bf703d9adc935f2bd97a173fdd72a2d5eaabe0`
- Size: `120938` bytes

The artifact points only to immutable review URLs under `/releases/review/0.6.2/`. Existing 0.6.1 review bytes remain immutable and public stable production remains 0.4.4.

## Full automated verification observed

Verification ran against a disposable loopback-only PostgreSQL 16 instance, never the production ReviveRelay database. The disposable database was removed after verification.

- Client suite: **224 tests, 224 passed, 0 failed**.
- Server suite: **335 tests, 335 passed, 0 failed**.
- Release/provenance smoke: **4 tests, 4 passed, 0 failed**.
- Userscript syntax check: **passed**.
- Static review audit: **15 files audited, 0 findings**.
- Immutable artifact verifier passed both before and after the full gate with SHA-256 `c8a8dc842313d22b14a62cb01ce9e61ace82540ed9068dbb052233d3d8090c71`.

## Scope and compatibility

0.6.2 changes only client Settings navigation and release metadata/tooling needed for the new immutable client artifact. The review backend API contract remains compatible at 0.6.1; the isolated review API remains on loopback port 18731 and public stable production remains 0.4.4 on 18730. No subscription, merchant, OWNER, trial, payment, queue, transaction, or database contract was changed by this hotfix.

## Remaining browser evidence

Manual browser acceptance must resume on 0.6.2 and explicitly prove that **Set up Reviver Verification** opens Settings with **ReviveRelay Verification expanded** and **Revive Me preset collapsed**. Remaining Task 12 browser checks continue only after that regression is observed fixed in Torn.
