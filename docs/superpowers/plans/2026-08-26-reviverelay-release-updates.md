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
- Each release records version, release timestamp, Git commit SHA, SHA-256, release notes, latest version and minimum supported version.
- Protected marketplace actions are server-blocked below `minimumVersion`; informational/read-only routes remain available where safe.
- Error telemetry, health, authentication needed to update, and version-manifest endpoints remain usable by outdated clients.
- Greasy Fork installations follow Greasy Fork/Tampermonkey update behavior and do not use a remote-code workaround.
- ReviveRelay DB/network isolation remains unchanged.
- Completed and verified work is merged to `main`.

---

### Task 1: Add Pure Version Comparison and Manifest Validation

**Files:**
- Create: `src/versioning.js`
- Create: `server/src/domain/client-version.js`
- Create: `test/versioning.test.js`
- Create: `server/test/domain/client-version.test.js`

**Interfaces:**
- Produces client `compareVersions(a,b)`, `isNewer(latest,current)` and server `parseClientVersion(value)`, `compareClientVersions(a,b)`, `meetsMinimum(current,minimum)`, `validateReleaseManifest(manifest)`.

- [ ] **Step 1: Write RED client/server tests**

```js
assert.equal(compareVersions('0.4.0','0.4.0'),0);
assert.equal(compareVersions('0.4.10','0.4.9'),1);
assert.equal(compareVersions('1.0.0','0.99.99'),1);
assert.equal(isNewer('0.5.0','0.4.9'),true);
assert.throws(() => compareVersions('latest','0.4.0'), /version/i);
assert.equal(meetsMinimum('0.4.0','0.4.0'),true);
assert.equal(meetsMinimum('0.3.9','0.4.0'),false);
```

- [ ] **Step 2: Run RED tests**

Run: `node --test test/versioning.test.js server/test/domain/client-version.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement strict numeric `MAJOR.MINOR.PATCH` parsing**

```js
function parse(value) {
  const match = String(value).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error('Invalid ReviveRelay version');
  return match.slice(1).map(Number);
}
```

No semver dependency is added because Stage 3 releases deliberately exclude prerelease/build suffixes.

- [ ] **Step 4: Implement manifest validation** requiring exactly these public fields:

```js
{
  latestVersion:'0.4.0',
  minimumVersion:'0.3.0',
  releasedAt:'2026-08-26T12:00:00.000Z',
  releaseNotes:'Payment verification improvements.',
  gitCommit:'0123456789012345678901234567890123456789',
  automatic:{ installUrl:'https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.user.js', metaUrl:'https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.meta.js', sha256:'64-lowercase-hex' },
  manual:{ installUrl:'https://reviverelay.voidsmithindustries.com/install/reviverelay-manual.user.js', sha256:'64-lowercase-hex' },
  mandatory:false
}
```

Validate SHA-256 format, ISO timestamp, bounded notes <=4000 chars, 40-hex Git commit and `minimumVersion <= latestVersion`.

- [ ] **Step 5: Run tests and commit**

```bash
git add src/versioning.js server/src/domain/client-version.js test/versioning.test.js server/test/domain/client-version.test.js
git commit -m "feat: add ReviveRelay client version semantics"
```

### Task 2: Build Automatic and Manual Userscript Variants plus a Deterministic Release Manifest

**Files:**
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/build.js`
- Create: `scripts/release-client.js`
- Modify: `package.json`
- Create: `test/release-build.test.js`
- Create: `test/release-client.test.js`

**Interfaces:**
- Produces: `dist/reviverelay-auto.user.js`, `dist/reviverelay-auto.meta.js`, `dist/reviverelay-manual.user.js`, `dist/release-manifest.json`.

- [ ] **Step 1: Write RED build tests**

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

Also assert same `@version` and same application body except the controlled metadata/channel substitutions.

- [ ] **Step 2: Run RED build test**

Run: `npm run build && node --test test/release-build.test.js`

Expected: FAIL because variants are absent.

- [ ] **Step 3: Make source metadata build-neutral**

```js
// @updateURL    __REVIVERELAY_UPDATE_URL__
// @downloadURL  __REVIVERELAY_DOWNLOAD_URL__
const UPDATE_CHANNEL = '__REVIVERELAY_UPDATE_CHANNEL__';
```

Build fails if any marker remains in `dist/`.

- [ ] **Step 4: Generate channel variants**

Automatic:

```text
@updateURL   https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.meta.js
@downloadURL https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.user.js
UPDATE_CHANNEL='automatic'
```

Manual:

```text
@updateURL   none
@downloadURL none
UPDATE_CHANNEL='manual'
```

`reviverelay-auto.meta.js` is metadata header only.

- [ ] **Step 5: Write RED release-script tests**

```js
const manifest = buildReleaseManifest({
  version:'0.4.0', minimumVersion:'0.3.0', mandatory:false,
  releaseNotes:'Payment verification improvements.', releasedAt:'2026-08-26T12:00:00.000Z',
  gitCommit:'0123456789012345678901234567890123456789',
  autoSha256:'a'.repeat(64), manualSha256:'b'.repeat(64)
});
assert.equal(manifest.latestVersion,'0.4.0');
assert.equal(manifest.minimumVersion,'0.3.0');
```

- [ ] **Step 6: Implement `scripts/release-client.js`**

CLI contract:

```text
node scripts/release-client.js --minimum 0.3.0 --notes-file /path/to/release-notes.txt [--mandatory]
```

It refuses a dirty Git tree, reads `latestVersion` from root `package.json`, requires `--minimum`, requires an existing UTF-8 notes file <=4000 chars, sets `releasedAt` to current UTC ISO, reads current commit with `git rev-parse HEAD`, computes both artifact SHA-256 values, validates the resulting manifest, then writes `dist/release-manifest.json`. It does not publish.

- [ ] **Step 7: Add package scripts**

```json
"build":"node scripts/build.js",
"release:client":"npm run check && node scripts/release-client.js"
```

The operator supplies required CLI args after `--`, for example `npm run release:client -- --minimum 0.3.0 --notes-file /tmp/reviverelay-notes.txt`.

- [ ] **Step 8: Run build/release unit tests and syntax checks**

Run: `npm run build && node --test test/release-build.test.js test/release-client.test.js && node --check dist/reviverelay-auto.user.js && node --check dist/reviverelay-manual.user.js`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add torn-revive-chat-collector.user.js scripts/build.js scripts/release-client.js package.json test/release-build.test.js test/release-client.test.js
git commit -m "feat: build automatic and manual ReviveRelay channels"
```

### Task 3: Add Server Release Registry and JSON Manifest Endpoint

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

- [ ] **Step 1: Write RED registry/route tests**

```js
const registry = loadReleaseManifest('/tmp/manifest.json');
assert.equal(registry.latestVersion,'0.4.0');
assert.equal(Object.isFrozen(registry),true);
const response = await app.inject({ method:'GET', url:'/v1/client/version' });
assert.equal(response.statusCode,200);
assert.equal(response.headers['cache-control'],'public, max-age=300');
```

Missing/invalid enabled manifest must fail startup instead of serving malformed data.

- [ ] **Step 2: Implement immutable loader** from `REVIVERELAY_RELEASE_MANIFEST_FILE`, validate once at startup, deep-freeze the safe object.

- [ ] **Step 3: Implement unauthenticated JSON route** returning only the validated manifest with five-minute HTTP cache.

- [ ] **Step 4: Register/configure, run tests, commit**

```bash
git add server/src/release/registry.js server/src/routes/client-version.js server/src/config.js server/src/app.js server/src/server.js server/test/release/registry.test.js server/test/routes/client-version.test.js server/test/config.test.js
git commit -m "feat: expose ReviveRelay release manifest"
```

### Task 4: Enforce Minimum Version on Protected Marketplace Actions

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
- Produces: `checkClientVersion({ current, minimum })`, `createClientVersionPreHandler({ releaseRegistry })`; API client sends `X-ReviveRelay-Version` and `X-ReviveRelay-Channel` on every call.

- [ ] **Step 1: Write RED version-gate tests**

```js
assert.equal(checkClientVersion({ current:'0.3.9', minimum:'0.4.0' }).allowed,false);
assert.equal(checkClientVersion({ current:'0.4.0', minimum:'0.4.0' }).allowed,true);
```

Protected route from old client receives HTTP 426:

```json
{"error":"CLIENT_UPDATE_REQUIRED","latestVersion":"0.4.2","minimumVersion":"0.4.1","installUrl":"https://reviverelay.voidsmithindustries.com/install/"}
```

Health, client-version manifest, identity auth, `/v1/me`, and telemetry remain accessible.

- [ ] **Step 2: Extend API client** so constructor receives `clientVersion` and `releaseChannel` and adds both headers. Never put version, session, or Torn key into query strings merely for this gate.

- [ ] **Step 3: Implement route preHandler** on protected request/queue/accept/transaction-mutating routes only. Missing/invalid version is unsupported for protected actions.

- [ ] **Step 4: Run tests and commit**

```bash
git add server/src/security/client-version.js server/src/app.js src/api-client.js server/test/routes server/test/security/client-version.test.js test/api-client.test.js
git commit -m "feat: require supported ReviveRelay clients"
```

### Task 5: Add Once-Daily Manifest Checks and Update UX

**Files:**
- Create: `src/update-manager.js`
- Modify: `src/api-client.js`
- Modify: `torn-revive-chat-collector.user.js`
- Modify: `scripts/build.js`
- Create: `test/update-manager.test.js`
- Create: `test/update-ui.test.js`

**Interfaces:**
- Produces: `createUpdateManager({ currentVersion, channel, fetchManifest, getState, saveState, now, openUrl })` with `check({ force })`, `dismiss(version)`, `switchChannel(target)`.

- [ ] **Step 1: Write RED manager tests**

```js
const manager = createUpdateManager({ currentVersion:'0.4.0', channel:'manual', fetchManifest:async()=>manifest, getState:()=>({ lastCheckedAt:0 }), saveState:s=>{ saved=s; }, now:()=>86_400_001, openUrl:url=>{ opened=url; } });
const result = await manager.check({ force:false });
assert.equal(result.updateAvailable,true);
```

Test no fetch before 24h, forced check, optional dismissal scoped to one version, newer version clearing dismissal, mandatory release not permanently dismissible, malformed manifest not breaking gameplay, channel-specific install URLs.

- [ ] **Step 2: Implement manager state**

```js
{ lastCheckedAt:0, lastManifest:null, dismissedVersion:null }
```

No executable code is persisted. Normal check skips fetch until `now-lastCheckedAt >= 86_400_000`.

- [ ] **Step 3: Add API client `getClientVersionManifest()`**.

- [ ] **Step 4: Write RED UI tests** for Current Version, Automatic/Manual channel, Latest Version, Last Checked, Check Now, Switch Channel, optional update banner and mandatory update banner.

- [ ] **Step 5: Implement UI**: automatic explains native Tampermonkey behavior; manual opens `manifest.manual.installUrl`; channel switch opens counterpart installer once; script never claims to rewrite its own metadata.

- [ ] **Step 6: Disable protected-action buttons locally when current < minimum**, while server remains authoritative.

- [ ] **Step 7: Run client tests/build and commit**

Run: `npm run test:client && npm run build && node --check dist/reviverelay-auto.user.js && node --check dist/reviverelay-manual.user.js`

```bash
git add src/update-manager.js src/api-client.js torn-revive-chat-collector.user.js scripts/build.js test/update-manager.test.js test/update-ui.test.js
git commit -m "feat: add ReviveRelay update notifications"
```

### Task 6: Publish Immutable VPS Client Releases

**Files:**
- Create: `deploy/publish-client-release.sh`
- Create: `server/test/deploy/client-release.test.js`
- Modify: `deploy/README.md`

**Interfaces:**
- Produces immutable `/srv/voidsmith/torn-platform/reviverelay/releases/client/<version>/` releases and stable internal current/manifest paths.

- [ ] **Step 1: Write RED deploy contract test** proving the script refuses dirty source, refuses overwrite of an existing version, verifies SHA-256, stages into a temp directory, atomically renames, and only then changes `current`/manifest.

- [ ] **Step 2: Implement release layout**

```text
/srv/voidsmith/torn-platform/reviverelay/releases/client/0.4.0/
  reviverelay-auto.user.js
  reviverelay-auto.meta.js
  reviverelay-manual.user.js
  release-manifest.json
/srv/voidsmith/torn-platform/reviverelay/releases/client/current -> 0.4.0/
/srv/voidsmith/torn-platform/reviverelay/releases/client/manifest.json
```

Use `sha256sum -c`, temp dir + atomic rename, and never automatically delete old versions.

- [ ] **Step 3: Document later public mapping**

```text
/install/reviverelay-auto.user.js -> releases/client/current/reviverelay-auto.user.js
/install/reviverelay-auto.meta.js -> releases/client/current/reviverelay-auto.meta.js
/install/reviverelay-manual.user.js -> releases/client/current/reviverelay-manual.user.js
/v1/client/version -> API validated manifest
```

- [ ] **Step 4: Run deploy test + shell syntax and commit**

Run: `node --test server/test/deploy/client-release.test.js && bash -n deploy/publish-client-release.sh`

```bash
git add deploy/publish-client-release.sh server/test/deploy/client-release.test.js deploy/README.md
git commit -m "feat: publish immutable ReviveRelay client releases"
```

### Task 7: Verify, Publish Initial 0.4.0 Internally, and Merge

**Files:**
- Modify: `README.md`
- Runtime: `/srv/voidsmith/torn-platform/reviverelay/releases/client/`

**Interfaces:**
- Produces the first Stage 3 internal release `0.4.0`, with minimum supported client `0.3.0`, ready for later public DNS/Caddy cutover.

- [ ] **Step 1: Set the single source version to `0.4.0`** and regenerate artifacts; never hand-edit generated `dist/` versions.

- [ ] **Step 2: Run full repository verification**

Run: `npm test && npm run build && node --check dist/reviverelay-auto.user.js && node --check dist/reviverelay-manual.user.js`

Expected: PASS.

- [ ] **Step 3: Create release notes outside Git and build the manifest on a clean committed tree**

Run:

```bash
printf '%s\n' 'Stage 3 protected marketplace, telemetry, and update-channel foundation.' > /tmp/reviverelay-release-notes.txt
npm run release:client -- --minimum 0.3.0 --notes-file /tmp/reviverelay-release-notes.txt
```

- [ ] **Step 4: Verify manifest version is `0.4.0`, minimum is `0.3.0`, commit SHA equals `git rev-parse HEAD`, and artifact hashes equal `sha256sum` output.**

- [ ] **Step 5: Publish `0.4.0` internally** and prove old release directories remain immutable and `current` changes only after verification.

- [ ] **Step 6: Query `http://127.0.0.1:18730/v1/client/version`** and assert it exactly matches the published manifest.

- [ ] **Step 7: Verify a `0.2.9` client can reach health/version/auth/telemetry but receives `426 CLIENT_UPDATE_REQUIRED` on protected marketplace mutation; `0.3.0` remains accepted.**

- [ ] **Step 8: Re-run DB/network isolation gates** and confirm release serving changed no database exposure.

- [ ] **Step 9: Update README, commit, merge completed updater branch to local `main`, rerun full tests, synchronize GitHub `main`, verify tree equality, remove the completed worktree/branch, and update the Voidsmith Source of Truth with verified release facts only.**
