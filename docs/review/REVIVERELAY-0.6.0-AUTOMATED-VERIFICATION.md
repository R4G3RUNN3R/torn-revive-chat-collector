# ReviveRelay 0.6.0 Automated Verification

This report records observed results for the exact 0.6.0 review artifact generated from the committed code candidate.

## Candidate identity

- Artifact source Git SHA: `396582a2929bc2d969a338a44d8ddfadaaf29c04`
- Review artifact: `dist/review/ReviveRelay-0.6.0.user.js`
- Version/channel: `0.6.0` / `review`
- Build timestamp embedded in artifact: `2026-09-07T15:15:49.386Z`
- Artifact size: `113956` bytes
- Artifact SHA-256: `22fda6213eb6c9200b140d365f68b70da8fd0ceaee8c183464f0758af3e81eb7`
- Public production: **0.4.4**, unchanged and not promoted

## Exact verification command

The complete Task 12 verification was run on `new-voidsmith` with `TEST_DATABASE_URL` pointed at a disposable PostgreSQL 16 container, not the production ReviveRelay database:

```bash
TEST_DATABASE_URL=postgres://<disposable-postgresql-16>/postgres npm run verify:review
```

The disposable database password/connection detail is operational test data and is intentionally not recorded in the review package.

To reproduce this exact artifact hash, check out the `artifactSourceCommit` above before running the command. Documentation-only commits made after artifact verification naturally have different Git provenance and must not be silently substituted for the reviewed executable artifact.

## Observed results

`npm run verify:review` completed with exit status 0 and produced:

- Client/review suite: **210 / 210 passed**, 0 failed.
- Server suite: **320 / 320 passed**, 0 failed.
- Focused release/provenance smoke invoked by `verify:review`: **4 / 4 passed**, 0 failed.
- Generated userscript syntax check: passed.
- Static review package audit: `ok: true`.
- Static review package audit files inspected: **15**.
- Static review audit findings: **0**.

The audit's negative fixtures separately prove failure on embedded secret-like literals, unexpected `@connect` hosts, dynamic/remote executable code, unreviewed HTML sinks, excessive userscript grants, legacy chat runtime identifiers and stale 0.5.0/automatic release metadata.

## Requester-verification security regression

Before Task 12 packaging, the bounded Option A security correction was also verified independently:

- focused client security/UI tests: **33 / 33 passed**;
- focused requester/Accept server tests: **10 / 10 passed**;
- full server suite after historical fixtures were updated for the new invariant: **320 / 320 passed**.

The production invariant under test is that an unverified requester may create a request, but the request is hidden from the reviver queue and `Accept` cannot create a transaction/payment window until the requester has a usable requester-evidence credential.

## What this automation does not prove

Automated verification does not replace real Torn browser acceptance. Request, Reviver, Activity, Pro and Settings screenshots/manual acceptance remain **pending human capture** in `SCREENSHOT-CHECKLIST.md`.

This report does not claim Torn approval. Paid public launch remains awaiting Torn approval.
