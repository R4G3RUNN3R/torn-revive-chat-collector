# ReviveRelay Stage 2 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and deploy the ReviveRelay requester/client stage, retire the old raw Google Sheets collector path, and ensure identity-binding API keys are discarded rather than stored.

**Architecture:** The installable Tampermonkey userscript processes only explicitly allowlisted public Torn chats while Torn is actively used, classifies locally, and uploads only revive candidates to the isolated ReviveRelay API. Identity binding verifies a Torn custom key only long enough to establish the Torn player identity and issue an opaque ReviveRelay session; the identity key is not persisted. Protected payment/revive/refund verification credentials are a separate Stage 3 concern and will use a separately bound minimally scoped credential.

**Tech Stack:** Tampermonkey userscript, vanilla JavaScript support modules, Fastify 5, PostgreSQL 16, Node.js 20, Node test runner, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

## Global Constraints

- Public channels use an allowlist. Faction, Company, private/group-private, competition, poker, and unknown chat content must never enter the candidate pipeline.
- Raw public chat is not centrally archived. Only locally classified revive candidates are uploaded.
- Collection/upload remains gated by visible, focused, recently interacted Torn use.
- Google Sheets is not a userscript destination and remains server-side optional one-way administration only.
- The identity-binding Torn API key is verified and discarded. It must not be inserted into `api_credentials`.
- Persistent transaction-verification credentials are not introduced by this stage; Stage 3 will bind them separately with minimal scopes.
- ReviveRelay PostgreSQL/network/secrets remain isolated from every other Voidsmith product.
- Public DNS/Caddy exposure remains disabled during this stage.
- `PAID_TIER_ENABLED=false` remains unchanged.
- Completed and verified work is merged to `main`.

---

### Task 0: Reconcile the Approved Identity-Key Decision Into the Spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

**Interfaces:**
- Consumes: approved architecture decision that ordinary identity verification must not permanently store a Torn API key.
- Produces: a canonical distinction between `identity verification key` and `persistent transaction-verification credential`.

- [ ] **Step 1: Update section 15.1** so identity binding explicitly verifies `key/info`, issues the ReviveRelay session, and discards the supplied key after the request completes.
- [ ] **Step 2: Update section 15.4** so only separately bound transaction-verification credentials may be encrypted/persisted, never the identity-only key.
- [ ] **Step 3: Add a Stage 3 delivery bullet** for separate requester/reviver verification-credential binding before protected marketplace verification.
- [ ] **Step 4: Review the diff** and confirm no secret values or unrelated design changes are introduced.

### Task 1: Finish the Candidate-Only Userscript Integration

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/build.js`
- Test: `test/autosync.test.js`
- Test: `test/candidate-pipeline.test.js`
- Test: `test/client-privacy.test.js`

**Interfaces:**
- Consumes: `ReviveRelayCandidatePipeline.handlePublicMessage(record, options)`, `ReviveRelayApiClient.createOutboxEntry(candidate)`, `ReviveRelayApiClient.drainCandidateOutbox(...)`, `ReviveRelayApiClient.createApiClient(...)`.
- Produces: installable userscript whose only automatic server submission path is candidate submission to ReviveRelay.

- [ ] **Step 1: Re-run the existing four RED integration tests** and preserve their failure names as the starting evidence.
- [ ] **Step 2: Add the required userscript modules** `src/revive-classifier.js` and `src/candidate-pipeline.js` to `@require` and to `scripts/build.js` dependency checks.
- [ ] **Step 3: Remove all Google Apps Script metadata/configuration** including `@connect script.google.com`, `@connect script.googleusercontent.com`, Sheet endpoint/token keys, `BATCH_SIZE`, `SYNC_EVERY_MS`, `postJson`, `markSynced`, and the raw Sheet batch sync function.
- [ ] **Step 4: Rename userscript-facing metadata/UI from Torn Revive Chat Collector/Revive Research Collector to ReviveRelay** while retaining the same Torn `@match` and public-chat privacy boundary.
- [ ] **Step 5: Change the parsed-message sink** so every eligible public message is passed to `ReviveRelayCandidatePipeline.handlePublicMessage`; non-candidates remain local-only and are never submitted.
- [ ] **Step 6: Implement `enqueueCandidate(payload)`** using `createOutboxEntry`, local persisted candidate outbox state, and no raw-message persistence.
- [ ] **Step 7: Implement `drainCandidateOutbox()`** with an immediate `if (!captureAllowed()) return;`, then call shared `drainCandidateOutbox` and persist pending/dead-letter state.
- [ ] **Step 8: Run the candidate/autosync/privacy tests** and require all to pass before continuing.

### Task 2: Add Session Onboarding and `/v1/me`

**Files:**
- Modify: `src/api-client.js`
- Modify: `torn-revive-chat-collector.user.js`
- Create: `server/src/routes/me.js`
- Modify: `server/src/app.js`
- Create: `server/test/routes/me.test.js`
- Modify: `test/api-client.test.js`

**Interfaces:**
- Consumes: opaque session returned by `POST /v1/auth/bind`; `request.reviveRelayUser` installed by server authentication.
- Produces: `GET /v1/me -> { user: { tornId, name }, roles: string[] }` and a client onboarding/session restore flow.

- [ ] **Step 1: Write server RED tests** proving `/v1/me` rejects missing auth and returns the authenticated Torn identity/roles without API credentials.
- [ ] **Step 2: Implement `server/src/routes/me.js`** using only `request.reviveRelayUser` and no key material.
- [ ] **Step 3: Register `/v1/me`** whenever session authentication is installed.
- [ ] **Step 4: Extend API-client tests** for `getMe()` success and auth failure behavior.
- [ ] **Step 5: Add userscript session keys** for opaque ReviveRelay token and cached public identity only.
- [ ] **Step 6: Implement onboarding UI** with Torn API key input, `Verify & connect`, call `api.bind(key, VERSION)`, store only returned ReviveRelay token/public identity, and clear the API-key input immediately after completion/failure.
- [ ] **Step 7: On startup with a stored session token, call `getMe()`**; keep a valid session or clear only ReviveRelay session state on 401/403.
- [ ] **Step 8: Run route/API-client/client tests** and require green.

### Task 3: Add Free Requester Workflow

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `src/api-client.js` only if response shaping requires it.
- Create: `test/requester-ui.test.js`

**Interfaces:**
- Consumes: `createRequest({ paymentMethod, amount, comment })`, `getActiveRequest()`, `cancelRequest(id)`.
- Produces: free requester UI for Cash/Xanax request creation, active request status, and pre-payment cancellation.

- [ ] **Step 1: Write RED source-contract tests** asserting the installable userscript exposes Cash/Xanax selection, Cash minimum `500000`, Xanax minimum `1`, optional comment, request submission, active-request refresh, and cancel action.
- [ ] **Step 2: Implement Request Revive form** visible to authenticated users with payment method `cash|xanax`, whole-number amount, and optional comment capped at 500 characters.
- [ ] **Step 3: Apply client convenience validation** matching server minimums while treating server validation as authoritative.
- [ ] **Step 4: Implement `refreshActiveRequest()`** and render request id/state/payment terms/timestamps returned by the server.
- [ ] **Step 5: Implement pre-payment cancel action** using `cancelRequest(id)` and refresh state afterward.
- [ ] **Step 6: Preserve Stage 2 honesty** by labelling protected payment/revive verification as not yet active until Stage 3 rather than faking transaction verification in the browser.
- [ ] **Step 7: Run requester/API/server request tests** and require green.

### Task 4: Implement Live Capture Without Raw Central Archiving

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Create: `test/live-capture.test.js`

**Interfaces:**
- Consumes: `onLocalEvent({ channel, record, classification })` from candidate pipeline.
- Produces: bounded in-memory Live Capture rows and candidate/outbox counters.

- [ ] **Step 1: Write RED tests** for Live Capture labels/state, classifier score/decision, channel, bounded row retention, queue count and successful/dead-letter counters.
- [ ] **Step 2: Add a bounded in-memory event list** with a maximum of 50 entries; do not persist non-candidate raw messages to server storage.
- [ ] **Step 3: Render Live Capture** inside the ReviveRelay panel with public channel, candidate decision, score, candidate text and submission state.
- [ ] **Step 4: Keep collection independent of panel minimization** so minimizing the UI does not disable eligible collection.
- [ ] **Step 5: Run Live Capture and privacy tests** and require green.

### Task 5: Make Identity Binding Discard the Torn Key

**Files:**
- Modify: `server/src/routes/auth.js`
- Modify: `server/src/db/users.js`
- Modify: `server/test/routes/auth.test.js`
- Modify: `server/test/stage1-smoke.test.js`
- Create: `server/test/db/identity-key-discard.test.js`

**Interfaces:**
- Consumes: Torn `getKeyInfo(apiKey)` response and session token generation.
- Produces: user/session binding with zero `api_credentials` insertions from `/v1/auth/bind`.

- [ ] **Step 1: Write RED auth tests** proving `identityRepository.bindIdentity` receives no ciphertext/iv/authTag and that the route never calls `encryptSecret` for identity binding.
- [ ] **Step 2: Write a PostgreSQL integration RED test** that binds an identity and asserts `api_credentials` row count for that user remains zero while a valid session row exists.
- [ ] **Step 3: Remove identity-key encryption from `routes/auth.js`** and pass only Torn ID, name, token hash, client version, and non-secret access metadata if needed for auditing.
- [ ] **Step 4: Modify `db/users.js`** so identity binding upserts the user, writes the session and audit event, but never inserts/revokes `api_credentials`.
- [ ] **Step 5: Keep `api_credentials` schema intact** for the separate Stage 3 verification-credential workflow.
- [ ] **Step 6: Run all auth/security/database tests** and require green.

### Task 6: Full Stage 2 Verification and Internal Deployment

**Files:**
- Modify: `README.md`
- Runtime: `/srv/voidsmith/torn-platform/reviverelay/app`

**Interfaces:**
- Consumes: completed Stage 2 source plus isolated VPS foundation.
- Produces: internally deployed API/worker/client artifact with no public DNS cutover.

- [ ] **Step 1: Update README** from research collector language to the implemented ReviveRelay Stage 2 behavior and clearly state Stage 3 limitations.
- [ ] **Step 2: Run full client test suite.**
- [ ] **Step 3: Run full server suite using a disposable PostgreSQL 16 test database.**
- [ ] **Step 4: Run `npm run build` and `node --check dist/torn-revive-chat-collector.user.js`.**
- [ ] **Step 5: Run static/runtime database-isolation gates** and require no cross-project network/credentials/ports.
- [ ] **Step 6: Stage the verified worktree snapshot into `/srv/voidsmith/torn-platform/reviverelay/app`**, run migrations, restart API/worker only, and verify `/health` on `127.0.0.1:18730`.
- [ ] **Step 7: Verify `PAID_TIER_ENABLED=false`, no public DNS record, and no Caddy public ReviveRelay route.**
- [ ] **Step 8: Perform a fresh backup and disposable restore verification.**

### Task 7: Finish to `main`

**Files:**
- Git integration only.

**Interfaces:**
- Consumes: fully verified Stage 2 branch.
- Produces: `main` containing Stage 2 completion and synchronized GitHub tree.

- [ ] **Step 1: Commit all Stage 2 completion changes locally** with no secrets or generated runtime data.
- [ ] **Step 2: Re-run full tests/build on the commit.**
- [ ] **Step 3: Merge the completed branch to local `main`.**
- [ ] **Step 4: Re-run full tests/build on merged `main`.**
- [ ] **Step 5: Synchronize GitHub `main` using the connected GitHub integration if the VPS still lacks non-interactive Git credentials.**
- [ ] **Step 6: Verify local `main`, `origin/main`, and GitHub tree contents match.**
- [ ] **Step 7: Remove the completed worktree/feature branch.**
- [ ] **Step 8: Update the Voidsmith Source of Truth with the Stage 2 completion state and deferred Stage 3 verification-credential/payment engine work.**
