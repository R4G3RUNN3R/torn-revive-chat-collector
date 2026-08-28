# ReviveRelay Always-On Auto-Debug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate an always-on, privacy-bounded Auto-Debug subsystem into the browser-proven ReviveRelay client, add strict server-side diagnostic ingestion/storage/retention, and prove the result through staged real-Torn browser control gates without changing the automatic release channel until all gates pass.

**Architecture:** Preserve the ten browser-proven 0.4.2 support modules byte-for-byte, reconcile only the accepted 0.4.5 shared-feed delta, then prove self-contained packaging and `document-start` separately. After those controls pass, add new isolated Auto-Debug modules: an earliest-possible passive WebSocket observer, a pure sanitizer/parser, a bounded uploader/outbox, and a separate Debug Console. Server diagnostics use a dedicated `/v1/telemetry/debug` contract, dedicated aggregate/occurrence tables, dual client/server sanitization, per-user-or-IP rate limits, and the existing daily retention worker extended to purge detailed diagnostic occurrences after 30 days.

**Tech Stack:** Tampermonkey userscript, vanilla JavaScript, Node.js 20, Node test runner, Fastify 5, `@fastify/rate-limit` 10.3.0, Zod, PostgreSQL 16, Docker Compose, Caddy, SentinelX.

**Spec:** `docs/superpowers/specs/2026-08-28-reviverelay-always-on-auto-debug-design.md`

## Global Constraints

- Server baseline is current `main` at `b9c8017cc95d612ebe03a578040d00f56f7580eb` unless newer unrelated commits are explicitly reviewed before execution.
- Browser-proven client baseline is diagnostic `0.4.5-from-0.4.2`, derived from `90dc48071f7fa65e2baa156159b6e969659ac125`.
- Browser-proven artifact SHA-256 is `fbfc6a27395b5d3cfa7bd0b3ebcab96e4be856d71d9772881e127eebb848fee9`.
- Preserve these exact support-module SHA-256 hashes through the first integrated Auto-Debug diagnostic release:
  - `src/core.js` `d3de50932244fc6c8acbc48c4243e7fb7158b456e6f3943daee530100f539147`
  - `src/chat-dom.js` `5decc73d73a46f1aa926d00ed898f18f246a28b76533a56af7dd133f1651bcd6`
  - `src/public-channels.js` `0abc56e7506bcd235a771957f63fe76953065d2c7a37e02600ea8bc3c8a50a88`
  - `src/client-chat-policy.js` `2235c3cd14b29ab5137fb4a050b89f6c79a5736133f0d8c601e426d6d3df5bd5`
  - `src/api-client.js` `9660f1dad2dc20ed227330710aaf51c251ce44cbe28456eeb08b8776ff2e75b6`
  - `src/versioning.js` `ffe8f8342d38c2588e36c17c1c2cd78f37b2e91f09544b5cd8c07d21e8b4c2ed`
  - `src/update-manager.js` `3b9ba77a38d5c5a53b031130de0dd59eab3088e44fc1274fbe3a6e9ea7fbb3a8`
  - `src/telemetry-client.js` `8f746f2e8c28eeab9d74bb08918a684e72677106850a40b27f1974d05b4c60ad`
  - `src/revive-classifier.js` `5a2e27c74599b4f75a84699213b8a0269dd7f8ed3a92d73e80ecae49f5fc5014`
  - `src/candidate-pipeline.js` `a224d2741108e3876c66d635806b2bf4f7a5f4af65386baaca92fbb965a24a3e`
- Do not add Auto-Debug methods to `src/api-client.js` during this implementation; use a supplied GM-request callback so its proven hash remains unchanged.
- Do not modify the existing candidate privacy allowlist, classifier behavior, protected marketplace rules, or `PAID_TIER_ENABLED=false`.
- Raw WebSocket frames, normal chat text, private/faction/company text, cookies, authorization headers, session tokens, API keys, verification keys, request bodies, and WebSocket query strings must be structurally impossible to persist through Auto-Debug.
- Content-sensitive transport parsing is permitted only while Torn is visible, focused, not paused, and within the existing 60-second recent-interaction window. Outside that gate, only coarse transport-health counters may update.
- Detailed diagnostic occurrences are retained for exactly 30 days; aggregate diagnostic groups remain.
- Debug outbox limit is 100 already-sanitized events; event TTL is 24 hours; batch size is 20.
- Debug retry delays are exactly `5s, 15s, 30s, 60s`, then capped at `300s` for subsequent retries.
- Debug route body limit is exactly 64 KiB.
- Debug route rate limits are 30 requests per five minutes per authenticated internal ReviveRelay user UUID and 10 requests per five minutes per anonymous trusted-proxy source IP.
- The automatic userscript channel must remain unchanged until Control B, Control C, integrated Auto-Debug, server receipt, Debug Console, and minimized-Hospital marker gates all pass.
- Keep the known-good 0.4.5 rollback artifact and route available throughout implementation.
- All DB tests run against a disposable ReviveRelay test database inside the private Docker network, never against the production ReviveRelay database.
- No ReviveRelay work may access or modify DungeonMasterOS, Nexis, CIEL, website, or other Voidsmith product databases.

## File Structure and Responsibilities

### Existing files intentionally preserved byte-for-byte

The ten support modules listed in Global Constraints remain unchanged. Any test that detects a hash change is a hard stop.

### New client modules

- `src/transport-observer.js`
  - self-contained earliest-executing module;
  - installs exactly one passive `window.WebSocket` wrapper immediately when the module is evaluated;
  - has no dependency on the ten existing support modules;
  - retains only sanitized endpoint metadata and coarse counters before later configuration;
  - never stores raw frame bodies.
- `src/auto-debug-core.js`
  - pure endpoint sanitizer, size bucketing, bounded frame decoding, Socket.IO-style envelope parsing, channel-class collapse, synthetic-marker path extraction, and client-side strict event sanitization.
- `src/auto-debug-client.js`
  - 60-second aggregation/heartbeat, 100-event/24-hour persisted outbox, 20-event batches, exact retry schedule, uploader state, and marker lifecycle.
- `src/debug-console.js`
  - separate draggable/minimizable Debug Console rendering only sanitized snapshots and safe reports.

### New client tests

- `test/browser-proven-baseline.test.js`
- `test/bootstrap-controls.test.js`
- `test/transport-observer.test.js`
- `test/auto-debug-core.test.js`
- `test/auto-debug-client.test.js`
- `test/auto-debug-integration.test.js`
- `test/debug-console.test.js`

### New server files

- `server/src/db/migrations/005_auto_debug.sql`
- `server/src/db/diagnostic-telemetry.js`
- `server/src/telemetry/debug-contract.js`
- `server/src/telemetry/debug-fingerprint.js`
- `server/src/routes/debug-telemetry.js`

### New server tests

- `server/test/db/diagnostic-telemetry.test.js`
- `server/test/telemetry/debug-contract.test.js`
- `server/test/telemetry/debug-fingerprint.test.js`
- `server/test/routes/debug-telemetry.test.js`
- `server/test/security/debug-telemetry-rate-limit.test.js`

### Existing files modified later

- `torn-revive-chat-collector.user.js`
  - reconcile accepted 0.4.5 body;
  - later change to `document-start`;
  - integrate always-on error telemetry, Auto-Debug configuration, Settings Diagnostics card, and Debug Console button.
- `scripts/build.js`
  - preserve the original ten-module order;
  - later prepend `src/transport-observer.js` as the first executable bundled module and append the three new Auto-Debug support modules.
- `package.json`
  - diagnostic control versions only: `0.4.6` for Control B, `0.4.7` for Control C, `0.4.8` for integrated Auto-Debug.
- `server/src/app.js`
  - accept/register diagnostic telemetry repository and route.
- `server/src/server.js`
  - create diagnostic repository and pass it to the app.
- `server/src/worker.js`
  - create diagnostic repository and pass it to the retention handler.
- `server/src/worker/telemetry-retention.js`
  - purge both error and diagnostic detailed occurrences.
- related tests in `test/release-*.test.js`, `test/panel-ui.test.js`, `test/telemetry-integration.test.js`, `server/test/worker/telemetry-retention.test.js`, and `server/test/worker/handlers.test.js`.

---

### Task 1: Freeze the exact browser-proven 0.4.5 artifact as a repository fixture

**Files:**
- Create: `test/fixtures/client/reviverelay-0.4.5-from-0.4.2.user.js`
- Create: `test/fixtures/client/reviverelay-0.4.5-baseline.json`
- Create: `test/browser-proven-baseline.test.js`

**Interfaces:**
- Consumes: immutable deployed diagnostic `/srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.5-from-0.4.2.user.js`.
- Produces: a committed byte-for-byte browser-proven fixture and `BASELINE_SUPPORT_HASHES` regression contract used by later control tests.

- [ ] **Step 1: Write the failing baseline-fixture test**

Create `test/browser-proven-baseline.test.js` with assertions equivalent to:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const fixturePath = path.resolve(__dirname, 'fixtures/client/reviverelay-0.4.5-from-0.4.2.user.js');
const manifestPath = path.resolve(__dirname, 'fixtures/client/reviverelay-0.4.5-baseline.json');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('browser-proven 0.4.5 artifact remains byte-for-byte frozen', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(sha256(fixturePath), 'fbfc6a27395b5d3cfa7bd0b3ebcab96e4be856d71d9772881e127eebb848fee9');
  assert.equal(manifest.artifactSha256, 'fbfc6a27395b5d3cfa7bd0b3ebcab96e4be856d71d9772881e127eebb848fee9');
  const text = fs.readFileSync(fixturePath, 'utf8');
  assert.match(text, /@version\s+0\.4\.5/);
  assert.match(text, /Shared public chat requests/);
  assert.match(text, /fetchRecentPublicCandidates/);
});
```

Add a second test that hashes the ten current files against the exact values in Global Constraints after Task 2 restores them.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test test/browser-proven-baseline.test.js
```

Expected: FAIL with `ENOENT` for the missing fixture or baseline manifest.

- [ ] **Step 3: Copy the exact accepted artifact and write its manifest**

Run:

```bash
mkdir -p test/fixtures/client
cp /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.5-from-0.4.2.user.js \
  test/fixtures/client/reviverelay-0.4.5-from-0.4.2.user.js
```

Create `test/fixtures/client/reviverelay-0.4.5-baseline.json` exactly as:

```json
{
  "version": "0.4.5",
  "derivedFromCommit": "90dc48071f7fa65e2baa156159b6e969659ac125",
  "artifactSha256": "fbfc6a27395b5d3cfa7bd0b3ebcab96e4be856d71d9772881e127eebb848fee9",
  "supportHashes": {
    "src/core.js": "d3de50932244fc6c8acbc48c4243e7fb7158b456e6f3943daee530100f539147",
    "src/chat-dom.js": "5decc73d73a46f1aa926d00ed898f18f246a28b76533a56af7dd133f1651bcd6",
    "src/public-channels.js": "0abc56e7506bcd235a771957f63fe76953065d2c7a37e02600ea8bc3c8a50a88",
    "src/client-chat-policy.js": "2235c3cd14b29ab5137fb4a050b89f6c79a5736133f0d8c601e426d6d3df5bd5",
    "src/api-client.js": "9660f1dad2dc20ed227330710aaf51c251ce44cbe28456eeb08b8776ff2e75b6",
    "src/versioning.js": "ffe8f8342d38c2588e36c17c1c2cd78f37b2e91f09544b5cd8c07d21e8b4c2ed",
    "src/update-manager.js": "3b9ba77a38d5c5a53b031130de0dd59eab3088e44fc1274fbe3a6e9ea7fbb3a8",
    "src/telemetry-client.js": "8f746f2e8c28eeab9d74bb08918a684e72677106850a40b27f1974d05b4c60ad",
    "src/revive-classifier.js": "5a2e27c74599b4f75a84699213b8a0269dd7f8ed3a92d73e80ecae49f5fc5014",
    "src/candidate-pipeline.js": "a224d2741108e3876c66d635806b2bf4f7a5f4af65386baaca92fbb965a24a3e"
  }
}
```

- [ ] **Step 4: Verify fixture hash before allowing the test to pass**

Run:

```bash
sha256sum test/fixtures/client/reviverelay-0.4.5-from-0.4.2.user.js
node --test test/browser-proven-baseline.test.js
```

Expected SHA: `fbfc6a27395b5d3cfa7bd0b3ebcab96e4be856d71d9772881e127eebb848fee9`.
Expected tests: PASS.

- [ ] **Step 5: Commit the frozen baseline**

```bash
git add test/fixtures/client/reviverelay-0.4.5-from-0.4.2.user.js \
  test/fixtures/client/reviverelay-0.4.5-baseline.json \
  test/browser-proven-baseline.test.js
git commit -m "test: freeze browser-proven ReviveRelay 0.4.5 baseline"
```

---

### Task 2: Reconcile current server `main` with the exact accepted 0.4.5 client source

**Files:**
- Modify: `src/core.js`
- Modify: `src/chat-dom.js`
- Modify: `src/public-channels.js`
- Modify: `src/client-chat-policy.js`
- Modify: `src/api-client.js`
- Modify: `src/versioning.js`
- Modify: `src/update-manager.js`
- Modify: `src/telemetry-client.js`
- Modify: `src/revive-classifier.js`
- Modify: `src/candidate-pipeline.js`
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `package.json`
- Create/Modify: `test/bootstrap-controls.test.js`

**Interfaces:**
- Consumes: frozen Task 1 fixture, commit `90dc480...`, accepted worktree `.worktrees/fix-shared-feed-from-042`.
- Produces: canonical `0.4.5` source tree whose ten support modules match the browser-proven hashes and whose application body contains only the accepted shared-feed delta while retaining current server code from `main`.

- [ ] **Step 1: Write RED tests for the ten support hashes and accepted 0.4.5 application behavior**

Create `test/bootstrap-controls.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const manifest = require('./fixtures/client/reviverelay-0.4.5-baseline.json');

function sha(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

for (const [relativePath, expected] of Object.entries(manifest.supportHashes)) {
  test(`known-good support bytes stay locked: ${relativePath}`, () => {
    assert.equal(sha(relativePath), expected);
  });
}

test('canonical source carries the accepted shared-feed delta only in the main userscript', () => {
  const source = fs.readFileSync('torn-revive-chat-collector.user.js', 'utf8');
  assert.match(source, /async function fetchRecentPublicCandidates\(/);
  assert.match(source, /\/v1\/candidates\/recent/);
  assert.match(source, /Shared public chat requests/);
  assert.match(source, /ReviveRelayApiClient\.createGmRequestAdapter\(GM_xmlhttpRequest\)/);
  assert.match(source, /@run-at\s+document-idle/);
});
```

- [ ] **Step 2: Run the control test and verify RED on current `main` client bytes**

```bash
node --test test/bootstrap-controls.test.js
```

Expected: at least one hash assertion fails because current `main` contains the 0.4.4 client tree.

- [ ] **Step 3: Restore exactly the ten support modules from `90dc480...`**

```bash
git checkout 90dc48071f7fa65e2baa156159b6e969659ac125 -- \
  src/core.js src/chat-dom.js src/public-channels.js src/client-chat-policy.js \
  src/api-client.js src/versioning.js src/update-manager.js src/telemetry-client.js \
  src/revive-classifier.js src/candidate-pipeline.js
```

Do not alter those files afterward in this implementation.

- [ ] **Step 4: Reconcile the accepted 0.4.5 userscript body into the self-contained source template**

Start from `.worktrees/fix-shared-feed-from-042/torn-revive-chat-collector.user.js` and make only these metadata adaptations required by current build tooling:

```text
REMOVE: all ten `// @require ...` lines
ADD:    `// ReviveRelay-Build-Commit: __REVIVERELAY_GIT_COMMIT__`
KEEP:   `// @run-at       document-idle`
KEEP:   the accepted 0.4.5 application body byte-for-byte below `// ==/UserScript==`
```

Set `package.json` version to `0.4.5`.

- [ ] **Step 5: Run focused and full client tests**

```bash
node --test test/browser-proven-baseline.test.js test/bootstrap-controls.test.js
npm run test:client
```

Expected: all support hashes pass and full client suite is green.

- [ ] **Step 6: Prove no server source was changed by the client reconciliation**

```bash
git diff --name-only HEAD -- server/
```

Expected: no output.

- [ ] **Step 7: Commit the canonical source reconciliation**

```bash
git add package.json torn-revive-chat-collector.user.js src test/bootstrap-controls.test.js
git commit -m "fix: reconcile ReviveRelay 0.4.5 browser-proven client"
```

---

### Task 3: Control B, prove exact-module self-contained packaging in real Torn

**Files:**
- Modify: `package.json`
- Modify: `test/bootstrap-controls.test.js`
- Generated: `dist/reviverelay-manual.user.js`
- Deploy copy: `/srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.6-control-b.user.js`
- Modify outside repo: `/etc/caddy/Caddyfile`

**Interfaces:**
- Consumes: Task 2 exact-module source and current `scripts/build.js` self-contained bundler.
- Produces: manual diagnostic `0.4.6` with exactly ten embedded known-good modules, zero runtime `@require`, `document-idle`, no Auto-Debug, no WebSocket interception.

- [ ] **Step 1: Extend the control test for Control B invariants**

Add assertions:

```js
test('Control B build is self-contained, document-idle, and contains no transport observer', () => {
  const built = fs.readFileSync('dist/reviverelay-manual.user.js', 'utf8');
  assert.equal((built.match(/^\/\/ @require\s+/gm) || []).length, 0);
  assert.match(built, /@run-at\s+document-idle/);
  assert.doesNotMatch(built, /ReviveRelayTransportObserver|transport_hook_anomaly|\/v1\/telemetry\/debug/);
  for (const relativePath of Object.keys(manifest.supportHashes)) {
    assert.equal(built.split(`/* ReviveRelay bundled module: ${relativePath} */`).length - 1, 1);
  }
});
```

- [ ] **Step 2: Verify RED before building the new diagnostic version**

Set `package.json` to `0.4.6`, then run:

```bash
node --test test/bootstrap-controls.test.js
```

Expected: FAIL if `dist` still contains a stale earlier artifact, proving the test is observing generated output.

- [ ] **Step 3: Build and verify Control B**

```bash
npm run build
node --test test/bootstrap-controls.test.js test/release-build.test.js test/release-pinning.test.js
node --check dist/reviverelay-manual.user.js
```

Expected: PASS. `@version` is `0.4.6`, `@run-at` is `document-idle`, zero `@require` rows.

- [ ] **Step 4: Copy the exact tested manual artifact into immutable diagnostics storage**

```bash
cp dist/reviverelay-manual.user.js \
  /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.6-control-b.user.js
sha256sum dist/reviverelay-manual.user.js \
  /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.6-control-b.user.js
```

Expected: both SHA-256 values are identical.

- [ ] **Step 5: Add an explicit no-store Caddy route without touching the automatic install routes**

Back up `/etc/caddy/Caddyfile`:

```bash
cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.pre-reviverelay-control-b-$(date -u +%Y%m%dT%H%M%SZ)"
```

Insert this exact block before the site's final catch-all `handle`:

```caddy
@diagControlB path /diagnostic/reviverelay-0.4.6-control-b.user.js
handle @diagControlB {
    rewrite * /reviverelay-0.4.6-control-b.user.js
    root * /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic
    header Cache-Control "no-store"
    file_server
}
```

Validate, reload, and verify:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -fsSI https://reviverelay.voidsmithindustries.com/diagnostic/reviverelay-0.4.6-control-b.user.js
curl -fsS https://reviverelay.voidsmithindustries.com/diagnostic/reviverelay-0.4.6-control-b.user.js | sha256sum
sha256sum /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.6-control-b.user.js
```

Expected: HTTP 200, `Cache-Control: no-store`, and identical SHA-256 values.

- [ ] **Step 6: Commit only the source version/control-test change**

```bash
git add package.json test/bootstrap-controls.test.js
git commit -m "test: prepare ReviveRelay self-contained control B"
```

- [ ] **Step 7: Mandatory human browser gate B**

Install only:

`https://reviverelay.voidsmithindustries.com/diagnostic/reviverelay-0.4.6-control-b.user.js`

The user must explicitly confirm all three:

```text
PANEL APPEARS: YES
REVIVER SHARED PUBLIC FEED WORKS: YES
NORMAL REQUEST/SETTINGS UI WORKS: YES
```

Do not continue to Task 4 until that confirmation exists in the conversation.

---

### Task 4: Control C, move only execution timing to `document-start`

**Files:**
- Modify: `package.json`
- Modify: `torn-revive-chat-collector.user.js:1-20`
- Modify: `test/bootstrap-controls.test.js`
- Generated/deploy: `reviverelay-0.4.7-control-c.user.js`
- Modify outside repo: `/etc/caddy/Caddyfile`

**Interfaces:**
- Consumes: browser-approved Control B source.
- Produces: same exact application/support bytes with `@run-at document-start`; normal `init()` remains deferred by the existing `DOMContentLoaded` guard at the bottom of the userscript.

- [ ] **Step 1: Write the RED Control C test**

Add:

```js
test('Control C runs at document-start while normal app init remains DOM-ready deferred', () => {
  const source = fs.readFileSync('torn-revive-chat-collector.user.js', 'utf8');
  assert.match(source, /@run-at\s+document-start/);
  assert.match(source, /if \(document\.readyState === 'loading'\) document\.addEventListener\('DOMContentLoaded', init, \{ once: true \}\);/);
  assert.doesNotMatch(source, /ReviveRelayTransportObserver|\/v1\/telemetry\/debug/);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test test/bootstrap-controls.test.js
```

Expected: FAIL because metadata still says `document-idle`.

- [ ] **Step 3: Make the minimal timing-only change**

Change only:

```diff
-// @run-at       document-idle
+// @run-at       document-start
```

Set package version to `0.4.7`.

Do not add a WebSocket hook and do not refactor `init()`.

- [ ] **Step 4: Verify source/body and support-module preservation**

```bash
npm run build
node --test test/bootstrap-controls.test.js test/browser-proven-baseline.test.js test/panel-ui.test.js
npm run test:client
```

Expected: all green; ten support hashes still exact.

- [ ] **Step 5: Publish only the manual Control C diagnostic**

Copy and hash the artifact:

```bash
cp dist/reviverelay-manual.user.js \
  /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.7-control-c.user.js
sha256sum dist/reviverelay-manual.user.js \
  /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.7-control-c.user.js
```

Back up Caddy and insert this exact block before the final catch-all `handle`:

```caddy
@diagControlC path /diagnostic/reviverelay-0.4.7-control-c.user.js
handle @diagControlC {
    rewrite * /reviverelay-0.4.7-control-c.user.js
    root * /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic
    header Cache-Control "no-store"
    file_server
}
```

Then run:

```bash
cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.pre-reviverelay-control-c-$(date -u +%Y%m%dT%H%M%SZ)"
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -fsS https://reviverelay.voidsmithindustries.com/diagnostic/reviverelay-0.4.7-control-c.user.js | sha256sum
sha256sum /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.7-control-c.user.js
```

Expected: public and local SHA-256 values are identical.

- [ ] **Step 6: Commit**

```bash
git add package.json torn-revive-chat-collector.user.js test/bootstrap-controls.test.js
git commit -m "test: prove ReviveRelay document-start control C"
```

- [ ] **Step 7: Mandatory human browser gate C**

The user must explicitly confirm:

```text
PANEL APPEARS: YES
REVIVER SHARED PUBLIC FEED WORKS: YES
NORMAL REQUEST/SETTINGS UI WORKS: YES
```

Do not continue to transport integration until this gate passes.

---

### Task 5: Add dedicated diagnostic telemetry tables and repository

**Files:**
- Create: `server/src/db/migrations/005_auto_debug.sql`
- Create: `server/src/db/diagnostic-telemetry.js`
- Create: `server/test/db/diagnostic-telemetry.test.js`
- Modify: `server/test/db/migrations.test.js`

**Interfaces:**
- Consumes: PostgreSQL pool with `.query()` and `.connect()`.
- Produces:
  - `createDiagnosticTelemetryRepository(pool)`
  - `recordOccurrence(envelope) -> Promise<{ groupId }>`
  - `purgeOccurrences(before: Date) -> Promise<number>`
  - `getGroup(groupId) -> Promise<object|null>` for tests/operator validation.

- [ ] **Step 1: Write RED migration/repository tests**

Test the exact schema and upsert behavior:

```js
const { withDisposableDatabase } = require('../test-support/database');
const { createDiagnosticTelemetryRepository } = require('../../src/db/diagnostic-telemetry');

test('diagnostic occurrences aggregate by stable fingerprint and retain sanitized context only', async () => {
  await withDisposableDatabase('rr_diag', async pool => {
    const repo = createDiagnosticTelemetryRepository(pool);
    const base = {
      fingerprint: 'a'.repeat(64),
      eventType: 'transport_summary',
      summaryCode: 'transport_summary:torn',
      version: '0.4.8',
      buildCommit: 'b'.repeat(40),
      userId: null,
      context: { hookActive: true, tornSocketCount: 1 },
      occurredAt: new Date('2026-08-28T12:00:00Z')
    };
    const first = await repo.recordOccurrence(base);
    const second = await repo.recordOccurrence({ ...base, occurredAt: new Date('2026-08-28T12:01:00Z') });
    assert.equal(first.groupId, second.groupId);
    const group = await repo.getGroup(first.groupId);
    assert.equal(group.occurrenceCount, 2);
  });
});
```

Add a concurrency test using `Promise.all` with the same fingerprint and assert exactly one `diagnostic_event_groups` row.

- [ ] **Step 2: Run and verify RED**

Run the new DB test in the disposable private-network test DB environment.
Expected: FAIL because migration/table/repository do not exist.

- [ ] **Step 3: Add migration `005_auto_debug.sql`**

Create exactly these logical fields:

```sql
CREATE TABLE diagnostic_event_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  event_type text NOT NULL,
  summary_code text NOT NULL,
  first_version text,
  last_version text,
  last_build_commit text,
  occurrence_count bigint NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE diagnostic_event_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnostic_event_group_id uuid NOT NULL REFERENCES diagnostic_event_groups(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  version text,
  build_commit text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX diagnostic_event_occurrences_group_received
  ON diagnostic_event_occurrences (diagnostic_event_group_id, received_at);
CREATE INDEX diagnostic_event_occurrences_user_received
  ON diagnostic_event_occurrences (user_id, received_at)
  WHERE user_id IS NOT NULL;
CREATE INDEX diagnostic_event_groups_type_last_seen
  ON diagnostic_event_groups (event_type, last_seen_at DESC);
```

- [ ] **Step 4: Implement repository upsert transaction**

Use the same transactional `INSERT ... ON CONFLICT (fingerprint) DO UPDATE` pattern as `server/src/db/error-telemetry.js`, but do not add message/stack/raw-body columns.

- [ ] **Step 5: Run DB tests and migration idempotence tests**

Expected: new tests PASS; existing migration tests remain PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/migrations/005_auto_debug.sql \
  server/src/db/diagnostic-telemetry.js \
  server/test/db/diagnostic-telemetry.test.js \
  server/test/db/migrations.test.js
git commit -m "feat: add ReviveRelay diagnostic telemetry storage"
```

---

### Task 6: Define the strict server debug contract, sanitization, and fingerprinting

**Files:**
- Create: `server/src/telemetry/debug-contract.js`
- Create: `server/src/telemetry/debug-fingerprint.js`
- Create: `server/test/telemetry/debug-contract.test.js`
- Create: `server/test/telemetry/debug-fingerprint.test.js`

**Interfaces:**
- Produces:
  - `DEBUG_EVENT_TYPES: Set<string>`
  - `parseDebugBatch(input) -> { success, data|error }`
  - `sanitizeDebugEvent(input) -> sanitized event`
  - `fingerprintDebugEvent(event) -> 64-hex string`
  - `summaryCodeForDebugEvent(event) -> stable string`

**Canonical client/server envelope:**

```js
{
  eventType: 'transport_summary',
  version: '0.4.8',
  buildCommit: '40-hex-when-present',
  context: { /* strict per-event fields only */ },
  occurredAt: '2026-08-28T12:00:00.000Z'
}
```

**Strict event contexts:**

```js
client_bootstrap: {
  phase: 'observer_install'|'application_scheduled'|'application_started'|'application_ready',
  hookActive: boolean,
  visibilityState: 'visible'|'hidden'|'prerender'|'unknown',
  focused: boolean
}

transport_summary: {
  hookActive: boolean,
  socketCount: integer >= 0,
  tornSocketCount: integer >= 0,
  textFrames: integer >= 0,
  binaryFrames: integer >= 0,
  sizeTiny: integer >= 0,
  sizeSmall: integer >= 0,
  sizeMedium: integer >= 0,
  oversizeFrames: integer >= 0,
  parsedEnvelopes: integer >= 0,
  parseFailures: integer >= 0,
  socketHost?: string <= 160,
  socketPath?: string <= 160,
  socketClass: 'torn'|'non_torn'|'unknown',
  visibilityState: 'visible'|'hidden'|'prerender'|'unknown',
  focused: boolean
}

transport_hook_anomaly: {
  anomalyCode: 'install_failed'|'wrapper_replaced'|'socket_before_hook',
  hookActive: boolean
}

public_chat_structure: {
  eventName?: string <= 80 matching /^[A-Za-z0-9_.:-]+$/,
  channelClass: one exact allowlisted public ID or 'public_other_allowlisted'|'forbidden_or_nonpublic'|'unknown',
  hospitalIdentified: boolean
}

synthetic_marker_hit: {
  markerHit: true,
  eventName?: string <= 80 matching /^[A-Za-z0-9_.:-]+$/,
  channelClass: same enum as public_chat_structure,
  hospitalIdentified: boolean,
  markerPaths: array of 1..8 strings, each <= 160
}

dom_collector_summary: {
  openChats: integer >= 0,
  chatListItems: integer >= 0,
  candidateQueueDepth: integer >= 0,
  visibilityState: 'visible'|'hidden'|'prerender'|'unknown',
  focused: boolean
}

api_health_summary: {
  statusClass: '2xx'|'4xx'|'5xx'|'network'|'unknown',
  routeClass: 'health'|'debug_telemetry'|'other_reviverelay'
}

debug_uploader_state: {
  queueDepth: integer 0..100,
  droppedCount: integer >= 0,
  consecutiveFailures: integer >= 0,
  lastResultCode: 'accepted'|'rate_limited'|'auth_required'|'invalid'|'server_unavailable'|'network'|'none'
}
```

- [ ] **Step 1: Write RED contract tests**

Cover valid examples for all eight event types and explicit rejection of:

```js
{ userId: 'forged' }
{ context: { rawFrame: '42["message",...]' } }
{ context: { message: 'rev me' } }
{ context: { authorization: 'Bearer secret' } }
{ eventType: 'made_up_event' }
```

- [ ] **Step 2: Write RED fingerprint tests**

Assert same fingerprint across different user IDs, timestamps, random marker values, and version when the stable technical shape is identical; assert different fingerprint for different `eventType`, anomaly code, socket host/path template, or public-channel class.

- [ ] **Step 3: Run RED**

```bash
node --test server/test/telemetry/debug-contract.test.js server/test/telemetry/debug-fingerprint.test.js
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement strict schemas and second-pass sanitization**

Use Zod `.strict()` schemas keyed by `eventType`. Sanitize endpoint strings by constructing `new URL(value)` only when needed, retaining hostname + pathname and removing query/hash/userinfo. Redact token-like text before truncation and once again after serialization, mirroring the existing defensive telemetry sanitizer pattern.

- [ ] **Step 5: Implement stable fingerprint**

Hash a JSON object containing only:

```js
{
  eventType,
  summaryCode,
  socketHost,
  socketPath,
  socketClass,
  anomalyCode,
  eventName,
  channelClass,
  hospitalIdentified
}
```

Exclude timestamp, build commit, version, counts, queue depths, markerPaths, marker value, and user identity.

- [ ] **Step 6: Run GREEN and commit**

```bash
node --test server/test/telemetry/debug-contract.test.js server/test/telemetry/debug-fingerprint.test.js
git add server/src/telemetry/debug-contract.js server/src/telemetry/debug-fingerprint.js \
  server/test/telemetry/debug-contract.test.js server/test/telemetry/debug-fingerprint.test.js
git commit -m "feat: define strict ReviveRelay debug telemetry contract"
```

---

### Task 7: Add `/v1/telemetry/debug` with auth-aware rate limits and 64 KiB body cap

**Files:**
- Create: `server/src/routes/debug-telemetry.js`
- Create: `server/test/routes/debug-telemetry.test.js`
- Create: `server/test/security/debug-telemetry-rate-limit.test.js`
- Modify later in Task 8: `server/src/app.js`

**Interfaces:**
- Consumes: `diagnosticTelemetryRepository.recordOccurrence`, `parseDebugBatch`, `sanitizeDebugEvent`, `fingerprintDebugEvent`, `summaryCodeForDebugEvent`.
- Produces: `registerDebugTelemetryRoutes(app, { diagnosticTelemetryRepository })`.

- [ ] **Step 1: Write RED route tests for anonymous and authenticated attribution**

Test these cases:

```text
POST /v1/telemetry/debug without Authorization + valid event => 202
POST /v1/telemetry/debug with valid ReviveRelay bearer => 202 and repository userId is server-derived internal UUID
POST with invalid bearer => 401 and repository is not called
POST with client userId/rawFrame/message key => 422
POST with 21 events => 422
POST with >64 KiB body => 413
repository failure => bounded 503 {error:"DEBUG_TELEMETRY_UNAVAILABLE"}
```

- [ ] **Step 2: Write RED rate-limit test proving NAT-safe authenticated keys**

Use the same `x-forwarded-for` IP for two authenticated users. Assert each can make 30 requests independently. Assert the 31st for user A is 429 while user B still succeeds. Separately assert anonymous requests from one IP are capped at 10 per five minutes.

- [ ] **Step 3: Run RED**

Expected: route module missing.

- [ ] **Step 4: Implement auth-then-rate-limit preHandler ordering**

Use the already-registered `@fastify/rate-limit` decoration and this route pattern:

```js
const authenticateIfPresented = async (request, reply) => {
  if (!request.headers.authorization || typeof app.authenticate !== 'function') return;
  return app.authenticate(request, reply);
};

const debugRateLimit = app.rateLimit({
  max: request => request.reviveRelayUser ? 30 : 10,
  timeWindow: '5 minutes',
  groupId: 'debug-telemetry',
  keyGenerator: request => request.reviveRelayUser
    ? `user:${request.reviveRelayUser.userId}`
    : `ip:${request.ip}`
});

app.post('/v1/telemetry/debug', {
  bodyLimit: 64 * 1024,
  preHandler: [authenticateIfPresented, debugRateLimit]
}, handler);
```

This ordering is mandatory because the rate-limit key must use the authenticated internal UUID when available.

- [ ] **Step 5: Implement the handler**

For each parsed event:

```js
const event = sanitizeDebugEvent(input);
await diagnosticTelemetryRepository.recordOccurrence({
  fingerprint: fingerprintDebugEvent(event),
  eventType: event.eventType,
  summaryCode: summaryCodeForDebugEvent(event),
  version: event.version,
  buildCommit: event.buildCommit || null,
  userId: request.reviveRelayUser ? request.reviveRelayUser.userId : null,
  context: event.context,
  occurredAt: new Date(event.occurredAt)
});
```

Return `202 { accepted: <count> }`.

- [ ] **Step 6: Run route/security tests and commit**

```bash
node --test server/test/routes/debug-telemetry.test.js server/test/security/debug-telemetry-rate-limit.test.js
git add server/src/routes/debug-telemetry.js server/test/routes/debug-telemetry.test.js \
  server/test/security/debug-telemetry-rate-limit.test.js
git commit -m "feat: ingest sanitized ReviveRelay debug telemetry"
```

---

### Task 8: Wire diagnostic repository into API/worker and extend 30-day retention

**Files:**
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`
- Modify: `server/src/worker.js`
- Modify: `server/src/worker/telemetry-retention.js`
- Modify: `server/test/worker/telemetry-retention.test.js`
- Modify: `server/test/worker/handlers.test.js`
- Modify: `server/test/routes/debug-telemetry.test.js`

**Interfaces:**
- `buildApp(...)` gains optional `diagnosticTelemetryRepository`.
- `createTelemetryRetentionHandler({ telemetryRepository, diagnosticTelemetryRepository, clock })` purges both stores.

- [ ] **Step 1: Write RED retention test**

Expected handler result:

```js
{
  status: 'reschedule',
  runAt: new Date(now + 24 * 60 * 60 * 1000),
  deletedErrorOccurrences: 4,
  deletedDiagnosticOccurrences: 7
}
```

Both repositories receive the same cutoff `now - 30 days`.

- [ ] **Step 2: Write RED app-wiring test**

Build an app with `diagnosticTelemetryRepository` and assert `/v1/telemetry/debug` exists. Build without it and assert the route is absent, matching current optional-repository registration style.

- [ ] **Step 3: Run RED**

Expected: function signature/results do not yet match.

- [ ] **Step 4: Wire API**

In `server/src/server.js`:

```js
const { createDiagnosticTelemetryRepository } = require('./db/diagnostic-telemetry');
const diagnosticTelemetryRepository = createDiagnosticTelemetryRepository(pool);
```

Pass it to `buildApp`. In `server/src/app.js`, register `registerDebugTelemetryRoutes` only when that repository is supplied.

- [ ] **Step 5: Wire retention worker**

Create the same diagnostic repository from the worker pool and pass it into `createTelemetryRetentionHandler`. Keep the existing active job type and dedupe key `telemetry.retention:reviverelay-errors` so deployment does not create a second competing retention schedule; the one job now purges both stores.

- [ ] **Step 6: Run focused and full server tests**

Run non-DB tests on host and full DB suite in the disposable private-network test database. Expected: all application tests pass; deployment-script tests use the host environment where `git` exists.

- [ ] **Step 7: Commit**

```bash
git add server/src/app.js server/src/server.js server/src/worker.js \
  server/src/worker/telemetry-retention.js server/test/worker
git commit -m "feat: wire ReviveRelay debug telemetry retention"
```

---

### Task 9: Implement pure client Auto-Debug contract, parser, and bounded uploader

**Files:**
- Create: `src/auto-debug-core.js`
- Create: `src/auto-debug-client.js`
- Create: `test/auto-debug-core.test.js`
- Create: `test/auto-debug-client.test.js`

**Interfaces:**

`src/auto-debug-core.js` exports global/CommonJS `ReviveRelayAutoDebugCore`:

```js
sanitizeSocketEndpoint(url) -> { host, path, socketClass }
frameSizeBucket(byteLength) -> 'tiny'|'small'|'medium'|'oversize'
decodeFrameData(data, maxBytes = 65536) -> Promise<{ kind, byteLength, text|null, oversize }>
analyzeTransportText(text, { marker = '', publicChannelIds = [] }) -> sanitized analysis
analyzeFrameData(data, { marker = '', publicChannelIds = [], socketHost = '', socketPath = '' }) -> Promise<sanitized observation>
sanitizeDebugEvent(event) -> strict client event or null
```

`src/auto-debug-client.js` exports `ReviveRelayAutoDebugClient`:

```js
createDebugClient({
  submit,
  getStoredQueue,
  saveStoredQueue,
  version,
  buildCommit,
  now,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) -> {
  capture(event),
  recordTransportObservation(observation),
  emitHeartbeat(snapshot),
  drain(),
  start(),
  stop(),
  startMarker(),
  clearMarker(),
  getMarkerState(),
  getSnapshot()
}
```

- [ ] **Step 1: Write RED endpoint/frame/parser tests**

Cover:

```text
wss://chat.torn.com/socket.io/?userId=123&token=SECRET
=> host chat.torn.com, path /socket.io/, no query/token

path /socket/123/550e8400-e29b-41d4-a716-446655440000/ABCDEF0123456789ABCDEF
=> numeric/UUID/opaque segments replaced with placeholders and <=160 chars

65536 bytes => inspectable
65537 bytes => oversize, no text parse
```

Test text, `ArrayBuffer`, and a fake Blob-like object exposing `arrayBuffer()`.

- [ ] **Step 2: Write RED Socket.IO/marker privacy tests**

Use a frame such as:

```js
'42["message",{"channel":"public_hospital","message":"RRWS-742546","sender":"DoNotExport"}]'
```

Expected sanitized analysis contains:

```js
{
  parsed: true,
  eventName: 'message',
  channelClass: 'public_hospital',
  hospitalIdentified: true,
  markerHit: true,
  markerPaths: ['$[1].message']
}
```

Assert output does **not** contain `RRWS-742546`, `DoNotExport`, or the raw frame string.

Test `faction-123`, `company-123`, and unknown channel values collapse to `forbidden_or_nonpublic` or `unknown` without preserving exact names.

- [ ] **Step 3: Write RED outbox/backoff tests**

Cover:

```text
queue max 100, oldest sanitized event dropped
entries older than 24h removed before drain
max batch 20
retry delays 5000,15000,30000,60000, then 300000
upload failure preserves queue and increments bounded failure state
upload failure does not recursively capture a new debug event per failure
marker expires at exactly 10 minutes
```

- [ ] **Step 4: Run RED**

```bash
node --test test/auto-debug-core.test.js test/auto-debug-client.test.js
```

Expected: modules missing.

- [ ] **Step 5: Implement pure core with fail-closed parsing**

Rules:

```text
Only Torn-owned socket hosts are parsed beyond endpoint classification.
Do not recurse into arbitrary values for export.
Only explicit envelope event-name strings matching /^[A-Za-z0-9_.:-]{1,80}$/ are retained.
Marker search returns structural paths only.
Exact known public channel IDs may be retained; non-public/unknown exact names may not.
```

- [ ] **Step 6: Implement debug client/outbox with the exact limits**

Store only the result of `sanitizeDebugEvent`. `readSafeQueue()` must drop expired entries before returning and slice to the newest 100. `drain()` sends at most 20 and schedules retries using the exact global delay sequence.

- [ ] **Step 7: Run GREEN and commit**

```bash
node --test test/auto-debug-core.test.js test/auto-debug-client.test.js
git add src/auto-debug-core.js src/auto-debug-client.js test/auto-debug-core.test.js test/auto-debug-client.test.js
git commit -m "feat: add bounded ReviveRelay auto-debug client core"
```

---

### Task 10: Install the earliest passive WebSocket observer without touching Torn behavior

**Files:**
- Create: `src/transport-observer.js`
- Create: `test/transport-observer.test.js`
- Create: `scripts/client-modules.js`
- Modify: `scripts/build.js`
- Modify: `scripts/release-client.js`
- Modify: `test/release-pinning.test.js`
- Modify: `test/release-dependency-verification.test.js`
- Modify: `test/bootstrap-controls.test.js`

**Interfaces:**

`src/transport-observer.js` evaluates immediately and exposes:

```js
globalThis.ReviveRelayTransportObserver = Object.freeze({
  configure({ isContentActive, analyzeFrame, onObservation }),
  snapshot(),
  healthCheck()
});
```

Its module-load side effect installs the wrapper exactly once.

- [ ] **Step 1: Write RED constructor-compatibility tests with a fake native WebSocket**

Assert:

```js
window.WebSocket !== NativeWebSocket
window.WebSocket.prototype === NativeWebSocket.prototype
window.WebSocket.CONNECTING === NativeWebSocket.CONNECTING
window.WebSocket.OPEN === NativeWebSocket.OPEN
window.WebSocket.CLOSING === NativeWebSocket.CLOSING
window.WebSocket.CLOSED === NativeWebSocket.CLOSED
new window.WebSocket(url) instanceof NativeWebSocket
```

Assert calling install twice does not wrap twice.

- [ ] **Step 2: Write RED passive-behavior/activity-gate tests**

Use a fake socket and verify:

```text
send is never replaced
close is never replaced
existing onmessage continues to receive the original event
observer adds one passive message listener
when isContentActive() is false, analyzeFrame is not called
coarse text/binary/size counters still increment when inactive
when active, analyzeFrame receives the current event.data only for the duration of analysis
```

- [ ] **Step 3: Run RED**

Expected: module missing.

- [ ] **Step 4: Implement the self-contained module-load hook**

Use `Reflect.construct` and preserve the native prototype/static constants. Use a unique sentinel such as:

```js
const SENTINEL = Symbol.for('reviverelay.transportObserver.v1');
```

Do not override `send`, `close`, or `onmessage`. Do not reconnect sockets. Do not cancel events.

- [ ] **Step 5: Change build ordering so this is the first executable bundled module**

Create `scripts/client-modules.js` as the single release/build module inventory:

```js
const PROVEN_SUPPORT_MODULES = Object.freeze([
  'src/core.js',
  'src/chat-dom.js',
  'src/public-channels.js',
  'src/client-chat-policy.js',
  'src/api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/revive-classifier.js',
  'src/candidate-pipeline.js'
]);
const EARLY_SUPPORT_MODULES = Object.freeze(['src/transport-observer.js']);
const AUTO_DEBUG_SUPPORT_MODULES = Object.freeze([
  'src/auto-debug-core.js',
  'src/auto-debug-client.js'
]);
const ALL_SUPPORT_MODULES = Object.freeze([
  ...EARLY_SUPPORT_MODULES,
  ...PROVEN_SUPPORT_MODULES,
  ...AUTO_DEBUG_SUPPORT_MODULES
]);
module.exports = {
  PROVEN_SUPPORT_MODULES,
  EARLY_SUPPORT_MODULES,
  AUTO_DEBUG_SUPPORT_MODULES,
  ALL_SUPPORT_MODULES
};
```

Change `scripts/build.js` to consume those arrays and emit early modules first, then the exact ten, then Auto-Debug modules, then the main userscript body. Change `scripts/release-client.js` to use `ALL_SUPPORT_MODULES` for embedded-byte validation and pinned GitHub byte verification instead of its old hard-coded ten-file list.

The browser-proven hash-lock tests continue to hash only `PROVEN_SUPPORT_MODULES` and must still pass exactly, while release integrity now verifies every executable bundled module.

- [ ] **Step 6: Run focused build tests**

```bash
npm run build
node --test test/transport-observer.test.js test/bootstrap-controls.test.js \
  test/release-pinning.test.js test/release-dependency-verification.test.js
node --check dist/reviverelay-manual.user.js
```

Expected: PASS, and the first bundled-module marker after metadata is `src/transport-observer.js`.

- [ ] **Step 7: Commit**

```bash
git add src/transport-observer.js scripts/client-modules.js scripts/build.js scripts/release-client.js \
  test/transport-observer.test.js test/bootstrap-controls.test.js \
  test/release-pinning.test.js test/release-dependency-verification.test.js
git commit -m "feat: install passive ReviveRelay transport observer"
```

---

### Task 11: Integrate always-on diagnostics, Debug Console, and server upload into the real userscript

**Files:**
- Create: `src/debug-console.js`
- Create: `test/debug-console.test.js`
- Create: `test/auto-debug-integration.test.js`
- Modify: `scripts/client-modules.js`
- Modify: `scripts/build.js`
- Modify: `scripts/release-client.js`
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `test/panel-ui.test.js`
- Modify: `test/telemetry-integration.test.js`
- Modify: `package.json`

**Interfaces:**

`src/debug-console.js`:

```js
createDebugConsole({
  getSnapshot,
  getRecentErrors,
  startMarker,
  clearMarker,
  copyText,
  addStyle
}) -> { open(), close(), refresh(), isOpen() }
```

Main-script Auto-Debug submit callback:

```js
async function submitDebugEvents(events) {
  const request = ReviveRelayApiClient.createGmRequestAdapter(GM_xmlhttpRequest);
  const token = String(GM_getValue(KEYS.sessionToken, '') || '').trim();
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-ReviveRelay-Version': VERSION,
    'X-ReviveRelay-Channel': UPDATE_CHANNEL
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await request({
    method: 'POST',
    url: `${API_BASE_URL}/v1/telemetry/debug`,
    headers,
    body: { events }
  });
  const status = Number(response?.status || 0);
  if (status >= 200 && status < 300) return response.body || {};
  const error = new Error('DEBUG_TELEMETRY_FAILED');
  error.status = status;
  throw error;
}
```

This deliberately avoids modifying locked `src/api-client.js`.

- [ ] **Step 1: Write RED always-on telemetry tests**

Update `test/telemetry-integration.test.js` so it now asserts:

```text
`reviverelay_client_diagnostics_enabled` no longer exists in source
`rr-diagnostics-enabled` checkbox no longer exists
window error/unhandledrejection hooks still exist
reportClientError does not check a user toggle
Settings contains `AUTO-DEBUG: ACTIVE`
Settings contains `rr-open-debug-console`
```

- [ ] **Step 2: Write RED integration test for background Debug Console independence**

Assert source/build wiring includes:

```text
ReviveRelayTransportObserver.configure(...)
ReviveRelayAutoDebugCore
ReviveRelayAutoDebugClient
ReviveRelayDebugConsole
reviverelay_debug_outbox
Open Debug Console button
closing/minimizing console does not set a collection/debug enabled flag false
```

- [ ] **Step 3: Write RED Debug Console module tests**

Test draggable/minimizable behavior, hidden-by-default state, safe snapshot rendering, marker start/clear, and `Copy Safe Report`. Assert raw `message`, `rawFrame`, `authorization`, `cookie`, and `token` keys are not rendered even if malicious snapshot input includes them.

- [ ] **Step 4: Run RED**

Expected: new module/integration assertions fail.

- [ ] **Step 5: Add new Tampermonkey storage keys and state without touching the proven ten modules**

Add:

```js
debugOutbox: 'reviverelay_debug_outbox',
debugConsolePosition: 'reviverelay_debug_console_position',
debugConsoleMinimized: 'reviverelay_debug_console_minimized'
```

Remove `clientDiagnosticsEnabled` key/state/toggle logic. Error telemetry becomes always-on whenever `state.telemetry` exists.

- [ ] **Step 6: Configure Auto-Debug in `init()` after the existing API adapter is available**

Create the debug client with `submitDebugEvents`, storage callbacks, `VERSION`, `BUILD_COMMIT`, and `Date.now`.

Configure the early observer:

```js
state.transportObserver.configure({
  isContentActive: captureAllowed,
  analyzeFrame: (data, meta) => ReviveRelayAutoDebugCore.analyzeFrameData(data, {
    ...meta,
    marker: state.autoDebug.getMarkerState().active ? state.autoDebug.getMarkerState().marker : '',
    publicChannelIds: Object.keys(PublicChannels.CHANNELS)
  }),
  onObservation: observation => state.autoDebug.recordTransportObservation(observation)
});
```

`PublicChannels.CHANNELS` is the existing frozen allowlist export; do not modify `src/public-channels.js`.

- [ ] **Step 7: Emit one-minute summaries and bounded immediate anomalies**

Use a single 60-second Auto-Debug heartbeat timer. Do not make one upload call per WebSocket frame. Immediate flush is allowed only for hook anomaly, marker hit, parser-failure threshold transition, and uploader-state transition.

- [ ] **Step 8: Add Settings Diagnostics card and separate Debug Console**

Settings card exact user-facing content:

```text
Diagnostics                         AUTO-DEBUG: ACTIVE
Sanitized technical diagnostics run automatically to help identify
ReviveRelay/Torn compatibility problems. Raw chat, keys, cookies and
WebSocket payloads are not uploaded.

Client version        <version>
Build                  <short commit>
Transport hook         ACTIVE / DEGRADED
Debug queue            <n>
Last upload            <time / Never>
[ Open Debug Console ]
```

No diagnostics disable checkbox.

- [ ] **Step 9: Add `src/debug-console.js` to the shared module inventory and release validator**

Append `src/debug-console.js` to `AUTO_DEBUG_SUPPORT_MODULES` in `scripts/client-modules.js`. Because both `scripts/build.js` and `scripts/release-client.js` consume `ALL_SUPPORT_MODULES`, the built artifact and pinned byte verifier now agree automatically. Final order is:

```text
1. src/transport-observer.js       (early, auto-installs)
2-11. exact ten proven modules     (unchanged bytes/order)
12. src/auto-debug-core.js
13. src/auto-debug-client.js
14. src/debug-console.js
15. main userscript body
```

- [ ] **Step 10: Set diagnostic version `0.4.8` and run the full client suite**

```bash
npm run check
```

Expected: all client tests pass, built scripts parse, exact ten support hashes remain unchanged.

- [ ] **Step 11: Commit**

```bash
git add package.json torn-revive-chat-collector.user.js scripts/client-modules.js scripts/build.js scripts/release-client.js \
  src/auto-debug-core.js src/auto-debug-client.js src/debug-console.js \
  test/auto-debug-integration.test.js test/debug-console.test.js \
  test/panel-ui.test.js test/telemetry-integration.test.js
git commit -m "feat: integrate always-on ReviveRelay auto-debug"
```

---

### Task 12: Deploy server diagnostics and the 0.4.8 manual diagnostic, then execute acceptance gates

**Files/Runtime:**
- Server runtime `/srv/voidsmith/torn-platform/reviverelay/app`
- Docker Compose project `reviverelay`
- Diagnostic artifact `/srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.8-auto-debug.user.js`
- Caddy `/etc/caddy/Caddyfile`
- Source of Truth Google Doc after verification only.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: live server support for sanitized debug telemetry and a manual-only integrated Auto-Debug client for browser acceptance. Automatic channel stays untouched.

- [ ] **Step 1: Run full pre-deploy verification**

Client:

```bash
npm run check
```

Server:

```text
Run all non-DB tests on the host.
Run all DB/integration tests against a disposable database inside reviverelay_db_internal.
Run deployment-script tests on the host where git exists.
```

Expected: zero application failures.

- [ ] **Step 2: Verify privacy by static negative scan**

Search the new Auto-Debug path for forbidden persistence fields:

```bash
grep -RniE 'rawFrame|rawPayload|chatText|Authorization|Cookie|apiKey|verificationKey|sessionToken' \
  src/auto-debug-core.js src/auto-debug-client.js src/transport-observer.js \
  server/src/routes/debug-telemetry.js server/src/telemetry/debug-contract.js \
  server/src/db/diagnostic-telemetry.js
```

Every match must be either an explicit rejection/redaction test/constant or an auth header used only transiently in the main submit callback. No DB schema or event field may accept those values.

- [ ] **Step 3: Back up the current ReviveRelay app/runtime and database using the isolated ReviveRelay procedures**

Run from the implementation worktree:

```bash
mkdir -p /srv/voidsmith/torn-platform/reviverelay/backups/app
sh deploy/backup.sh
STAMP=$(date -u +%Y%m%d-%H%M%S)
tar -C /srv/voidsmith/torn-platform/reviverelay \
  -czf "/srv/voidsmith/torn-platform/reviverelay/backups/app/reviverelay-app-${STAMP}.tar.gz" \
  app
```

Verify the printed PostgreSQL `.sql.gz` path exists and the app archive is non-empty:

```bash
ls -lh /srv/voidsmith/torn-platform/reviverelay/backups/postgres/reviverelay-*.sql.gz | tail -n 1
ls -lh "/srv/voidsmith/torn-platform/reviverelay/backups/app/reviverelay-app-${STAMP}.tar.gz"
```

Do not touch other Voidsmith projects.

- [ ] **Step 4: Deploy server code and run migration 005**

From the verified implementation worktree, synchronize only the server tree while preserving installed runtime dependencies:

```bash
rsync -a --delete --exclude node_modules server/ \
  /srv/voidsmith/torn-platform/reviverelay/app/server/
```

Run migration before restarting the API/worker so new code never starts against the old schema:

```bash
docker exec reviverelay-reviverelay-api-1 node src/db/migrate.js
```

Then explicitly restart only the two code-consuming ReviveRelay containers:

```bash
docker restart reviverelay-reviverelay-api-1 reviverelay-reviverelay-worker-1
```

Verify:

```text
GET /health => {"ok":true}
PostgreSQL still has no host port
API remains localhost:18730 behind Caddy
worker running
```

- [ ] **Step 5: Server smoke-test the new debug route**

Submit one synthetic anonymous `client_bootstrap` event and verify 202. Query only the new diagnostic tables through private server access and verify:

```text
one group
one occurrence
no raw message/body/header columns
user_id null for anonymous event
```

Then submit one authenticated event through a valid test/client session and verify attribution uses the internal user UUID only.

- [ ] **Step 6: Build and publish the exact 0.4.8 manual diagnostic artifact**

Copy and hash the tested artifact:

```bash
cp dist/reviverelay-manual.user.js \
  /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.8-auto-debug.user.js
sha256sum dist/reviverelay-manual.user.js \
  /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.8-auto-debug.user.js
```

Back up Caddy and insert this exact block before the final catch-all `handle`:

```caddy
@diagAutoDebug048 path /diagnostic/reviverelay-0.4.8-auto-debug.user.js
handle @diagAutoDebug048 {
    rewrite * /reviverelay-0.4.8-auto-debug.user.js
    root * /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic
    header Cache-Control "no-store"
    file_server
}
```

Then run:

```bash
cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.pre-reviverelay-auto-debug-048-$(date -u +%Y%m%dT%H%M%SZ)"
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -fsSI https://reviverelay.voidsmithindustries.com/diagnostic/reviverelay-0.4.8-auto-debug.user.js
curl -fsS https://reviverelay.voidsmithindustries.com/diagnostic/reviverelay-0.4.8-auto-debug.user.js | sha256sum
sha256sum /srv/voidsmith/torn-platform/reviverelay/releases/client/diagnostic/reviverelay-0.4.8-auto-debug.user.js
```

Expected: HTTP 200, `Cache-Control: no-store`, and identical public/local SHA-256 values.

Do not alter `/install/reviverelay-auto.*` or the automatic manifest.

- [ ] **Step 7: Mandatory integrated browser gate**

User installs `0.4.8-auto-debug` and explicitly confirms:

```text
PANEL APPEARS: YES
REVIVER SHARED PUBLIC FEED WORKS: YES
REQUEST/SETTINGS UI WORKS: YES
SETTINGS SHOWS AUTO-DEBUG: ACTIVE: YES
OPEN DEBUG CONSOLE WORKS: YES
CLOSING/MINIMIZING DEBUG CONSOLE DOES NOT STOP REVIVERELAY: YES
```

- [ ] **Step 8: Operator verifies background telemetry without asking user to copy logs**

Using SentinelX against the isolated ReviveRelay DB, inspect the newest `diagnostic_event_groups` and bounded `diagnostic_event_occurrences`. Verify recent events include at least one `client_bootstrap`, one `transport_summary` heartbeat (zero frame counts are valid), one `dom_collector_summary`, and one `debug_uploader_state`, all with sanitized context only.

- [ ] **Step 9: Run the synthetic minimized-Hospital marker gate**

From the Debug Console, start a marker. Keep Torn visible/focused and Hospital minimized. Send the exact marker from the second Torn account. Operator inspects server diagnostics directly.

Success criteria are all true:

```text
integrated hook active
inbound frames continue while Hospital minimized
synthetic_marker_hit received
channelClass == public_hospital
hospitalIdentified == true
markerPaths contains the structural message path
no marker value or neighboring chat text persisted
```

If any criterion fails, record the sanitized evidence and stop. Do not implement minimized-chat candidate submission in this plan.

- [ ] **Step 10: Verify 30-day retention behavior with controlled timestamps**

Insert test diagnostic occurrences older/newer than 30 days into a disposable PostgreSQL database created inside `reviverelay_db_internal`, run the retention handler against that disposable database, and verify old detailed occurrences are deleted while `diagnostic_event_groups` remain.

- [ ] **Step 11: Update the Voidsmith Source of Truth only with verified facts**

Record:

```text
Auto-Debug version tested
browser gate results
server diagnostic route/storage live status
privacy/retention model
marker result
whether minimized Hospital transport was proven
automatic-channel status remains unchanged unless separately promoted later
```

Do not state minimized transport is proven unless Step 9 actually succeeds.

- [ ] **Step 12: Final verification commit and status**

Run `git status`, `git diff --check`, focused test suites, and the full supported suites one final time. Commit any documentation-only verified-runtime notes separately from code.

Automatic release promotion is **not part of this implementation plan**. A later explicit promotion decision is required after all browser/server gates pass.
