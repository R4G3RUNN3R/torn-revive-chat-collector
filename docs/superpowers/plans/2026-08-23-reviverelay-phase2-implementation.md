# ReviveRelay Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the existing Torn Revive Chat Collector into ReviveRelay: a public-channel-only revive lead collector plus a free requester / paid reviver marketplace with verified payments, revive SLAs, refunds, reputation, disputes, bans, and Xanax-funded Reviver Pro.

**Architecture:** Keep the userscript as the Torn-facing client, but move all authoritative pooled and transactional state to a Node.js API plus worker backed by an isolated PostgreSQL instance on the new VPS. Public chat is classified locally and only likely revive candidates are uploaded. Google Sheets becomes a one-way administrative mirror, never an authority.

**Tech Stack:** Node.js 20+, CommonJS userscript modules, Fastify, PostgreSQL 16, `pg`, Zod, Node `crypto` AES-256-GCM, Node built-in test runner, Docker Compose, Google Apps Script admin mirror.

**Spec:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

**Correctness amendment:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-review-amendment.md`

## Global Constraints

- Only positively allowlisted public Torn chat channels may be processed for pooled candidate detection.
- Faction, Company, private, group-private, and unknown channels must never enter classification or upload.
- Raw public chat is not centrally archived; classification occurs locally and only likely revive candidates are submitted.
- Torn collection retains the active-use gate: visible, focused, recently interacted; no hidden-tab WebSocket harvesting or automated chat cycling.
- Direct request payment methods are Cash (minimum $500,000 Torn dollars) or Xanax (minimum 1); no Free or Other payment option.
- Request reservation/payment window is 3 minutes, followed by a 60-second payment reconciliation window before release.
- The five-minute revive SLA starts only after payment is verified.
- Failed-revive retry approval window is 2 minutes; no response moves to refund required.
- Required refunds have a 10-minute deadline.
- Reviver Pro trial is 7 days; 2 Xanax = 30 days; 20 Xanax = 365 days; annual multiples scale linearly.
- Requesters remain free; no per-job commission and no paid queue priority.
- Node.js runtime floor is 20.
- ReviveRelay runs under `/srv/voidsmith/reviverelay` on the new VPS.
- ReviveRelay uses its own PostgreSQL container/instance, DB user, private network, volume, backups, logs, migrations, and credentials.
- PostgreSQL publishes no public host port.
- ReviveRelay receives no DungeonMasterOS, Nexis, or other Voidsmith database credentials and shares no DB network with them.
- Google Sheets is a one-way admin mirror only; editing Sheets must never mutate authoritative state.
- API keys are encrypted at rest, never logged, never written to Sheets, and decrypted only by backend verification services.
- Timers and state transitions are server-derived; clients cannot submit arbitrary authoritative states.
- All implementation follows TDD with a failing test observed before production code.

---

## Delivery decomposition

The approved Phase 2 spec contains five independently reviewable subsystems, so implementation is intentionally split into five executable plans instead of one heroic 2,000-line checklist that nobody can safely review.

1. **Stage 1 - Backend foundation**
   - File: `docs/superpowers/plans/2026-08-23-reviverelay-stage1-backend-foundation.md`
   - Deliverable: isolated PostgreSQL/API foundation, identity/session binding, public candidate ingestion/deduplication, direct request persistence/state primitives, CI and deployment definitions.

2. **Stage 2 - ReviveRelay client**
   - File: `docs/superpowers/plans/2026-08-23-reviverelay-stage2-client.md`
   - Deliverable: renamed userscript, public-only discovery, local classifier, authenticated API client, Live Capture, direct request form and requester status UI.

3. **Stage 3 - Marketplace verification**
   - File: `docs/superpowers/plans/2026-08-23-reviverelay-stage3-marketplace-verification.md`
   - Deliverable: reviver queue/acceptance, Torn payment/revive/refund verification, all timers and exception states, end-to-end requester/reviver transaction UI.

4. **Stage 4 - Trust and administration**
   - File: `docs/superpowers/plans/2026-08-23-reviverelay-stage4-trust-admin.md`
   - Deliverable: reputation, disputes, evidence snapshots, suspension/bans, audit tooling, and one-way Google Sheets mirror.

5. **Stage 5 - Reviver Pro**
   - File: `docs/superpowers/plans/2026-08-23-reviverelay-stage5-reviver-pro.md`
   - Deliverable: 7-day trial, Xanax subscription crediting, monthly/yearly plans, paid-feature gating, publication/compliance controls.

## Cross-stage file map

### Existing client files retained/refactored

- `torn-revive-chat-collector.user.js` - keep the existing install URL for upgrade continuity; metadata/name changes to ReviveRelay in Stage 2.
- `src/core.js` - shared text/identity helpers; remove legacy pooled fingerprint assumptions once candidate identity is server-authoritative.
- `src/chat-dom.js` - Torn chat discovery/extraction; Stage 2 changes it to public-only attachment.
- `scripts/build.js` - continues producing the installable userscript and is extended to validate required modules/metadata.
- `test/*.test.js` - existing regression coverage remains green throughout.

### New shared/client modules

- `src/public-channels.js` - canonical public-channel allowlist and classification.
- `src/revive-classifier.js` - deterministic local revive-request classifier.
- `src/api-client.js` - backend transport/auth/retry layer.
- `src/request-form.js` - pure direct-request form validation/model logic.
- `src/live-capture.js` - in-memory Live Capture event model/filtering.

### New backend package

- `server/package.json` - backend dependencies/scripts.
- `server/src/app.js` - Fastify application factory.
- `server/src/config.js` - validated environment configuration.
- `server/src/db/*` - PostgreSQL pool, migration runner, repositories.
- `server/src/domain/*` - pure state/validation/reputation/subscription rules.
- `server/src/routes/*` - versioned HTTP API.
- `server/src/security/*` - API-key encryption, session token hashing, authorization.
- `server/src/torn/*` - Torn API adapter and verification parsers.
- `server/src/worker/*` - due-job claiming, verification and mirror jobs.
- `server/test/*` - unit/integration tests.

### New deployment files

- `deploy/docker-compose.yml` - isolated API/worker/PostgreSQL services and private network.
- `deploy/.env.example` - ReviveRelay-only configuration names; no real secrets.
- `deploy/reviverelay.nginx.conf.example` - reverse proxy example exposing only HTTPS API traffic.
- `deploy/backup.sh` and `deploy/restore.sh` - ReviveRelay-only backup/restore scripts.
- `deploy/README.md` - exact `/srv/voidsmith/reviverelay` deployment procedure and isolation checks.

### Google Sheets mirror

- `google-apps-script/Code.gs` - converted from authoritative raw-chat receiver to authenticated one-way admin mirror receiver during Stage 4.

## Stage gates

A stage is complete only when:

1. its focused unit/integration tests pass;
2. the full root `npm test` suite passes;
3. `npm run build` succeeds;
4. syntax checks pass for changed JavaScript files;
5. any database migration can be applied from empty and re-run safely according to its migration contract;
6. no privacy regression permits a forbidden chat type into candidate ingestion;
7. the stage has a fresh code-review pass before merging to `main`.

Stage 3 must not start against production users until Stage 1 and Stage 2 are merged and their end-to-end staging smoke test succeeds. Stage 5 paid gating remains disabled by configuration until the launch compliance gate is explicitly cleared.
