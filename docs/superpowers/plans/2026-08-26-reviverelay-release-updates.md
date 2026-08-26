# ReviveRelay Release and Client Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe ReviveRelay userscript release/version management with immutable release metadata, automatic and manual update channels, once-daily server version checks, and server-enforced minimum supported versions for protected marketplace actions.

**Architecture:** Git `main` remains development source of truth. A release build creates immutable automatic/manual userscript artifacts plus metadata and SHA-256 hashes; the server exposes a non-executable JSON version manifest. Automatic-channel installations rely on Tampermonkey's native `@updateURL`/`@downloadURL` mechanism, while manual-channel installations disable native updates and receive an in-script update notification linking to the install page. The backend independently rejects protected actions from clients below `minimumVersion`.

**Tech Stack:** Node.js 20, Fastify 5, Node test runner, Tampermonkey userscript metadata, SHA-256 via `node:crypto`, immutable VPS release directories, Caddy/static serving at later public cutover.

**Spec:** `docs/superpowers/specs/2026-08-26-reviverelay-stage3-marketplace-verification-design.md`

## Global Constraints

- Never download and `eval()` remote executable JavaScript.
- Never implement browser-side self-modifying script replacement.
- Automatic updates use native userscript-manager update semantics only.
- Manual channel disables native `@updateURL`/`@downloadURL` and only notifies/links the user.
- Client version manifest check occurs at most once every 24 hours during active Torn use unless the user explicitly presses `Check now`.
- Manifest is JSON/data only and never executable code.
- Release artifacts are built only from a committed, fully verified tree.
- Each release records version, release timestamp, Git commit SHA, SHA-256, notes, latest version and minimum supported version.
- Protected marketplace actions are server-blocked below `minimumVersion`; informational/read-only routes remain available where safe.
- Error telemetry, health, authentication needed to update, and version-manifest endpoints must remain usable by outdated clients.
- Greasy Fork installations follow Greasy Fork/Tampermonkey update behavior and do not use a remote-code workaround.
- ReviveRelay DB/network isolation remains unchanged.
- Completed and verified work is merged to `main`.

---

### Task 1: Add Pure Semantic Version Comparison and Manifest Validation

**Files:**
- Create: `src/versioning.js`
- Create: `server/src/domain/client-version.js`
- Create: `test/versioning.test.js`
- Create: `server/test/domain/client-version.test.js`

**Interfaces:**
- Produces: client `compareVersions(a,b)`, `isNewer(latest,current)` and server `parseClientVersion(value)`, `meetsMinimum(current,minimum)`, `validateReleaseManifest(manifest)`.

- [ ] **Step 1: Write RED client version tests**

```js
const { compareVersions, isNewer } = require('../src/versioning');
assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
assert.equal(compareVersions('0.4.10', '0.4.9'), 1);
assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
assert.equal(isNewer('0.5.0', '0.4.9'), true);
assert.throws(() => compareVersions('latest', '0.4.0'), /version/i);
```

- [ ] **Step 2: Run RED tests**

Run: `node --test test/versioning.test.js server/test/domain/client-version.test.js`

Expected: FAIL because versioning modules are absent.

- [ ] **Step 3: Implement strict numeric three-part versions**

```js
function parse(value) {
  const match = String(value).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error('Invalid ReviveRelay version');
  return match.slice(1).map(Number);
}
```

Do not introduce a dependency for version parsing unless prerelease semantics become a real requirement; Stage 3 releases use `MAJOR.MINOR.PATCH` only.

- [ ] **Step 4: Implement manifest validation** requiring:

```js
{
  latestVersion: '0.4.0',
  minimumVersion: '0.3.0',
  releasedAt: 'ISO-8601',
  releaseNotes: 'bounded text',
  gitCommit: '40-char SHA-1',
  automatic: { installUrl, metaUrl, sha256 },
  manual: { installUrl, sha256 },
  mandatory: false
}
```

Validate SHA-256 as 64 lowercase hex chars and require `minimumVersion <= latestVersion`.

- [ ] **Step 5: Run tests until green**

- [ ] **Step 6: Commit**

```bash
git add src/versioning.js server/src/domain/client-version.js test/versioning.test.js server/test/domain/client-version.test.js
git commit -m "feat: add ReviveRelay client version semantics"
```

### Task 2: Build Automatic and Manual Userscript Release Variants

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/build.js`
- Create: `scripts/release-client.js`
- Modify: `package.json`
- Create: `test/release-build.test.js`

**Interfaces:**
- Produces: `dist/reviverelay-auto.user.js`, `dist/reviverelay-auto.meta.js`, `dist/reviverelay-manual.user.js`, and release metadata JSON/checksums.

- [ ] **Step 1: Write RED release-build tests**

```js
const auto = fs.readFileSync('dist/reviverelay-auto.user.js','utf8');
const manual = fs.readFileSync('dist/reviverelay-manual.user.js','utf8');
assert.match(auto, /@updateURL\s+https:\/\/reviverelay\.voidsmithindustries\.com\/install\/reviverelay-auto\.meta\.js/);
assert.match(auto, /@downloadURL\s+https:\/\/reviverelay\.voidsmithindustries\.com\/install\/reviverelay-auto\.user\.js/);
assert.match(manual, /@updateURL\s+none/);
assert.match(manual, /@downloadURL\s+none/);
assert.match(auto, /const UPDATE_CHANNEL = 'automatic'/);
assert.match(manual, /const UPDATE_CHANNEL = 'manual'/);
```

Also assert both variants contain the exact same `@version` and application body apart from controlled build-time metadata/channel injection.

- [ ] **Step 2: Run RED build test**

Run: `npm run build && node --test test/release-build.test.js`

Expected: FAIL because variant files are absent.

- [ ] **Step 3: Make source metadata build-neutral**

Introduce explicit build markers that are not valid remote URLs, for example:

```js
// @updateURL    __REVIVERELAY_UPDATE_URL__
// @downloadURL  __REVIVERELAY_DOWNLOAD_URL__
```

and:

```js
const UPDATE_CHANNEL = '__REVIVERELAY_UPDATE_CHANNEL__';
```

The normal build script must replace all markers; a marker surviving into `dist/` is a build failure.

- [ ] **Step 4: Implement `scripts/build.js` variant generation**

Automatic metadata:

```text
@updateURL   https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.meta.js
@downloadURL https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.user.js
UPDATE_CHANNEL='automatic'
```

Manual metadata:

```text
@updateURL   none
@downloadURL none
UPDATE_CHANNEL='manual'
```

`reviverelay-auto.meta.js` contains only userscript metadata header, not executable body.

- [ ] **Step 5: Implement `scripts/release-client.js`**

The script must refuse a dirty Git tree, read version from root `package.json`, compute SHA-256 for both user artifacts, read current commit via `git rev-parse HEAD`, and write `dist/release-manifest.json` containing artifact paths/hashes/commit/version. It must not publish files itself.

- [ ] **Step 6: Add package scripts**

```json
"build": "node scripts/build.js",
"release:client": "npm run check && node scripts/release-client.js"
```

- [ ] **Step 7: Run release build tests and syntax checks**

Run: `npm run build && node --test test/release-build.test.js && node --check dist/reviverelay-auto.user.js && node --check dist/reviverelay-manual.user.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add torn-revive-chat-collector.user.js scripts/build.js scripts/release-client.js package.json test/release-build.test.js
git commit -m "feat: build automatic and manual ReviveRelay channels"
```

### Task 3: Add Server Release Registry and Public JSON Manifest Endpoint

**Files:**
- Create: `server/src/release/registry.js`
- Create: `server/src/routes/client-version.js`
- Modify: `server/src/config.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`
- Create: `server/test/release/registry.test.js`
- Create: `server/test/routes/client-version.test.js`
- Modify: `server/test/config.test.js`

**Interfaces:**
- Produces: `loadReleaseManifest(path)`, `GET /v1/client/version`.

- [ ] **Step 1: Write RED registry tests**

```js
const registry = loadReleaseManifest('/tmp/manifest.json');
assert.equal(registry.latestVersion, '0.4.0');
assert.equal(registry.minimumVersion, '0.3.0');
assert.equal(Object.isFrozen(registry), true);
```

Test missing/invalid manifest fails startup when release registry is enabled rather than serving malformed data.

- [ ] **Step 2: Write RED route test**

```js
const response = await app.inject({ method:'GET', url:'/v1/client/version' });
assert.equal(response.statusCode, 200);
assert.deepEqual(response.json(), manifest);
assert.equal(response.headers['cache-control'], 'public, max-age=300');
```

- [ ] **Step 3: Implement immutable manifest loader**

Read `REVIVERELAY_RELEASE_MANIFEST_FILE`, parse once at process startup, validate with `validateReleaseManifest`, deep-freeze safe JSON. No endpoint writes release state.

- [ ] **Step 4: Implement public version route**

Return only the validated safe manifest. No authentication required. Add a conservative five-minute HTTP cache header while client logic itself checks at most daily.

- [ ] **Step 5: Register/configure and run tests**

- [ ] **Step 6: Commit**

```bash
git add server/src/release/registry.js server/src/routes/client-version.js server/src/config.js server/src/app.js server/src/server.js server/test/release/registry.test.js server/test/routes/client-version.test.js server/test/config.test.js
git commit -m "feat: expose ReviveRelay release manifest"
```

### Task 4: Enforce Minimum Client Version on Protected API Actions

**Files:**
- Create: `server/src/security/client-version.js`
- Modify: `server/src/app.js`
- Modify: `src/api-client.js`
- Modify: `server/test/routes/requests.test.js`
- Modify: `server/test/routes/reviver-queue.test.js`
- Modify: `server/test/routes/transactions.test.js`
- Create: `server/test/security/client-version.test.js`
- Modify: `test/api-client.test.js`

**Interfaces:**
- Produces: `installClientVersionGate(app,{ releaseRegistry })`; API client sends `X-ReviveRelay-Version` and `X-ReviveRelay-Channel` on every call.

- [ ] **Step 1: Write RED middleware tests**

```js
assert.equal(checkClientVersion({ current:'0.3.9', minimum:'0.4.0' }).allowed, false);
assert.equal(checkClientVersion({ current:'0.4.0', minimum:'0.4.0' }).allowed, true);
```

- [ ] **Step 2: Add RED route tests** proving outdated clients receive HTTP `426` with:

```json
{
  "error": "CLIENT_UPDATE_REQUIRED",
  "latestVersion": "0.4.2",
  "minimumVersion": "0.4.1",
  "installUrl": "https://reviverelay.voidsmithindustries.com/install/"
}
```

for request creation, queue/accept and transaction-mutating actions, while `/health`, `/v1/client/version`, `/v1/auth/bind`, `/v1/me`, and `/v1/telemetry/errors` remain available.

- [ ] **Step 3: Extend API client headers**

`createApiClient` receives `clientVersion` and `releaseChannel`; each request includes both headers. Tests assert no Torn API key or session token is placed in URL/query parameters.

- [ ] **Step 4: Implement protected-route gate**

Use Fastify preHandler only on protected marketplace routes, not as a global hook. Missing/invalid version is rejected with `CLIENT_UPDATE_REQUIRED` for protected actions.

- [ ] **Step 5: Run server/client version-gate tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/security/client-version.js server/src/app.js src/api-client.js server/test/routes server/test/security/client-version.test.js test/api-client.test.js
git commit -m "feat: require supported ReviveRelay clients"
```

### Task 5: Add Once-Daily Client Manifest Checks and Update UX

**Files:**
- Create: `src/update-manager.js`
- Modify: `src/api-client.js`
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/build.js`
- Create: `test/update-manager.test.js`
- Create: `test/update-ui.test.js`

**Interfaces:**
- Produces: `createUpdateManager({ currentVersion, channel, fetchManifest, getState, saveState, now, openUrl })` with `check({ force })`, `dismiss(version)`, and `switchChannel(target)`.

- [ ] **Step 1: Write RED update-manager tests**

```js
const manager = createUpdateManager({
  currentVersion:'0.4.0', channel:'manual', fetchManifest:async()=>manifest,
  getState:()=>({ lastCheckedAt:0 }), saveState:s=>saved=s, now:()=>86_400_001,
  openUrl:url=>opened=url
});
const result = await manager.check({ force:false });
assert.equal(result.updateAvailable, true);
assert.equal(result.mandatory, false);
```

Also test no network call before 24 hours, force check bypasses interval, dismissed optional release stays dismissed only for that version, a newer version clears dismissal, mandatory release cannot be permanently dismissed, malformed manifest does not break gameplay, and automatic/manual channel target URLs differ.

- [ ] **Step 2: Run RED update-manager tests**

Expected: FAIL.

- [ ] **Step 3: Implement manager state**

Persist only:

```js
{
  lastCheckedAt: 0,
  lastManifest: null,
  dismissedVersion: null
}
```

Do not persist executable code. `check({force:false})` skips fetch until `now-lastCheckedAt >= 86_400_000`.

- [ ] **Step 4: Extend API client** with unauthenticated `getClientVersionManifest()`.

- [ ] **Step 5: Write RED UI tests** for Options update section:

```text
Current version
Release channel: Automatic | Manual
Latest version
Last checked
Check now
Switch to Automatic / Switch to Manual
```

Manual update banner shows `Update ReviveRelay` and `Remind me later`; mandatory banner does not offer a permanent dismissal and protected-action buttons are disabled if current version < minimum.

- [ ] **Step 6: Implement UI**

Automatic channel explains that Tampermonkey performs actual replacement according to its settings. Manual channel update button opens `manifest.manual.installUrl`. Channel switching opens the counterpart installer once; the running script does not pretend it changed its metadata itself.

- [ ] **Step 7: Run client tests/build**

Run: `npm run test:client && npm run build && node --check dist/reviverelay-auto.user.js && node --check dist/reviverelay-manual.user.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/update-manager.js src/api-client.js torn-revive-chat-collector.user.js scripts/build.js test/update-manager.test.js test/update-ui.test.js
git commit -m "feat: add ReviveRelay update notifications"
```

### Task 6: Add Immutable VPS Release Publishing

**Files:**
- Create: `deploy/publish-client-release.sh`
- Create: `server/test/deploy/client-release.test.js`
- Modify: `deploy/README.md`

**Interfaces:**
- Produces immutable release layout under `/srv/voidsmith/torn-platform/reviverelay/releases/client/<version>/` and stable internal install/current manifest paths without touching other Voidsmith projects.

- [ ] **Step 1: Write RED deploy test** that inspects the shell script contract and verifies it refuses dirty/unverified source, creates a version directory, verifies hashes, refuses overwrite of an existing version, writes manifest atomically, and only then updates stable symlinks.

- [ ] **Step 2: Implement `publish-client-release.sh`**

Required layout:

```text
/srv/voidsmith/torn-platform/reviverelay/releases/client/0.4.0/
  reviverelay-auto.user.js
  reviverelay-auto.meta.js
  reviverelay-manual.user.js
  release-manifest.json

/srv/voidsmith/torn-platform/reviverelay/releases/client/current -> 0.4.0/
/srv/voidsmith/torn-platform/reviverelay/releases/client/manifest.json
```

The script must copy only verified `dist/` artifacts, compare each SHA-256 with release metadata using `sha256sum -c`, create via temporary directory then atomic rename, and never delete earlier release directories automatically.

- [ ] **Step 3: Add stable install-path mapping documentation**

At public Caddy cutover later:

```text
/install/reviverelay-auto.user.js -> releases/client/current/reviverelay-auto.user.js
/install/reviverelay-auto.meta.js -> releases/client/current/reviverelay-auto.meta.js
/install/reviverelay-manual.user.js -> releases/client/current/reviverelay-manual.user.js
/v1/client/version -> API validated manifest
```

- [ ] **Step 4: Run deploy tests/shell syntax**

Run: `node --test server/test/deploy/client-release.test.js && bash -n deploy/publish-client-release.sh`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy/publish-client-release.sh server/test/deploy/client-release.test.js deploy/README.md
git commit -m "feat: publish immutable ReviveRelay client releases"
```

### Task 7: Release-System Verification, Internal Publish, and Merge

**Files:**
- Modify: `README.md`
- Runtime: `/srv/voidsmith/torn-platform/reviverelay/releases/client/`

**Interfaces:**
- Produces a tested internal release/update system ready for later public DNS/Caddy cutover.

- [ ] **Step 1: Bump the next internal test version consistently** across root package/userscript release metadata through the release process, not by hand-editing generated artifacts.

- [ ] **Step 2: Run full repository verification**

Run: `npm test && npm run build`

Then: `node --check dist/reviverelay-auto.user.js && node --check dist/reviverelay-manual.user.js`

Expected: PASS.

- [ ] **Step 3: Run `npm run release:client` on a clean committed tree** and verify generated release manifest commit SHA equals `git rev-parse HEAD` and artifact SHA-256 values match `sha256sum`.

- [ ] **Step 4: Publish one internal release** with `deploy/publish-client-release.sh`. Confirm prior release directories remain immutable and `current` points to the new release only after verification.

- [ ] **Step 5: Start/restart only ReviveRelay API as required and query `http://127.0.0.1:18730/v1/client/version`**; assert manifest matches the published release metadata.

- [ ] **Step 6: Verify minimum-version behavior internally** using Fastify tests/local HTTP requests: an older version can reach health/version/auth/telemetry but receives `426 CLIENT_UPDATE_REQUIRED` on protected marketplace mutation.

- [ ] **Step 7: Re-run deployment/database isolation gates**; release files are under ReviveRelay only and no database/network exposure changes occurred.

- [ ] **Step 8: Update README**, commit, merge completed updater branch to `main`, rerun full tests on merged `main`, synchronize GitHub `main`, verify tree equality, remove completed worktree/branch, and update the Voidsmith Source of Truth with verified release paths/version state and no secrets.

```bash
git add README.md
git commit -m "docs: document ReviveRelay release channels"
```
