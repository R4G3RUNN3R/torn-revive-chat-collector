# ReviveRelay

ReviveRelay is a Torn userscript plus an isolated server backend for public revive-candidate discovery and direct revive requests.

Current repository stage: **Stage 3 marketplace core implemented; public launch remains gated**.

## What the client does

- positively identifies only explicitly allowlisted public Torn chats;
- rejects Faction, Company, one-to-one/private/group-private, competition, poker, and unknown channels before message parsing;
- processes public messages only while Torn is visible, focused, and recently interacted with;
- classifies revive-request language locally with a deterministic versioned classifier;
- uploads **only likely revive candidates**, never the complete public-chat stream;
- deduplicates pooled candidates server-side;
- provides a bounded local **Live Capture** monitor for classifier decisions;
- verifies Torn identity through `POST /v1/auth/bind` and stores only the returned opaque ReviveRelay session locally;
- discards the identity-binding Torn API key after the verification request rather than persisting it;
- lets a connected requester create one active Cash or Xanax revive request, inspect its state, and cancel it while the server still considers it cancellable.

The installable userscript does not send raw chat batches to Google Sheets. The legacy `google-apps-script/` directory is retained only as historical research material and is not part of the ReviveRelay runtime.

## Privacy boundary

ReviveRelay uses an **allowlist**, not a blocklist. A chat must be positively recognized as an approved public channel before the client parser can process it. The backend independently applies the same public-channel boundary, so a modified client cannot upload Faction, Company, private, or unknown channels through the candidate endpoint.

Non-candidate public messages are local-only and are not submitted to the VPS. Live Capture keeps at most 50 recent local events in memory.

Optional client diagnostics send only bounded, sanitized technical error envelopes. They are enabled by default but can be disabled in the ReviveRelay panel. Raw chats, Torn API keys, bearer tokens, request bodies, and unrelated player data are excluded; the server sanitizes again on ingestion. Raw telemetry occurrences are retained for about 30 days while aggregate fingerprint/version statistics remain available for longer-term regression tracking.

## Identity and credentials

The Stage 2 identity flow uses a minimally scoped Torn custom API key only to resolve the player's Torn identity. The backend verifies it with Torn, creates/updates the ReviveRelay user, issues an opaque ReviveRelay session token, and discards the supplied identity key.

Protected transactions use a **separate transaction-verification credential**. It is validated against the authenticated Torn identity, restricted to the smallest evidence scope ReviveRelay needs, encrypted with AES-GCM using a server-side key held outside PostgreSQL, and never returned to the client after binding.

Requester capability requires only the Torn profile/revive evidence needed to verify hospitalization and incoming revive outcomes. Reviver capability additionally requires narrowly restricted incoming/outgoing money and item-log access so Cash/Xanax payments and refunds can be independently reconciled. Over-broad or unrelated private access is rejected rather than treated as acceptable.

## Protected revive marketplace

Requester access is free. The server enforces:

- Cash offers: whole Torn-dollar amounts, minimum **$500,000**;
- Xanax offers: whole quantities, minimum **1 Xanax**;
- optional requester comment: maximum **500 characters**;
- one active request per requester;
- atomic reviver acceptance so exactly one reviver can win a request;
- a **3-minute payment window**, followed by bounded reconciliation against Torn evidence;
- a **5-minute revive SLA** after verified payment;
- immutable revive-attempt evidence and explicit handling for genuine failure, third-party revive, requester self-exit, natural hospital expiry, and no-attempt outcomes;
- retry without a second payment when a genuine assigned attempt fails;
- requester-controlled retry/refund choice after a genuine failed attempt;
- a **10-minute refund window** when a refund becomes required;
- refund verification against the **actual verified payment value**, including split payments and overpayments;
- server-authoritative state transitions, timestamps, deadlines, and idempotent background jobs.

The userscript renders server-provided transaction state and countdowns. It can request named actions such as payment check, retry, refund, and refund check, but it cannot submit arbitrary transaction states.

Verification outages or credential loss create evidence holds and retries; they do **not** rewrite contractual deadlines or automatically create misconduct findings.

## Stage 3 boundaries and later stages

Stage 3 provides the protected marketplace core, not the entire planned ReviveRelay product. The following remain separate later-stage work:

- **Stage 4:** reputation, disputes, evidence bundles, protective suspensions/bans, administrator tooling, and the one-way operational Google Sheets views;
- **Stage 5:** Reviver Pro trial/subscription verification and paid-feature gating.

`PAID_TIER_ENABLED` must remain false until Stage 5 and the Torn monetization/compliance launch gate are complete. Public DNS/Caddy exposure and general distribution also remain separate launch gates.

## Server deployment

Production-capable infrastructure lives on `new-voidsmith` under:

`/srv/voidsmith/torn-platform/reviverelay`

The backend uses its own PostgreSQL 16 container, credentials, storage path, private DB network, migrations, backups, and restore procedure. The database exposes no host PostgreSQL port and shares no ReviveRelay database network with another Voidsmith product.

Detailed deployment/isolation instructions are in `deploy/README.md`.

The API origin is currently internal-only on `127.0.0.1:18730`. Public DNS/Caddy exposure is deliberately deferred until the remaining launch gates are complete.

Operational error groups can be mirrored one-way to the private `Voidsmith Error Triage` Google Sheet. Only aggregate fields are exported; internal user IDs are never mirrored. Automatic sync owns columns A:N, while human workflow columns O:S (`Status`, `Owner`, `Notes`, `GitHub Issue`, `Fixed In`) are preserved. The Google service-account secret is mounted read-only into the ReviveRelay worker only.

## Important source files

- `torn-revive-chat-collector.user.js` - release-build template; do not install it directly because release-time Git commit markers are unresolved in source.
- `src/chat-dom.js` - Torn chat discovery and virtualized-DOM adapter.
- `src/public-channels.js` - canonical public-channel allowlist.
- `src/client-chat-policy.js` - fail-closed client privacy policy.
- `src/revive-classifier.js` - deterministic local revive classifier.
- `src/candidate-pipeline.js` - local classification and candidate-only upload shaping.
- `src/api-client.js` - typed userscript API client and retrying candidate outbox primitives.
- `server/` - isolated Fastify/PostgreSQL backend and worker.
- `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md` - product/architecture design.

## Development

Requires Node.js 20+ and PostgreSQL 16 for database-backed server tests.

Client tests:

```bash
npm run test:client
```

Server tests require `TEST_DATABASE_URL` pointing to a disposable PostgreSQL test database:

```bash
TEST_DATABASE_URL=postgres://... npm --prefix server test
```

Build and syntax-check the userscript:

```bash
npm run build
node --check dist/reviverelay-auto.user.js
node --check dist/reviverelay-manual.user.js
```

No production API key, session token, database password, encryption key, or collected Torn content belongs in this repository.


## Client releases and updates

ReviveRelay client version `0.4.1` hardens the automatic and manual release channels. Every generated `@require` URL is pinned to the exact 40-hex GitHub release commit, and client telemetry carries that same build commit. The release command rejects moving/stale dependency refs and verifies each pinned GitHub support module byte-for-byte against the committed local source before a manifest can be published. Automatic installations use Tampermonkey's native `@updateURL`/`@downloadURL` behavior; manual installations disable native updates and receive a once-daily JSON manifest check plus an install link. ReviveRelay never downloads and `eval()`s executable updates and never rewrites its own userscript.

The API exposes the validated release manifest at `/v1/client/version`. Protected marketplace mutations require a supported `X-ReviveRelay-Version`; health, version discovery, authentication, `/v1/me`, telemetry and safe read-only routes remain available to old clients. Immutable client artifacts live under `/srv/voidsmith/torn-platform/reviverelay/releases/client/<version>/`. Only generated files from `dist/` are installable release artifacts; the tracked userscript source is a build template. Public Caddy/DNS serving remains a separate cutover and is not enabled by this release.
