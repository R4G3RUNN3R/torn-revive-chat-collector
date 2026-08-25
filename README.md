# ReviveRelay

ReviveRelay is a Torn userscript plus an isolated server backend for public revive-candidate discovery and direct revive requests.

Current repository stage: **Stage 2 client complete / Stage 3 marketplace verification not yet active**.

## What the Stage 2 client does

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

## Identity and credentials

The Stage 2 identity flow uses a minimally scoped Torn custom API key only to resolve the player's Torn identity. The backend verifies it with Torn, creates/updates the ReviveRelay user, issues an opaque ReviveRelay session token, and discards the supplied identity key.

The `api_credentials` table remains reserved for the separate Stage 3 **transaction-verification credential** flow. That future credential will be minimally scoped to the evidence needed for protected payment, revive-attempt, and refund verification and will be encrypted independently of the identity flow.

## Direct Request Revive

Requester access is free. The server currently enforces:

- Cash offers: whole Torn-dollar amounts, minimum **$500,000**;
- Xanax offers: whole quantities, minimum **1 Xanax**;
- optional requester comment: maximum **500 characters**;
- one active request per requester;
- atomic reviver acceptance in the Stage 1 backend.

Stage 3 will add the protected transaction engine: payment verification, the three-minute payment window, five-minute revive SLA, revive-attempt evidence, retry/refund outcomes, and the ten-minute refund workflow. Until that work is complete, the client explicitly labels protected transaction verification as not yet active.

## Server deployment

Production-capable infrastructure lives on `new-voidsmith` under:

`/srv/voidsmith/torn-platform/reviverelay`

The backend uses its own PostgreSQL 16 container, credentials, storage path, private DB network, migrations, backups, and restore procedure. The database exposes no host PostgreSQL port and shares no ReviveRelay database network with another Voidsmith product.

Detailed deployment/isolation instructions are in `deploy/README.md`.

The API origin is currently internal-only on `127.0.0.1:18730`. Public DNS/Caddy exposure is deliberately deferred until the remaining launch gates are complete.

## Important source files

- `torn-revive-chat-collector.user.js` - installable ReviveRelay userscript.
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
node --check dist/torn-revive-chat-collector.user.js
```

No production API key, session token, database password, encryption key, or collected Torn content belongs in this repository.
