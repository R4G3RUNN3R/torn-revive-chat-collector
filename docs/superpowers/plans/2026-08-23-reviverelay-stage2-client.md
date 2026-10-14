# ReviveRelay Stage 2 Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing collector userscript into ReviveRelay while preserving the current install path, enforcing public-only local chat inspection, classifying revive candidates locally, submitting only candidates, and adding Live Capture plus the free direct-request UI.

**Architecture:** Retain the existing UMD/CommonJS modules and the current userscript filename for upgrade continuity. Add focused pure modules for channel policy, classification, API transport, direct-request validation, and Live Capture state. The bootstrap userscript wires those modules to Torn DOM and the Stage 1 API without moving authoritative state into the browser.

**Tech Stack:** Existing userscript/CommonJS modules, Tampermonkey/Greasemonkey APIs, Node 20 built-in tests, Stage 1 HTTPS JSON API.

**Spec:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

**Amendment:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-review-amendment.md`

## Global Constraints

- Do not capture/classify/upload Faction, Company, private, group-private, or unknown chats.
- Collector runs when ReviveRelay UI is closed, but only while Torn satisfies the active-use gate.
- Raw non-candidate public messages stay local and are not uploaded.
- Existing install path `torn-revive-chat-collector.user.js` remains valid; display name becomes ReviveRelay.
- Direct request UI offers Cash >= 500000 or Xanax >= 1 only, plus optional comment.
- Server is authoritative for identity, eligibility, timers and transaction state.

---

### Task 1: Fix message parse timing and make chat discovery policy-aware

**Files:**
- Modify: `src/chat-dom.js`
- Modify: `test/chat-dom.test.js`
- Modify: `torn-revive-chat-collector.user.js`

**Interfaces:**
- `findChatContexts(root, options?) -> context[]`
- `options.acceptChat(chat) -> boolean`

- [ ] **Step 1: Add a regression test for the React timing race**

Test a message node that initially has no parseable sender/body, then receives them. The first unsuccessful pass must not permanently mark the node seen.

- [ ] **Step 2: Run and verify RED against current behavior**

- [ ] **Step 3: Move `seenNodes.add(node)` after successful `parseMessage`**

Required order:

```js
if (state.seenNodes.has(node)) continue;
const record = parseMessage(node, chat);
if (!record) continue;
state.seenNodes.add(node);
await save(record);
```

- [ ] **Step 4: Add policy callback tests to chat discovery**

Assert discovered Faction/Company/private contexts are omitted when `acceptChat` rejects them.

- [ ] **Step 5: Implement and run tests**

Expected: existing discovery tests plus race/policy tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/chat-dom.js test/chat-dom.test.js torn-revive-chat-collector.user.js
git commit -m "fix(client): make chat parsing resilient and policy-aware"
```

---

### Task 2: Wire the shared public-channel allowlist into client discovery

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/build.js`
- Modify: `test/public-channels.test.js`
- Create: `test/client-privacy.test.js`

**Interfaces:**
- Uses `TornRevivePublicChannels.canonicalPublicChannel` from Stage 1.

- [ ] **Step 1: Write failing client privacy test**

Read userscript source and assert collection attaches through a function that calls public-channel policy before scanning. Use a small pure exported helper if necessary rather than brittle regex-only assertions.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Add `src/public-channels.js` as a userscript dependency**

Add `@require` pointing to the existing raw GitHub module and fail initialization if policy module is missing.

- [ ] **Step 4: Change discovery attachment**

Before `attachContext`, derive canonical channel from chat ID/header and accept only a positive allowlist match. Unknown is reject, never infer-private-as-public.

- [ ] **Step 5: Remove legacy Faction/Company/private collection language and stats assumptions**

Coverage counters should report only eligible public contexts.

- [ ] **Step 6: Run full client tests and commit**

```bash
npm test
npm run build
git add torn-revive-chat-collector.user.js scripts/build.js test/client-privacy.test.js
git commit -m "feat(client): restrict collection to public Torn chats"
```

---

### Task 3: Add deterministic local revive classifier

**Files:**
- Create: `src/revive-classifier.js`
- Create: `test/revive-classifier.test.js`
- Create: `test/fixtures/revive-messages.json`

**Interfaces:**
- `classifyReviveMessage({ text, channelType }) -> { candidate, score, reasons, version }`
- Classifier version begins `2.0.0`.

- [ ] **Step 1: Create failing fixture-driven tests**

Fixture examples must include positive:

```json
{"text":"need a revive please","channelType":"global","expected":true}
{"text":"rev? paying xan","channelType":"hospital","expected":true}
{"text":"can someone rev me 500k","channelType":"trade","expected":true}
```

and negative:

```json
{"text":"selling revives 1m","channelType":"trade","expected":false}
{"text":"my revive skill is 8","channelType":"global","expected":false}
{"text":"revive service recruiting","channelType":"global","expected":false}
```

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement weighted deterministic rules**

Use normalized tokens/phrases, request verbs/pronouns, revive terms, payment hints, Hospital context bonus, and strong advertisement/discussion negatives. Set a documented candidate threshold, initially `score >= 60`.

- [ ] **Step 4: Add terse-message regression cases**

Hospital `rev?` may qualify due channel context; Global `rev?` should require additional request/payment context unless corpus evidence later supports otherwise.

- [ ] **Step 5: Run tests and commit**

```bash
node --test test/revive-classifier.test.js
git add src/revive-classifier.js test/revive-classifier.test.js test/fixtures/revive-messages.json
git commit -m "feat(classifier): detect revive requests locally"
```

---

### Task 4: Build authenticated backend API client with retry-safe candidate queue

**Files:**
- Create: `src/api-client.js`
- Create: `test/api-client.test.js`
- Modify: `torn-revive-chat-collector.user.js`

**Interfaces:**
- `createApiClient({ baseUrl, getToken, request })`
- `api.bind(apiKey, clientVersion)`
- `api.submitCandidate(candidate)`
- `api.createRequest(payload)`
- `api.getActiveRequest()`
- `api.cancelRequest(id)`
- `api.getMe()`

- [ ] **Step 1: Write transport tests**

Use a fake `request` implementation. Assert Bearer token is present after binding; 401 maps to `AUTH_REQUIRED`; 409 maps to typed conflict; 429/5xx are retryable; 422 is not blindly retried.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement GM transport adapter**

Wrap `GM_xmlhttpRequest` in a Promise with JSON parsing, timeout and typed errors. Never log API keys or Bearer tokens.

- [ ] **Step 4: Add candidate outbox in IndexedDB/local storage model**

Candidate queue entries have `id`, candidate payload, `attempts`, `nextAttemptAt`. Successful server duplicate responses count as delivered and are removed. Exponential retry is capped (e.g. 5s, 15s, 30s, 60s) while Torn remains active; backend communication may resume when UI opens without causing Torn scraping.

- [ ] **Step 5: Run tests and commit**

```bash
node --test test/api-client.test.js
git add src/api-client.js test/api-client.test.js torn-revive-chat-collector.user.js
git commit -m "feat(client): add ReviveRelay backend transport"
```

---

### Task 5: Replace raw collector upload with candidate-only submission

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Create: `test/candidate-pipeline.test.js`

**Interfaces:**
- `handlePublicMessage(record) -> local event + optional candidate submission`

- [ ] **Step 1: Write failing pipeline tests**

Assert:

- public non-candidate produces local classification event but no upload;
- public candidate uploads minimal candidate schema;
- forbidden channel produces neither classification nor upload;
- candidate upload excludes raw page URL and legacy unrelated collector fields unless explicitly required by candidate schema.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement candidate pipeline**

Call public policy first, then classifier, then enqueue only candidates. Candidate payload includes canonical channel, sender ID/name, exact candidate text, source ID/timestamp when available, classifier version/score/reasons and first local capture timestamp.

- [ ] **Step 4: Run tests and commit**

```bash
node --test test/candidate-pipeline.test.js
git add torn-revive-chat-collector.user.js test/candidate-pipeline.test.js
git commit -m "feat(client): submit only revive candidates"
```

---

### Task 6: Rename product UI to ReviveRelay without breaking install continuity

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `scripts/build.js`
- Create: `test/metadata.test.js`

**Interfaces:**
- Existing install filename stays unchanged in Stage 2.
- Display metadata `@name ReviveRelay`.
- Version moves to `0.3.0` at first Phase 2 client release.

- [ ] **Step 1: Write failing metadata tests**

Assert display name is ReviveRelay, version constant matches metadata, and required modules are declared.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Update metadata/docs/package identity**

README must prominently state public-only collection and explicit exclusions.

- [ ] **Step 4: Run build/test and commit**

```bash
npm test
npm run build
git add torn-revive-chat-collector.user.js package.json README.md scripts/build.js test/metadata.test.js
git commit -m "feat: rename userscript to ReviveRelay"
```

---

### Task 7: Add onboarding and API-key/session setup

**Files:**
- Create: `src/onboarding.js`
- Create: `test/onboarding.test.js`
- Modify: `torn-revive-chat-collector.user.js`

**Interfaces:**
- `buildDisclosureModel() -> sections`
- `needsOnboarding(settings) -> boolean`

- [ ] **Step 1: Write disclosure tests**

Assert text model explicitly says:

- only supported public channels inspected;
- only likely revive candidates uploaded;
- Faction/Company/private never processed/uploaded;
- direct requests/reputation stored server-side by Torn ID;
- Torn API key scopes used for verification;
- Reviver Pro exists but requester functionality is free.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement onboarding modal**

Require explicit acknowledgement before enabling pooled candidate contribution/direct protected transactions. Bind API key through `/v1/auth/bind`, store only ReviveRelay session token locally after success, and offer an Options action to re-open disclosure.

- [ ] **Step 4: Run tests and commit**

```bash
node --test test/onboarding.test.js
git add src/onboarding.js test/onboarding.test.js torn-revive-chat-collector.user.js
git commit -m "feat(client): add transparent ReviveRelay onboarding"
```

---

### Task 8: Add Live Capture in-memory model and Options window

**Files:**
- Create: `src/live-capture.js`
- Create: `test/live-capture.test.js`
- Modify: `torn-revive-chat-collector.user.js`

**Interfaces:**
- `createLiveCaptureStore({ maxEntries: 200 })`
- `append(event)`
- `filter({ decision, channelType })`
- Event fields: local timestamp, public channel, text, candidate boolean, score, reasons, submission status.

- [ ] **Step 1: Write model tests**

Assert max 200 entries, filters work, clear only clears display history, and no setting controls the collector engine merely by opening/closing the window.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement store and UI**

Options gains **Live Capture** action. View shows current collection state, local queue, pool connectivity, recent public messages processed locally, score/reasons, and `NEW`, `DUPLICATE`, `PENDING`, `FAILED` submission results. Faction/Company/private filters do not exist.

- [ ] **Step 4: Verify closing/minimizing UI does not stop eligible collection**

Add test around state separation: `uiOpen=false` does not change `captureAllowed()`.

- [ ] **Step 5: Run tests and commit**

```bash
node --test test/live-capture.test.js
git add src/live-capture.js test/live-capture.test.js torn-revive-chat-collector.user.js
git commit -m "feat(ui): add ReviveRelay Live Capture"
```

---

### Task 9: Add pure direct-request form model and validation

**Files:**
- Create: `src/request-form.js`
- Create: `test/request-form.test.js`

**Interfaces:**
- `validateRequestForm({ method, amount, addComment, comment }) -> { ok, errors, payload }`

- [ ] **Step 1: Write form tests**

Cash 500000 accepted, lower rejected; Xanax 1 accepted, lower/fraction rejected; `free` and `other` rejected; comment omitted unless checkbox true; comment max 500 characters.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement minimal validator**

Client errors are friendly but server remains authoritative.

- [ ] **Step 4: Run and commit**

```bash
node --test test/request-form.test.js
git add src/request-form.js test/request-form.test.js
git commit -m "feat(requester): validate direct revive offers"
```

---

### Task 10: Add hospitalized-player Request Revive UI

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Create: `test/request-ui-state.test.js`

**Interfaces:**
- Request form uses `api.createRequest(payload)`.
- Local hospital detection is presentation convenience; server validates identity/state.

- [ ] **Step 1: Write request UI state tests**

Pure UI-state reducer covers hidden/non-hospitalized, eligible, submitting, active request, validation error, backend unavailable.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement Request Revive action**

When local Torn state indicates Hospital, show button. Form exactly offers Cash/Xanax plus optional comment checkbox. Show warning if a reliable local hospital countdown is <5 minutes, but do not block submission.

Display policy acknowledgement:

> After verified payment, the assigned reviver has up to 5 minutes to attempt the revive. If you leave Hospital yourself or your Hospital timer expires, payment is not refundable. If someone else revives you first, a refund is required.

- [ ] **Step 4: Submit and render active request state from server**

Do not post anything to Torn chat.

- [ ] **Step 5: Run tests and commit**

```bash
node --test test/request-ui-state.test.js
git add torn-revive-chat-collector.user.js test/request-ui-state.test.js
git commit -m "feat(requester): add direct Request Revive form"
```

---

### Task 11: Add requester status panel and server-derived countdown rendering

**Files:**
- Create: `src/request-status.js`
- Create: `test/request-status.test.js`
- Modify: `torn-revive-chat-collector.user.js`

**Interfaces:**
- `deriveCountdown({ serverNow, deadline }) -> secondsRemaining`
- `renderRequesterState(activeRequest)`

- [ ] **Step 1: Write countdown/state tests**

Client local clock skew must be corrected using server `Date`/`serverNow` supplied by API responses. Cover AVAILABLE, accepted/waiting payment, reconciling, payment verified/waiting revive, retry/refund/reportable/terminal labels even though Stage 3 will activate most transitions.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement server-time offset and status panel**

Poll own active request every 5 seconds only against ReviveRelay backend. This backend polling is independent from Torn DOM scraping rules and does not trigger Torn requests from the browser.

- [ ] **Step 4: Run tests and commit**

```bash
node --test test/request-status.test.js
git add src/request-status.js test/request-status.test.js torn-revive-chat-collector.user.js
git commit -m "feat(requester): show authoritative request status"
```

---

### Task 12: Stage 2 privacy/build regression gate

**Files:**
- Create: `test/stage2-privacy-gate.test.js`
- Modify: `.github/workflows/test.yml`

**Interfaces:** None new.

- [ ] **Step 1: Add static/dynamic privacy gate tests**

Assert client public policy is imported; forbidden channel fixtures never reach classifier; candidate submit path receives only a canonical public channel object.

- [ ] **Step 2: Run full suite**

```bash
npm test
npm run build
node --check torn-revive-chat-collector.user.js
node --check src/public-channels.js
node --check src/revive-classifier.js
node --check src/api-client.js
```

Expected: all PASS.

- [ ] **Step 3: Manual staging smoke checklist**

With a Stage 1 test backend:

1. open Global and confirm local classification events;
2. open Faction and Company and confirm zero Live Capture/classification entries;
3. open one private chat and confirm zero entries;
4. submit a direct request from a test hospitalized state without sending Torn chat;
5. minimize/close Live Capture and verify public capture continues while Torn is actively used;
6. background Torn and verify Torn collection pauses.

- [ ] **Step 4: Commit**

```bash
git add test/stage2-privacy-gate.test.js .github/workflows/test.yml
git commit -m "test(stage2): lock ReviveRelay client privacy boundary"
```

## Stage 2 completion gate

- Existing collector regression tests remain green.
- No Faction/Company/private/unknown content is parsed by the candidate pipeline.
- Non-candidate public messages are never uploaded.
- Live Capture can be closed without disabling eligible foreground collection.
- Direct Request Revive never posts to Torn chat.
- Server-derived status/timers render correctly under client clock skew.
