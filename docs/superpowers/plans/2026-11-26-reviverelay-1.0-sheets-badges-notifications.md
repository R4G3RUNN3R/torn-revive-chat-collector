# ReviveRelay 1.0 Sheets, Badges and Notifications (Plan 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ReviveRelay 1.0.1: trim the Lite core, then add leader-only deduplicated notifications (per-type toggles, quiet hours, sound), "RR verified" profile badges with a GM-persisted LRU, the Plan 3a carry-over fixes, and the three CHANGELOG limitations, all inside the unchanged size gates.

**Revision 2 (after `p3b-plan-review.md`):**

| Finding | Fix | Task |
| --- | --- | --- |
| I-1 | The 0.7 toggle is migrated into the Lite settings at boot | 10 |
| I-2 | No badge lookup without a session token | 8 |
| I-3 | The unreachable `(!)` title fallback is dropped; the visible-tab requirement is disclosed | 9, 11, smoke 5 |
| I-4 | Per-type toggles in Settings | 10 |
| I-5 | Re-scan on visible | 8 |
| I-6 | Update notice from the leader only | 10 |
| Minor 1–12 | Fixed in place; each fix is noted in Appendix B | |

**Architecture:** First, four trim tasks shrink the Lite core and make room. They move source comments into a notes document, move panel-only API code out of the core, collapse duplicated helpers, and remove the opt-in client telemetry. Then the features land as two new Lite modules. `src/lite/notify.js` is fed by the engine's leader inside `apply()` on live snapshots. `src/lite/badges.js` is scanned on the existing one-shot relayout timers. Both are wired in `src/lite/boot.js`; their settings live in the existing panel (decision 15).

**Tech Stack:** Userscript (Tampermonkey/Violentmonkey/TornPDA), UMD modules bundled verbatim by `scripts/build.js`, `node:test` with in-repo fakes (no jsdom). There are no server changes.

**Branch:** cut `feat/reviverelay-1.0-sheets` from `feat/reviverelay-1.0-integration` at `666ea60`.

## Owner decisions (2026-11-26, binding)

- The new requester and reviver sheets, and the hospital-list "RR" badges, move to **1.1**. They do not fit in the 110,000 B Lite core next to notifications and badges; the numbers are below and in Appendix A.
- The synthesized chime is accepted for now (D-3).
- The size gates are not raised.

## Size verdict (read first)

Everything in 1.0.1 fits with the required ≥ 2 KB Lite-core margin. That covers the trims, notifications with per-type toggles and sound, profile badges, the carry-over fixes and the review fixes I-1 to I-6. Per-type toggles cost 0 B of core: they are panel controls over settings that `notify.js` already reads.

All numbers below are bytes, measured on prototype builds of this plan's code (scratch clone of `666ea60`), with `scripts/size-report.js` (Task 1).

| Step | Lite core | Δ core | Whole file | Δ whole |
| --- | ---: | ---: | ---: | ---: |
| Baseline 1.0.0 (`666ea60`) | 109,665 | | 230,507 | |
| Task 2: move Lite-core comments to `docs/lite/ENGINE-NOTES.md` | 105,205 | −4,460 | 226,047 | −4,460 |
| Task 3: panel-only API and `versioning.js` out of the core (`src/panel-api-client.js`) | 99,816 | −5,389 | 227,310 | +1,263 |
| Task 4: one-line `dependency`, shared `safeParseBody`, dead `defaultTabId`, `addStyle` into MAIN | 98,235 | −1,581 | ≈ 226,000 | ≈ −1,300 |
| Task 5: remove opt-in client telemetry (`src/telemetry-client.js` and its MAIN glue) | 98,235 | 0 | ≈ 216,030 | −9,991 |
| **Trims total** | | **−11,430** | | **≈ −14,500** |
| Tasks 6–9: engine/scheduler carry-overs and hook, badge LRU, `badges.js`, `notify.js`, boot wiring | | +9,642 | | +9,642 |
| Task 10: MAIN settings (incl. per-type toggles), boot settings migration, leader-only update notice, invoice expiry, deletion reset, M2/M4/M5 (legacy panel only) | | 0 | | ≈ +2,350 |
| **Projected 1.0.1 (measured on the prototype, after review fixes I-1 to I-6)** | **107,877** | | **228,012** | |
| Headroom against the gates | **2,123** (≥ 2,000 ✔) | | **3,988** | |

**Feature arithmetic.** The core-side feature cost is 107,877 − 98,235 = 9,642 B:

| Part | Bytes |
| --- | ---: |
| `notify.js` block, with markers and join | 4,870 |
| `badges.js` block | 2,462 |
| engine and scheduler changes (Task 6) | +315 |
| state-client (Task 7) and boot wiring (Tasks 8–9) | +1,995 |

**Sheets (moved to 1.1).** A compact prototype of the requester and reviver sheets measures 12,090 B, before its bundle markers and about 450 B of boot wiring. That would project the Lite core to ≈ 120,550 B, which is about 10,550 B over the gate and about 12,550 B short of the 2 KB margin. Therefore:

- 1.0.1 keeps the 1.0.0 behaviour: the pill opens the existing panel for everyday flows.
- The panel's request, queue and transaction code stays, because nothing replaces it yet.

## Global Constraints

- Owner decision 2026-11-26 (binding): "Size gates are NOT raised: Lite core ≤ 110,000 B, whole ≤ 232,000 B. The new features must fit by trimming older code out of the Lite core." The projection must keep ≥ 2 KB of Lite-core margin.
- Spec decision 14 (Plan 3b note): new sheets, badges, notifications and sound fit by trimming older code out of the Lite core, never by raising a gate.
- Spec decision 15: key setup, Pro invoices, settings and account deletion stay in the existing panel. Notification, sound, quiet-hours and badge settings therefore live in the panel's Settings drawer.
- Spec decision 5: "Sound … on by default for key action/outcome events only; new queue requests silent; one toggle for all sound." Requester events with sound: accepted (time to pay), revived, refund resolved. Reviver events with sound: payment received (revive now), refund owed.
- Single-actor invariant: "at most one tab fires a given notification." Notifications fire only from the leader, inside `apply()`, on a live snapshot, and are deduped by event id in GM storage (`reviverelay_notified_events_v1`). The update notice also goes through the leader only.
- Consequence of "hidden tab: zero work": notifications and sound need at least one visible Torn tab (or TornPDA in the foreground). This is disclosed in the CHANGELOG.
- Dormancy: signed-out users make no badge lookups. The badge endpoint requires authentication, so the client never calls it without a session token.
- Spec "Inline badges": "fetched only when that profile page is visible, cached for 10 minutes", "in memory and in GM storage (bounded at 200 entries, LRU)", "marked with `data-rr-badge`".
- Bundled modules stay byte-identical to their sources: there is no build-time comment stripping or minification. Removing comments from a source file is allowed and is how Task 2 trims.
- Lite sources must not use `innerHTML`/`outerHTML`/`insertAdjacentHTML`, `eval`/`new Function`, `fetch`/`XMLHttpRequest`, or `localStorage`/`sessionStorage`/`indexedDB` (`test/lite-bundle.test.js`). After Task 2, Lite-core sources carry no comments (new guard).
- No recurring `setInterval` anywhere. All recurring work goes through the engine's one scheduler. Badges use the existing one-shot relayout timers.
- Versions: single-digit components only (`^[0-9]\.[0-9]\.[0-9]$`). This release is `1.0.1` (justified in Task 11).
- Every removal carries grep evidence that the code is unused, or names the behaviour change and who sanctioned it.
- Code style: CommonJS/UMD, two-space indent, single quotes.
- Commit after every task. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Setup (once, before Task 1)

```bash
git switch -c feat/reviverelay-1.0-sheets feat/reviverelay-1.0-integration
npm run build && node --test test 2>&1 | grep -E '^# (pass|fail)'
```
Expected: `# pass 623`, `# fail 0`.

**Known red until Task 11 (expected, do not "fix"):** `docs/review/BUILD-MANIFEST.json` pins 1.0.0 to `4f837be`. While `package.json` still says 1.0.0, any change to bundled source makes exactly these three tests fail:

- `test/release-dependency-verification.test.js`: "release validation accepts self-contained artifacts, rejects runtime @require, and rejects stale build provenance"
- `test/release-dependency-verification.test.js`: "release verification compares every direct support module byte-for-byte with committed local source"
- `test/review-artifact-verifier.test.js`: "immutable review verifier accepts the exact pinned candidate and rejects byte or provenance drift"

The brief puts the version bump in the final task, so Tasks 2–10 report `# fail 3` with exactly these names. Task 11 turns them green. Any other failure is a real failure.

Size check after any task: `npm run build >/dev/null && node scripts/size-report.js | head -8`.

## File Structure

| File | Responsibility |
| --- | --- |
| Create `scripts/size-report.js`, `test/size-report.test.js` | Lite core / legacy / whole measurement used by every gate (Task 1) |
| Create `docs/lite/ENGINE-NOTES.md` | Rationale comments moved out of Lite-core sources (Task 2) |
| Modify `src/platform.js`, `src/lite/*.js` | Comments removed (Task 2); one-line `dependency` (Task 4); `addStyle` removed (Task 4) |
| Modify `src/direct-api-client.js` | Lite core client: errors, `call`, everyday request/transaction endpoints (Task 3) |
| Create `src/panel-api-client.js` | Legacy panel API: runtime contract, bind, me, verification, Pro, invoices, account (Task 3) |
| Modify `scripts/client-modules.js` | `versioning` and `panel-api-client` become legacy (Task 3); telemetry removed (Task 5); `notify`/`badges` added (Tasks 8–9) |
| Delete `src/telemetry-client.js`, `test/telemetry-client.test.js`, `test/telemetry-integration.test.js` | Opt-in diagnostics removed (Task 5) |
| Modify `src/lite/scheduler.js`, `src/lite/engine.js` | Null-delay back-off, M1, M3, `onLiveSnapshot`, badge clear on session change (Task 6) |
| Modify `src/lite/state-client.js` | Badge LRU in GM storage, malformed-200 rejection, `reset` vs `clearBadges` (Task 7) |
| Create `src/lite/badges.js` | "RR verified" chip on visible profile pages (Task 8) |
| Create `src/lite/notify.js` | Event derivation, GM dedupe, settings, quiet hours, title fallback, chime (Task 9) |
| Modify `src/lite/boot.js` | Wires notifier and badges; exposes `notifier` (Tasks 8–9) |
| Modify `torn-revive-chat-collector.user.js` (MAIN) | Panel API (3), `addPanelStyle` (4), no telemetry (5), settings, update notice, invoice expiry, M2/M4/M5 (10) |
| Modify `test/helpers/fake-dom.js`, `test/helpers/main-harness.js` | Descendant selectors (8); panel API, no telemetry, singleton pill, notifier stub (3, 5, 10) |
| Modify docs: `PRIVACY.md`, `README.md`, `SECURITY.md`, `docs/review/ENDPOINT-INVENTORY.md`, `docs/review/REVIEW-CHECKLIST.md`, `CHANGELOG.md` | Diagnostics removed (5); 1.0.1 (11) |
| Modify `package.json`, `docs/review/BUILD-MANIFEST.json` | 1.0.1 and the re-pin (11) |

## Interfaces used across tasks

- `require('./scripts/size-report').measure(text) → { whole, liteCore, legacyPanel, main, liteCoreHeadroom, wholeHeadroom, modules }` (Task 1).
- `ReviveRelayDirectApiClient.createDirectApiClient(options)` returns `{ call(method, path, body?, { auth }?), setBoundToken(token), clearBoundToken(), createRequest, cancelRequest, getReviverQueue, acceptRequest, checkPayment, requestRetry, respondRetry, requestRefund, checkRefund }`. The module exports `{ DirectApiClientError, mapHttpError, safeParseBody, segment, createDirectApiClient }` (Task 3).
- `ReviveRelayPanelApiClient.createPanelApiClient(options)` returns the full 1.0.0 surface (minus `submitTelemetry` after Task 5). The module also exports `validateReviewRuntime(runtime, { clientVersion, releaseChannel })` (Task 3).
- `createLiteEngine({ ..., onLiveSnapshot: snapshot => void })`. The hook is called only when `isLeader()` and the freshness is `'live'`. The engine calls `api.clearBadges()` (when present) on expiry and session reset; `api.reset()` alone drops only the ETag (Task 6).
- `createStateClient({ ..., storage })`, with `BADGE_CACHE = { ttlMs: 600000, maxEntries: 200, key: 'reviverelay_badge_cache_v1' }`, returns `{ getState, getPlayerBadge, lastStateVersion, reset, clearBadges, badgeCacheSize }`. A badge 200 must have boolean `requesterVerified` and `reviverVerified` and `String(tornId)` equal to the requested id; otherwise it throws `INVALID_BADGE_RESPONSE` (retryable) and nothing is cached (Task 7).
- `ReviveRelayLiteBadges.createBadges({ document, window, api, enabled, slots? }) → { scan(): Promise<boolean> }`. Also exports `PROFILE_PATTERN`, `PROFILE_SLOTS` and `badgeText` (Task 8).
- `ReviveRelayLiteNotify.createNotifier({ storage, notify, window, now, chime? }) → { onSnapshot(snapshot): number, notifyOnce(id, text): boolean }`. Also exports `SEEN_KEY = 'reviverelay_notified_events_v1'`, `SETTINGS_KEY = 'reviverelay_notification_settings_v1'`, `EVENTS`, `allowed` and `playChime` (Task 9).
- Notification settings object (GM `reviverelay_notification_settings_v1`): `{ enabled?: boolean, sound?: boolean, quietFrom?: 0–23|null, quietTo?: 0–23|null, types?: { accepted, paymentVerified, revived, failed, refundResolved, paymentReceived, refundOwed, newRequest } }`. A missing value means on, except `types.newRequest`, which must be `true` (Task 9). MAIN writes the object once at boot when it is missing, seeded with `enabled` from the 0.7 `reviverelay_desktop_notifications_enabled` (Task 10).
- `createLiteBoot(...)` returns `{ ..., notifier }`; `BADGES_KEY = 'reviverelay_badges_enabled'`. Badges are enabled only while `getToken()` is non-empty and the toggle is not `false`; the boot re-scans on `visibilitychange` to visible (Tasks 8–9).

---

### Task 1: Size report script

The 3a size numbers came from an untracked script. Every trim and feature below needs the same measurement, so it becomes a tested script. This task does not change the bundle.

**Files:**
- Create: `scripts/size-report.js`
- Test: `test/size-report.test.js`

**Interfaces:**
- Produces: `measure(text)`, `artifactText(version?)`, `LITE_CORE_BUDGET_BYTES = 110000`, `WHOLE_BUNDLE_CEILING_BYTES = 232000`.

- [ ] **Step 1: Write the failing test**
<!-- op:file test/size-report.test.js -->
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { measure, artifactText, LITE_CORE_BUDGET_BYTES, WHOLE_BUNDLE_CEILING_BYTES } = require('../scripts/size-report');
const { DIRECT_SUPPORT_MODULES, LEGACY_PANEL_MODULES } = require('../scripts/client-modules');

test('measure splits a bundle into the Lite core and the legacy panel', () => {
  const block = (modulePath, body) => `/* ReviveRelay bundled module: ${modulePath} */\n${body}\n/* ReviveRelay end bundled module: ${modulePath} */`;
  const text = `// header\n\n${DIRECT_SUPPORT_MODULES.map(modulePath => block(modulePath, LEGACY_PANEL_MODULES.includes(modulePath) ? 'legacy();' : 'core();')).join('\n\n')}\n(function main(){})();\n`;
  const sizes = measure(text);
  assert.equal(sizes.whole, Buffer.byteLength(text));
  assert.equal(sizes.main, Buffer.byteLength('\n(function main(){})();\n'));
  assert.equal(sizes.liteCore + sizes.legacyPanel, sizes.whole);
  assert.equal(sizes.liteCoreHeadroom, LITE_CORE_BUDGET_BYTES - sizes.liteCore);
  assert.equal(Object.keys(sizes.modules).length, DIRECT_SUPPORT_MODULES.length);
});

test('the real build is measured against the unchanged gates', () => {
  const sizes = measure(artifactText());
  assert.equal(LITE_CORE_BUDGET_BYTES, 110000);
  assert.equal(WHOLE_BUNDLE_CEILING_BYTES, 232000);
  assert.ok(sizes.liteCoreHeadroom >= 0, JSON.stringify(sizes));
  assert.ok(sizes.wholeHeadroom >= 0, JSON.stringify(sizes));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/size-report.test.js`
Expected: FAIL, `Cannot find module '../scripts/size-report'`.

- [ ] **Step 3: Write the script**
<!-- op:file scripts/size-report.js -->
```js
'use strict';

// Lite core and whole-bundle sizes of a built ReviveRelay artifact (spec decision 14).
// Lite core = the whole file minus the legacy 0.7 panel (MAIN's IIFE and LEGACY_PANEL_MODULES).
const fs = require('node:fs');
const path = require('node:path');
const { DIRECT_SUPPORT_MODULES, LEGACY_PANEL_MODULES } = require('./client-modules');

const root = path.resolve(__dirname, '..');
const LITE_CORE_BUDGET_BYTES = 110000;
const WHOLE_BUNDLE_CEILING_BYTES = 232000;

function blockBytes(text, relativePath) {
  const startMarker = `/* ReviveRelay bundled module: ${relativePath} */`;
  const endMarker = `/* ReviveRelay end bundled module: ${relativePath} */`;
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  if (start < 0 || end < start) throw new Error(`module not bundled: ${relativePath}`);
  return Buffer.byteLength(text.slice(start, end + endMarker.length));
}

function measure(text) {
  const lastEnd = `/* ReviveRelay end bundled module: ${DIRECT_SUPPORT_MODULES[DIRECT_SUPPORT_MODULES.length - 1]} */`;
  const mainStart = text.indexOf(lastEnd);
  if (mainStart < 0) throw new Error('bundle has no module section');
  const main = Buffer.byteLength(text.slice(mainStart + lastEnd.length));
  const modules = {};
  for (const modulePath of DIRECT_SUPPORT_MODULES) modules[modulePath] = blockBytes(text, modulePath);
  const legacyPanel = main + LEGACY_PANEL_MODULES.reduce((sum, modulePath) => sum + modules[modulePath], 0);
  const whole = Buffer.byteLength(text);
  const liteCore = whole - legacyPanel;
  return {
    whole,
    liteCore,
    legacyPanel,
    main,
    liteCoreHeadroom: LITE_CORE_BUDGET_BYTES - liteCore,
    wholeHeadroom: WHOLE_BUNDLE_CEILING_BYTES - whole,
    modules
  };
}

function artifactText(version = require('../package.json').version) {
  return fs.readFileSync(path.join(root, 'dist', 'review', `ReviveRelay-${version}.user.js`), 'utf8');
}

if (require.main === module) console.log(JSON.stringify(measure(artifactText()), null, 2));

module.exports = { LITE_CORE_BUDGET_BYTES, WHOLE_BUNDLE_CEILING_BYTES, measure, artifactText };
```

- [ ] **Step 4: Run the test and the report**

Run: `node --test test/size-report.test.js && node scripts/size-report.js | head -8`
Expected: `# pass 2`; then `"whole": 230507`, `"liteCore": 109665`, `"liteCoreHeadroom": 335`, `"wholeHeadroom": 1493`.

Run: `node --test test 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 625`, `# fail 0`.

- [ ] **Step 5: Commit**
```bash
git add scripts/size-report.js test/size-report.test.js
git commit -m "build: tested Lite core and whole-bundle size report" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 2: Move Lite-core comments into `docs/lite/ENGINE-NOTES.md` (−4,460 B core and whole)

**Why this is allowed:**
- `scripts/build.js` does not strip comments.
- The byte-identical rule (`release-client.js validateBundledModuleBytes`, `test/bundle-size.test.js`) compares each bundled module with its source file. A source without comments stays byte-identical.
- The only source hash lock is `src/core.js` (`test/bootstrap-controls.test.js`). That file is legacy, has no comments, and is not touched.
- The 0.4.5 baseline locks cover only files outside the Lite core.

The rationale is kept: every removed comment is written to the notes file, next to the code line it described.

**Files:**
- Modify: `src/platform.js`, `src/direct-api-client.js` (no comments; unchanged), `src/lite/*.js`
- Create: `docs/lite/ENGINE-NOTES.md` (generated)
- Test: `test/lite-bundle.test.js` (guard)

**Interfaces:** none.

- [ ] **Step 1: Write the failing guard test**

Append to `test/lite-bundle.test.js`:
<!-- op:append test/lite-bundle.test.js -->
```js
test('Lite-core sources carry no comments; their rationale lives in docs/lite/ENGINE-NOTES.md', () => {
  for (const modulePath of [...LITE_ENGINE_MODULES, 'src/platform.js', 'src/direct-api-client.js']) {
    const source = read(modulePath);
    assert.doesNotMatch(source, /^\s*\/\//m, modulePath);
    assert.doesNotMatch(source, /[;{},)\]] \/\/ /, modulePath);
    assert.doesNotMatch(source, /\/\*/, modulePath);
  }
  assert.match(read('docs/lite/ENGINE-NOTES.md'), /^# ReviveRelay Lite engine notes/);
});
```

Run: `node --test test/lite-bundle.test.js`
Expected: FAIL on `src/lite/pill-state.js` (the first module with a comment line).

- [ ] **Step 2: Move the comments with a one-off script (not committed)**

Save as `/tmp/rr-strip-lite-comments.js`:
```js
const fs = require('node:fs');
const path = require('node:path');
const files = process.argv.slice(2);
const notes = ['# ReviveRelay Lite engine notes', '',
  'Rationale comments moved out of the Lite-core sources in Plan 3b (owner decision 2026-11-26: the',
  '110 KB Lite core budget is met by trimming, never by raising the gate; bundled modules stay',
  'byte-identical to their sources, so comments cost bundle bytes). Each note names the code line it',
  'described, as that line now reads.', ''];
let total = 0;
const unquoted = prefix => ['\'', '"', '`'].every(q => (prefix.split(q).length - 1) % 2 === 0);
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const out = [];
  const pending = [];
  const fileNotes = [];
  for (const line of lines) {
    if (/^\s*\/\//.test(line)) { pending.push(line.trim().replace(/^\/\/\s?/, '')); continue; }
    if (/^\s*\/\*.*\*\/\s*$/.test(line)) { pending.push(line.trim().replace(/^\/\*\s?|\s?\*\/$/g, '')); continue; }
    let code = line;
    const trailing = line.search(/[;{},)\]] \/\/ /);
    if (trailing >= 0 && unquoted(line.slice(0, trailing + 1))) {
      pending.push(line.slice(trailing + 2).trim().replace(/^\/\/\s?/, ''));
      code = line.slice(0, trailing + 1);
    }
    const block = code.match(/^(.*?) \/\* ([^*]*) \*\/(.*)$/);
    if (block && unquoted(block[1])) {
      pending.push(block[2].trim());
      code = `${block[1]} ${block[3].trimStart()}`.replace(/\{\s+\}/, '{ }');
    }
    if (pending.length && code.trim()) {
      fileNotes.push(`- \`${code.trim().slice(0, 100)}\`: ${pending.join(' ')}`);
      pending.length = 0;
    }
    out.push(code);
  }
  const result = out.join('\n');
  const saved = Buffer.byteLength(source) - Buffer.byteLength(result);
  total += saved;
  fs.writeFileSync(file, result);
  if (fileNotes.length) notes.push(`## ${file}`, '', ...fileNotes, '');
  console.log(`${file} ${saved}`);
}
fs.mkdirSync('docs/lite', { recursive: true });
fs.writeFileSync('docs/lite/ENGINE-NOTES.md', `${notes.join('\n').trimEnd()}\n`);
console.log(`total ${total}`);
```
Run: `node /tmp/rr-strip-lite-comments.js src/platform.js src/direct-api-client.js src/lite/*.js`
Expected, line by line:

```text
src/platform.js 169
src/direct-api-client.js 0
src/lite/boot.js 341
src/lite/engine.js 1745
src/lite/icons.js 246
src/lite/pill-state.js 764
src/lite/pill-view.js 142
src/lite/scheduler.js 261
src/lite/snapshot-cache.js 44
src/lite/state-client.js 0
src/lite/tab-leader.js 748
src/lite/tokens.js 0
total 4460
```

The script keeps the code on each line and only drops the comment. For example, `try { onChange(value); } catch (_) { /* listener errors never break election */ }` becomes `try { onChange(value); } catch (_) { }`.

- [ ] **Step 3: Check that nothing but comments changed**

Run: `git diff -U0 src | grep -c '^+[^+]'`
Expected: `23`. These are the lines that lost a trailing comment but kept their code; every other changed line is a deleted comment line.

Run: `git diff -U0 src | grep '^+[^+]' | grep -E '//|/\*'`
Expected: no output.

Run: `npm run build >/dev/null && node --test test 2>&1 | grep -E '^# (pass|fail)' && node scripts/size-report.js | head -3`
Expected: `# pass 623`, `# fail 3` (the known trio; the new guard passes); `"whole": 226047`, `"liteCore": 105205`.

- [ ] **Step 4: Commit**
```bash
git add src docs/lite/ENGINE-NOTES.md test/lite-bundle.test.js
git commit -m "build: move Lite-core comments to docs/lite/ENGINE-NOTES.md (-4460 B)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 3: Panel-only API out of the Lite core (−5,389 B core)

**Grep evidence.** Only MAIN (the legacy panel) uses the panel-only endpoints. `grep -n "state.api\.\w*" torn-revive-chat-collector.user.js` lists `bind`, `getMe`, `submitTelemetry`, `getVerificationCredential`, `bindVerificationCredential`, `revokeVerificationCredential`, `getReviverEligibility`, `registerReviver`, `getActiveRequest`, `getTransaction`, `getProStatus`, `startProTrial`, `createProInvoice`, `getProInvoice` and `deleteAccount`. No `src/lite/*` file calls any of them: `grep -rn "getMe\|getProStatus\|bind(\|deleteAccount\|getTransaction\|getActiveRequest" src/lite` is empty.

**Versioning moves too.** `src/versioning.js` has two users: `validateReviewRuntime` (MAIN only, `torn-revive-chat-collector.user.js:271`) and `src/update-manager.js`, which is already legacy. So it becomes a legacy module as well.

The Lite core keeps `DirectApiClientError`, `mapHttpError`, `safeParseBody` and the everyday request/transaction calls, which a future requester/reviver sheet needs.

**Files:**
- Modify: `src/direct-api-client.js` (full replacement below)
- Create: `src/panel-api-client.js`
- Modify: `scripts/client-modules.js`, `torn-revive-chat-collector.user.js`, `test/helpers/main-harness.js`
- Modify: `test/direct-api-client.test.js`, `test/telemetry-integration.test.js`, `test/review-runtime-compatibility.test.js`, `test/direct-only-build.test.js`

**Interfaces:**
- Produces: see "Interfaces used across tasks" (core client, `createPanelApiClient`, `validateReviewRuntime` now on the panel module).

- [ ] **Step 1: Write the failing test**

Append to `test/direct-api-client.test.js`:
<!-- op:append test/direct-api-client.test.js -->
```js
test('the Lite core client carries only the everyday request and transaction endpoints', () => {
  const direct = require('../src/direct-api-client');
  const core = direct.createDirectApiClient({ baseUrl: 'https://reviverelay.example', request: async () => ({ status: 200, body: {} }) });
  assert.deepEqual(Object.keys(core).sort(), [
    'acceptRequest', 'call', 'cancelRequest', 'checkPayment', 'checkRefund', 'clearBoundToken',
    'createRequest', 'getReviverQueue', 'requestRefund', 'requestRetry', 'respondRetry', 'setBoundToken'
  ]);
  assert.equal(direct.validateReviewRuntime, undefined);
  assert.equal(typeof require('../src/panel-api-client').validateReviewRuntime, 'function');
});
```
Then switch the existing tests in that file to the panel client (it keeps the 1.0.0 surface):
```bash
sed -i "s#require('../src/direct-api-client')#require('../src/panel-api-client')#; s#direct\.createDirectApiClient#direct.createPanelApiClient#" test/direct-api-client.test.js
```
That sed also rewrites the line in the new test, so put it back:
<!-- op:find test/direct-api-client.test.js -->
Find (inside the new test only):
```js
  const direct = require('../src/panel-api-client');
  const core = direct.createPanelApiClient({ baseUrl: 'https://reviverelay.example', request: async () => ({ status: 200, body: {} }) });
```
<!-- op:replace -->
Replace with:
```js
  const direct = require('../src/direct-api-client');
  const core = direct.createDirectApiClient({ baseUrl: 'https://reviverelay.example', request: async () => ({ status: 200, body: {} }) });
```

Run: `node --test test/direct-api-client.test.js`
Expected: FAIL, `Cannot find module '../src/panel-api-client'`.

- [ ] **Step 2: Replace `src/direct-api-client.js`**
<!-- op:file src/direct-api-client.js -->
```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayDirectApiClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,79}$/;
  const SAFE_DETAIL_KEYS = Object.freeze(['error', 'latestVersion', 'minimumVersion', 'installUrl', 'state', 'missing']);

  class DirectApiClientError extends Error {
    constructor(code, options = {}) {
      super(code);
      this.name = 'DirectApiClientError';
      this.code = code;
      this.status = Number(options.status) || 0;
      this.retryable = Boolean(options.retryable);
      this.details = options.details || null;
    }
  }

  function normalizeBaseUrl(value) {
    const baseUrl = String(value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('A valid ReviveRelay baseUrl is required');
    return baseUrl;
  }

  function safeParseBody(response) {
    if (response && response.body && typeof response.body === 'object') return response.body;
    const raw = response && typeof response.responseText === 'string' ? response.responseText : '';
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }

  function safeErrorCode(body) {
    const value = body && typeof body.error === 'string' ? body.error.trim() : '';
    return SAFE_ERROR_CODE.test(value) ? value : '';
  }

  function safeDetails(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    const result = {};
    for (const key of SAFE_DETAIL_KEYS) {
      const value = body[key];
      if (key === 'error') {
        const code = safeErrorCode(body);
        if (code) result.error = code;
        continue;
      }
      if (typeof value === 'string' && value.length <= 500) result[key] = value;
      else if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
      else if (typeof value === 'boolean') result[key] = value;
      else if (Array.isArray(value)) {
        const bounded = value.slice(0, 32).filter(item => typeof item === 'string' && item.length <= 160);
        if (bounded.length) result[key] = bounded;
      }
    }
    return result;
  }

  function fallbackHttpCode(status) {
    if (status === 401) return 'AUTH_REQUIRED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 409) return 'CONFLICT';
    if (status === 422) return 'INVALID_REQUEST';
    if (status === 426) return 'CLIENT_UPDATE_REQUIRED';
    if (status === 429) return 'RATE_LIMITED';
    if (status >= 500) return 'SERVER_UNAVAILABLE';
    return 'REQUEST_FAILED';
  }

  function mapHttpError(status, body) {
    const serverCode = safeErrorCode(body);
    const retryable = status === 429 || status >= 500;
    return new DirectApiClientError(serverCode || fallbackHttpCode(status), {
      status,
      retryable,
      details: safeDetails(body)
    });
  }

  function segment(id) {
    return encodeURIComponent(String(id || ''));
  }

  function createDirectApiClient({ baseUrl, getToken = () => '', request, clientVersion = '', releaseChannel = '' }) {
    const normalizedBase = normalizeBaseUrl(baseUrl);
    if (typeof request !== 'function') throw new Error('request transport is required');
    const readStoredToken = typeof getToken === 'function' ? getToken : () => '';
    let boundToken = '';

    async function call(method, path, body, options = {}) {
      const headers = {
        Accept: 'application/json',
        'X-ReviveRelay-Version': String(clientVersion || ''),
        'X-ReviveRelay-Channel': String(releaseChannel || '')
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (options.auth !== false) {
        const token = String(boundToken || readStoredToken() || '').trim();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      let response;
      try {
        response = await request({ method, url: `${normalizedBase}${path}`, headers, body });
      } catch (error) {
        if (error instanceof DirectApiClientError) throw error;
        throw new DirectApiClientError('NETWORK_ERROR', { retryable: true });
      }
      const status = Number(response && response.status) || 0;
      const responseBody = safeParseBody(response);
      if (status >= 200 && status < 300) return responseBody;
      throw mapHttpError(status, responseBody);
    }

    return Object.freeze({
      call,
      setBoundToken(token) { boundToken = String(token || ''); },
      clearBoundToken() { boundToken = ''; },
      createRequest(preset) { return call('POST', '/v1/requests', preset); },
      cancelRequest(requestId) { return call('POST', `/v1/requests/${segment(requestId)}/cancel`); },
      getReviverQueue() { return call('GET', '/v1/reviver/queue'); },
      acceptRequest(requestId) { return call('POST', `/v1/requests/${segment(requestId)}/accept`); },
      checkPayment(transactionId) { return call('POST', `/v1/transactions/${segment(transactionId)}/check-payment`); },
      requestRetry(transactionId) { return call('POST', `/v1/transactions/${segment(transactionId)}/retry-request`); },
      respondRetry(transactionId, decision) {
        if (!['accept', 'decline'].includes(decision)) throw new DirectApiClientError('INVALID_RETRY_DECISION');
        return call('POST', `/v1/transactions/${segment(transactionId)}/retry-response`, { decision });
      },
      requestRefund(transactionId) { return call('POST', `/v1/transactions/${segment(transactionId)}/request-refund`); },
      checkRefund(transactionId) { return call('POST', `/v1/transactions/${segment(transactionId)}/check-refund`); }
    });
  }

  return {
    DirectApiClientError,
    mapHttpError,
    safeParseBody,
    segment,
    createDirectApiClient
  };
});
```

- [ ] **Step 3: Create `src/panel-api-client.js`**
<!-- op:file src/panel-api-client.js -->
```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayPanelApiClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Endpoints only the legacy 0.7 panel uses (setup, Pro, invoices, account).
  // Measured with the legacy panel, outside the Lite core size budget.
  const PLAN_IDS = Object.freeze(['monthly', 'six_months', 'yearly']);
  const PRO_CURRENCIES = Object.freeze(['xanax', 'cash']);
  const ACCOUNT_DELETE_CONFIRMATION = 'DELETE REVIVERELAY ACCOUNT';

  function dependency(globalName, path) {
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
    if (typeof require === 'function') return require(path);
    throw new Error(`${globalName} unavailable`);
  }

  function incompatibleRuntime(reason) {
    return Object.freeze({ compatible:false, reason, subscription:null });
  }

  function validateReviewRuntime(runtime, { clientVersion = '', releaseChannel = '' } = {}) {
    if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
      return incompatibleRuntime('RUNTIME_MISSING');
    }
    if (releaseChannel !== 'review') return incompatibleRuntime('CLIENT_CHANNEL_INVALID');
    if (runtime.releaseChannel !== 'review') return incompatibleRuntime('RUNTIME_CHANNEL_MISMATCH');

    const subscription = runtime.subscription;
    if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription) ||
        !['free','review','live'].includes(subscription.mode)) {
      return incompatibleRuntime('RUNTIME_SUBSCRIPTION_INVALID');
    }

    try {
      const { compareVersions } = dependency('ReviveRelayVersioning', './versioning');
      compareVersions(runtime.serverVersion, '0.0.0');
      compareVersions(runtime.minimumClientVersion, '0.0.0');
      compareVersions(clientVersion, '0.0.0');
      if (compareVersions(clientVersion, runtime.minimumClientVersion) < 0) {
        return incompatibleRuntime('CLIENT_TOO_OLD');
      }
    } catch (_) {
      return incompatibleRuntime('RUNTIME_VERSION_INVALID');
    }

    return Object.freeze({ compatible:true, reason:null, subscription });
  }

  function validateInvoiceSelection(selection, DirectApiClientError) {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      throw new DirectApiClientError('INVALID_INVOICE_SELECTION');
    }
    const keys = Object.keys(selection).sort();
    if (keys.length !== 2 || keys[0] !== 'currency' || keys[1] !== 'planId') {
      throw new DirectApiClientError('INVALID_INVOICE_SELECTION');
    }
    if (!PLAN_IDS.includes(selection.planId) || !PRO_CURRENCIES.includes(selection.currency)) {
      throw new DirectApiClientError('INVALID_INVOICE_SELECTION');
    }
    return { planId: selection.planId, currency: selection.currency };
  }

  function validateInvoiceId(invoiceId, DirectApiClientError) {
    const normalized = String(invoiceId || '').trim();
    if (!normalized) throw new DirectApiClientError('INVALID_INVOICE_ID');
    return normalized;
  }

  // The 0.7 panel's full API surface: the Lite core client plus the panel-only endpoints.
  function createPanelApiClient(options = {}) {
    const Direct = dependency('ReviveRelayDirectApiClient', './direct-api-client');
    const { DirectApiClientError, segment } = Direct;
    const { call, setBoundToken, ...everyday } = Direct.createDirectApiClient(options);
    const clientVersion = options.clientVersion || '';
    return Object.freeze({
      ...everyday,
      async bind(apiKey, version = clientVersion) {
        const result = await call('POST', '/v1/auth/bind', { apiKey: String(apiKey || ''), clientVersion: String(version || '') }, { auth: false });
        if (result && result.token) setBoundToken(result.token);
        return result;
      },
      getMe() { return call('GET', '/v1/me'); },
      submitTelemetry(errors) { return call('POST', '/v1/telemetry/errors', { errors: Array.isArray(errors) ? errors : [] }); },
      getActiveRequest() { return call('GET', '/v1/requests/active'); },
      getVerificationCredential() { return call('GET', '/v1/verification-credential'); },
      bindVerificationCredential(apiKey) { return call('POST', '/v1/verification-credential', { apiKey: String(apiKey || '') }); },
      revokeVerificationCredential() { return call('POST', '/v1/verification-credential/revoke'); },
      getReviverEligibility() { return call('GET', '/v1/reviver/eligibility'); },
      registerReviver() { return call('POST', '/v1/reviver/register'); },
      getTransaction(transactionId) { return call('GET', `/v1/transactions/${segment(transactionId)}`); },
      getProStatus() { return call('GET', '/v1/pro/status'); },
      startProTrial() { return call('POST', '/v1/pro/trial'); },
      async createProInvoice(selection) {
        return call('POST', '/v1/pro/invoices', validateInvoiceSelection(selection, DirectApiClientError));
      },
      async getProInvoice(invoiceId) {
        return call('GET', `/v1/pro/invoices/${encodeURIComponent(validateInvoiceId(invoiceId, DirectApiClientError))}`);
      },
      deleteAccount() { return call('POST', '/v1/account/delete', { confirm: ACCOUNT_DELETE_CONFIRMATION }); }
    });
  }

  return Object.freeze({ validateReviewRuntime, createPanelApiClient });
});
```

- [ ] **Step 4: Bundle it as legacy and point MAIN at it**
<!-- op:find scripts/client-modules.js -->
Find:
```js
const LEGACY_PANEL_MODULES = Object.freeze([
  'src/core.js',
  'src/update-manager.js',
```
<!-- op:replace -->
Replace with:
```js
const LEGACY_PANEL_MODULES = Object.freeze([
  'src/core.js',
  'src/versioning.js',
  'src/panel-api-client.js',
  'src/update-manager.js',
```
<!-- op:find scripts/client-modules.js -->
Find:
```js
  'src/versioning.js',
  'src/update-manager.js',
```
<!-- op:replace -->
Replace with:
```js
  'src/versioning.js',
  'src/panel-api-client.js',
  'src/update-manager.js',
```
In `torn-revive-chat-collector.user.js`, make these edits:

| Find | Replace with |
| --- | --- |
| `  const DirectApiClient = globalThis.ReviveRelayDirectApiClient;` | the same line, then a new line `  const PanelApiClient = globalThis.ReviveRelayPanelApiClient;` |
| `if (!Platform \|\| !Core \|\| !DirectApiClient \|\| !UpdateManager` | `if (!Platform \|\| !Core \|\| !DirectApiClient \|\| !PanelApiClient \|\| !UpdateManager` |
| `state.api = DirectApiClient.createDirectApiClient({` | `state.api = PanelApiClient.createPanelApiClient({` |
| `const result = DirectApiClient.validateReviewRuntime(runtime, {` | `const result = PanelApiClient.validateReviewRuntime(runtime, {` |

In `test/helpers/main-harness.js`:

- after `const DirectApiClient = require('../../src/direct-api-client');`, add `const PanelApiClient = require('../../src/panel-api-client');`;
- after `    ReviveRelayDirectApiClient: DirectApiClient,`, add `    ReviveRelayPanelApiClient: PanelApiClient,`.

- [ ] **Step 5: Update the inventory and import tests**

In `test/direct-only-build.test.js`:
<!-- op:find test/direct-only-build.test.js -->
Find:
```js
  'src/versioning.js',
  'src/update-manager.js',
```
<!-- op:replace -->
Replace with:
```js
  'src/versioning.js',
  'src/panel-api-client.js',
  'src/update-manager.js',
```
<!-- op:find test/direct-only-build.test.js -->
Find:
```js
  assert.deepEqual([...LEGACY_PANEL_MODULES], ['src/core.js', 'src/update-manager.js', 'src/telemetry-client.js', 'src/request-preset.js']);
```
<!-- op:replace -->
Replace with:
```js
  assert.deepEqual([...LEGACY_PANEL_MODULES], ['src/core.js', 'src/versioning.js', 'src/panel-api-client.js', 'src/update-manager.js', 'src/telemetry-client.js', 'src/request-preset.js']);
```
In `test/review-runtime-compatibility.test.js`, replace `require('../src/direct-api-client')` with `require('../src/panel-api-client')`.

In `test/telemetry-integration.test.js`, replace `const { createDirectApiClient } = require('../src/direct-api-client');` with `const { createPanelApiClient: createDirectApiClient } = require('../src/panel-api-client');`.

- [ ] **Step 6: Run everything**

Run: `npm run build >/dev/null && node --test test 2>&1 | grep -E '^# (pass|fail)' && node scripts/size-report.js | head -3`
Expected: `# pass 624`, `# fail 3` (known trio); `"whole": 227310`, `"liteCore": 99816`.

- [ ] **Step 7: Commit**
```bash
git add src/direct-api-client.js src/panel-api-client.js scripts/client-modules.js torn-revive-chat-collector.user.js test
git commit -m "refactor: move panel-only API and versioning out of the Lite core (-5389 B core)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 4: Collapse duplicated helpers and drop dead code (−1,581 B core)

**Grep evidence for each change:**

- **`dependency()`.** It was copied verbatim in `src/lite/engine.js`, `pill-view.js` and `boot.js`. In the bundle the globals always exist (the modules load in order). Under Node, `require` exists. The `throw … unavailable` branch is unreachable, and `grep -rn "unavailable" test/lite-*.js` is empty.
- **`directApi()` and `parseBody()` in `src/lite/state-client.js`.** They duplicate `direct-api-client.js`'s lookup and `safeParseBody` byte for byte (`diff <(sed -n '/function parseBody/,/^  }/p' src/lite/state-client.js) <(sed -n '/function safeParseBody/,/^  }/p' src/direct-api-client.js)` differs only in the name). `safeParseBody` is exported since Task 3.
- **`defaultTabId()` in `src/lite/tab-leader.js`.** It is dead: `grep -rn "createTabLeader(" src` shows one caller, `engine.js`, which always passes `tabId`, and tests always pass it too.
- **`platform.addStyle`.** Only the legacy panel uses it: `grep -rn "addStyle" src torn-revive-chat-collector.user.js` shows only `platform.js` and MAIN's `createPanel`. It moves into MAIN as `addPanelStyle`.

**Files:**
- Modify: `src/lite/engine.js`, `src/lite/pill-view.js`, `src/lite/boot.js`, `src/lite/state-client.js`, `src/lite/tab-leader.js`, `src/platform.js`, `torn-revive-chat-collector.user.js`
- Test: `test/platform.test.js`

**Interfaces:** none new. `createTabLeader` now requires `tabId`.

- [ ] **Step 1: Write the failing test**

Append to `test/platform.test.js`:
<!-- op:append test/platform.test.js -->
```js
test('the platform has no panel-only addStyle; MAIN styles its own panel', () => {
  const platform = Platform.createPlatform({ globalObject: {}, window: null, document: null, gm: { xmlHttpRequest: () => {} } });
  assert.equal('addStyle' in platform, false);
  const main = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');
  assert.match(main, /function addPanelStyle\(css\)/);
  assert.doesNotMatch(main, /platform\.addStyle/);
});
```
Run: `node --test test/platform.test.js`
Expected: FAIL, `true !== false` ('addStyle' is still in the platform).

- [ ] **Step 2: One-line `dependency` in three modules**

In each of `src/lite/engine.js`, `src/lite/pill-view.js` and `src/lite/boot.js`:
<!-- op:find src/lite/engine.js src/lite/pill-view.js src/lite/boot.js -->
Find:
```js
  function dependency(globalName, path) {
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
    if (typeof require === 'function') return require(path);
    throw new Error(`${globalName} unavailable`);
  }
```
<!-- op:replace -->
Replace with:
```js
  const dependency = (globalName, path) => globalThis[globalName] || require(path);
```

- [ ] **Step 3: State client reuses the direct client's helpers**
<!-- op:find src/lite/state-client.js -->
In `src/lite/state-client.js`, replace everything from `  function directApi() {` up to (not including) `  function createStateClient(` with:
```js

  const directApi = () => globalThis.ReviveRelayDirectApiClient || require('../direct-api-client');

  function clientError(code, options) {
    const { DirectApiClientError } = directApi();
    return new DirectApiClientError(code, options);
  }

```
Then replace both `parseBody(response)` calls with `directApi().safeParseBody(response)`.

- [ ] **Step 4: Remove the dead tab id default**
<!-- op:find src/lite/tab-leader.js -->
Delete:
```js
  function defaultTabId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

```
and change `    tabId = defaultTabId(),` to `    tabId,`.

- [ ] **Step 5: `addStyle` leaves the platform for MAIN**
<!-- op:find src/platform.js -->
In `src/platform.js`, delete:
```js
    function addStyle(css) {
      if (typeof gm.addStyle === 'function') return gm.addStyle(css);
      if (!document || !document.head) return null;
      const style = document.createElement('style');
      style.textContent = String(css || '');
      document.head.appendChild(style);
      return style;
    }

```
and change
```js
      notify,
      addStyle,
      openUrl,
```
to
```js
      notify,
      openUrl,
```
In `torn-revive-chat-collector.user.js`:

- delete the line `      addStyle: typeof GM_addStyle === 'function' ? GM_addStyle : null,`;
- change `    platform.addStyle(\`` to `    addPanelStyle(\``;
- insert this before `  function createPanel() {`:
```js
  // Panel-only: GM_addStyle, or a <style> in <head>.
  function addPanelStyle(css) {
    if (typeof GM_addStyle === 'function') return GM_addStyle(css);
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return style;
  }

```

- [ ] **Step 6: Run everything**

Run: `npm run build >/dev/null && node --test test 2>&1 | grep -E '^# (pass|fail)' && node scripts/size-report.js | head -3`
Expected: `# pass 625`, `# fail 3` (known trio); `"liteCore": 98235`.

- [ ] **Step 7: Commit**
```bash
git add src torn-revive-chat-collector.user.js test/platform.test.js
git commit -m "refactor: collapse duplicated Lite helpers, drop dead tab-id default, move addStyle to the panel (-1581 B core)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 5: Remove opt-in client telemetry (−9,991 B whole)

**Sanction and behaviour change.**

- Sanction: the owner's Plan 3b brief lists "slim or remove telemetry … from the Lite path" as a trim candidate. Telemetry is already outside the Lite core; removing it is what pays for the features in the **whole** file (1,493 B headroom at baseline).
- The change: the Settings "Diagnostics / Advanced" opt-in (off by default) disappears, and 1.0.1 never calls `POST /v1/telemetry/errors`. The server endpoint stays for 0.7.x clients.
- Privacy improves (strictly less data leaves the browser), and the docs are updated in this task.

**Update manager stays.** It is kept on purpose: it carries the 0.7.2 security guarantees (metadata, origin, channel and URL validation before any installer hand-off). Task 10 reuses its result for the "update available" notice.

**Grep evidence.** `grep -rn "TelemetryClient\|captureClientError\|clientDiagnosticsEnabled\|submitTelemetry" src torn-revive-chat-collector.user.js` shows MAIN, `panel-api-client.js` and `telemetry-client.js` only. No Lite module uses telemetry.

**Files:**
- Delete: `src/telemetry-client.js`, `test/telemetry-client.test.js`, `test/telemetry-integration.test.js`
- Modify: `scripts/client-modules.js`, `src/panel-api-client.js`, `torn-revive-chat-collector.user.js`, `test/helpers/main-harness.js`
- Modify tests: `test/bootstrap-controls.test.js`, `test/direct-only-build.test.js`, `test/direct-api-client.test.js`, `test/autosync.test.js`, `test/main-panel-glue.test.js`, `test/client-privacy.test.js`, `test/requester-ui.test.js`, `test/subscription-mode-ui.test.js`, `test/update-ui.test.js`
- Modify docs: `PRIVACY.md`, `README.md`, `SECURITY.md`, `docs/review/ENDPOINT-INVENTORY.md`, `docs/review/REVIEW-CHECKLIST.md`

**Interfaces:** `createPanelApiClient` loses `submitTelemetry`.

- [ ] **Step 1: Turn the tests to the new behaviour (they fail first)**

| File | Change |
| --- | --- |
| `test/main-panel-glue.test.js` | In "a failed init is reported and retried…": replace `store: { ...SIGNED_IN, reviverelay_client_diagnostics_enabled: true },` with `store: { ...SIGNED_IN },` and delete the line `  assert.deepEqual(harness.telemetry.map(entry => entry.meta.operation), ['init']);`. In "a Lite boot that throws is retried once on pageshow": replace `assert.equal(harness.window.count('error'), 1, 'global error hooks are installed once');` with `assert.equal(harness.window.count('error'), 0, '1.0.1 sends no diagnostics, so it installs no global error hooks');` |
| `test/direct-api-client.test.js` | In `REQUIRED_METHODS`, delete `'submitTelemetry',`. Delete `  await api.submitTelemetry([]);` and `    ['POST', '/v1/telemetry/errors'],`. Change `calls[16].body` → `calls[15].body`, `calls[21].body` → `calls[20].body`, `calls[23].body` → `calls[22].body` |
| `test/bootstrap-controls.test.js` | `!['src/update-manager.js','src/versioning.js','src/core.js'].includes(relativePath)` → `!['src/update-manager.js','src/versioning.js','src/core.js','src/telemetry-client.js'].includes(relativePath)` (the 0.4.5 lock no longer applies to a deleted file) |
| `test/direct-only-build.test.js` | Delete `  'src/telemetry-client.js',` from `REQUIRED`. Add `'src/telemetry-client.js'` to the end of `FORBIDDEN` (after `'src/sidebar-action.js'`, adding a comma). Delete `'src/telemetry-client.js', ` from the `LEGACY_PANEL_MODULES` expectation |
| `test/autosync.test.js` | Delete `'state.telemetry.drain()',` from the token list |
| `test/client-privacy.test.js` | Delete the whole test "client telemetry sanitizes API keys, bearer tokens, cookies and unsafe context fields" (its module is removed) |
| `test/requester-ui.test.js` | In "Settings is a collapsible drawer…", replace `['Revive Me preset', 'Torn API Key', 'Notifications', 'Updates', 'Diagnostics / Advanced']` with `['Revive Me preset', 'Torn API Key', 'Notifications', 'Updates']` |
| `test/subscription-mode-ui.test.js` | `  assert.match(handler,/captureClientError/);` → `  assert.doesNotMatch(handler,/captureClientError\|telemetry/);` |
| `test/update-ui.test.js` | `assert.match(source,/checkUpdates\(false\)\.catch\(error => captureClientError\(error, 'update\.initial'\)\)/);` → `assert.match(source,/checkUpdates\(false\)\.catch\(\(\) => \{\}\)/);` |

Delete the two telemetry test files: `git rm test/telemetry-client.test.js test/telemetry-integration.test.js`.

In `test/helpers/main-harness.js`:

- delete `    telemetry: [],`;
- delete the `ReviveRelayTelemetryClient: { … },` entry (three lines).

Run: `node --test test 2>&1 | grep -E '^not ok' | head -20`
Expected: failures in `main-panel-glue`, `direct-api-client`, `direct-only-build`, `autosync`, `requester-ui`, `subscription-mode-ui` and `update-ui`, plus the known trio.

- [ ] **Step 2: Remove telemetry from MAIN, the bundle and the panel API**

`git rm src/telemetry-client.js`. In `scripts/client-modules.js`, delete both `  'src/telemetry-client.js',` lines, and in the comment change `(settings, updates, diagnostics, preset)` to `(settings, updates, preset)`.

In `src/panel-api-client.js`, delete the line `      submitTelemetry(errors) { return call('POST', '/v1/telemetry/errors', { errors: Array.isArray(errors) ? errors : [] }); },`.

In `torn-revive-chat-collector.user.js`, delete each block below completely:
```js
  const TelemetryClient = globalThis.ReviveRelayTelemetryClient;
```
```js
    telemetry: null,
```
```js
  let errorHooksInstalled = false;
```
```js
  state.telemetry = TelemetryClient.createTelemetryClient({
    submit: payload => state.api.submitTelemetry(payload.errors),
    getStoredQueue: () => storage.get(KEYS.telemetryOutbox, []),
    saveStoredQueue: queue => storage.set(KEYS.telemetryOutbox, Array.isArray(queue) ? queue : []),
    version: VERSION,
    buildCommit: BUILD_COMMIT
  });

```
```js
  function captureClientError(error, operation) {
    if (!storage.get(KEYS.clientDiagnosticsEnabled, false)) return;
    try {
      state.telemetry.captureError(error, { operation });
    } catch (_) {
      // Diagnostics must never block ReviveRelay.
    }
  }

```
```js
  function installGlobalErrorHooks() {
    if (errorHooksInstalled) return;
    errorHooksInstalled = true;
    window.addEventListener('error', event => {
      if (event?.error) captureClientError(event.error, 'window.error');
    });
    window.addEventListener('unhandledrejection', event => {
      captureClientError(event?.reason instanceof Error ? event.reason : new Error(String(event?.reason || 'Unhandled rejection')), 'window.unhandledrejection');
    });
  }

```
Then make these single-line edits:

| Find | Replace with |
| --- | --- |
| ` \|\| !TelemetryClient` (in the dependency check) | (nothing) |
| `    captureClientError(error, operation);` (in `handleApiFailure`) | (delete the line) |
| `        captureClientError(error, 'reviver.eligibility');` | (delete the line) |
| `      } catch (error) {` + next line `        captureClientError(error, 'notification.certified_request');` + `      }` | `      } catch (_) {` / `        // A notification failure never blocks the queue.` / `      }` |
| `    if (storage.get(KEYS.clientDiagnosticsEnabled, false)) state.telemetry.drain().catch(() => {});` (twice: `handlePillActivate` and `init`) | (delete both lines) |
| `    installGlobalErrorHooks();` | (delete the line) |
| `    checkUpdates(false).catch(error => captureClientError(error, 'update.initial'));` | `    checkUpdates(false).catch(() => {});` |
| `      captureClientError(error, 'init');` | (delete the line) |
| `        <p><strong>Diagnostics consent.</strong> Sanitized diagnostics are off by default and are sent only when you enable the Diagnostics option.</p>` | `        <p><strong>Diagnostics.</strong> The old Diagnostics option (off by default) is removed: ReviveRelay sends no error diagnostics.</p>` |

Delete the Diagnostics settings section. It is the last section of the `renderSettingsDrawer` template, so the template must then end at the previous section's `    </details>`. Find:
```js
    </details>
    <details class="rr-settings-section">
      <summary>Diagnostics / Advanced</summary>
      <div class="rr-settings-body">
        <label><input id="rr-diagnostics-enabled" type="checkbox" ${storage.get(KEYS.clientDiagnosticsEnabled, false) ? 'checked' : ''}> Send sanitized ReviveRelay error diagnostics</label>
        <p class="rr-muted">Diagnostics exclude API keys, bearer tokens, payment receiver credentials and public chat content.</p>
      </div>
    </details>`;
```
Replace with:
```js
    </details>`;
```
Then delete the change handler:
```js
      if (event.target?.id === 'rr-diagnostics-enabled') {
        storage.set(KEYS.clientDiagnosticsEnabled, Boolean(event.target.checked));
      }
```
Keep the `KEYS.clientDiagnosticsEnabled` and `KEYS.telemetryOutbox` entries. Account deletion still resets them, so a 0.7.x outbox left in GM storage is cleared on deletion.

Check: `grep -n "captureClientError\|state.telemetry\|TelemetryClient\|rr-diagnostics-enabled" torn-revive-chat-collector.user.js`
Expected: no output.

- [ ] **Step 3: Update the disclosures**

| File | Find | Replace with |
| --- | --- | --- |
| `PRIVACY.md` | `Sanitized client diagnostics are **off by default** and are sent only after the user enables the Diagnostics option. Diagnostic envelopes are bounded and sanitized. They exclude Torn API keys, ReviveRelay bearer/session tokens, merchant credentials, raw Torn API responses, request bodies and public chat content.` | `ReviveRelay 1.0.1 sends **no client diagnostics**. The 0.7.x Diagnostics option, which was off by default, is removed; the server keeps accepting bounded, sanitized envelopes from older clients that still have it enabled.` |
| `README.md` | `Sanitized diagnostics are **off by default**. If enabled, diagnostics exclude` … `regression analysis.` (the whole paragraph) | `The 1.0.1 client sends no diagnostics (the old Diagnostics option, off by default, is removed). Older 0.7.x clients may still send sanitized diagnostics if their users enabled them; raw telemetry occurrences are subject to the implemented retention job.` |
| `SECURITY.md` | `Sanitized diagnostics are **off by default**.` | `Sanitized diagnostics are **off by default** in 0.7.x and absent from the 1.0.1 client.` |
| `docs/review/ENDPOINT-INVENTORY.md` | `\| POST \| \`/v1/telemetry/errors\` \| Bounded sanitized technical error envelopes; client diagnostics are off by default. \|` | `\| POST \| \`/v1/telemetry/errors\` \| Bounded sanitized technical error envelopes from 0.7.x clients (diagnostics off by default); the 1.0.1 client never calls it. \|` |
| `docs/review/REVIEW-CHECKLIST.md` | `keeps Diagnostics OFF by default` | `shows no Diagnostics option (removed in 1.0.1)` |
| `docs/review/REVIEW-CHECKLIST.md` | `- [x] Confirm diagnostics are off by default and sanitized.` | `- [x] Confirm diagnostics are off by default and sanitized (0.7.x); the 1.0.1 client has no diagnostics.` |
| `docs/review/SCREENSHOT-CHECKLIST.md` | `revoke guidance, diagnostics off by default, About & Privacy` | `revoke guidance, no Diagnostics option (1.0.1; 0.7.x had diagnostics off by default), About & Privacy` |
| `docs/review/PAYMENT-VERIFICATION-FLOW.md` | `Sanitized diagnostics are off by default and do not include` | `Sanitized diagnostics (0.7.x only, off by default; the 1.0.1 client sends none) do not include` |
| `src/panel-api-client.js` | `(setup, Pro, invoices, account, diagnostics)` | `(setup, Pro, invoices, account)` |

- [ ] **Step 4: Run everything**

Run: `npm run build >/dev/null && node --test test 2>&1 | grep -E '^# (pass|fail)' && node scripts/size-report.js | head -3`
Expected: `# pass 615`, `# fail 3` (known trio). Size: `"liteCore": 98235`, and `"whole"` 9,991 lower than after Task 4 (±50 depending on blank lines).

- [ ] **Step 5: Commit**
```bash
git add -A src scripts torn-revive-chat-collector.user.js test PRIVACY.md README.md SECURITY.md docs/review
git commit -m "feat!: remove opt-in client diagnostics to fund 1.0.1 features (-9991 B whole)" -m "The owner's Plan 3b brief lists telemetry as a trim candidate. The server endpoint stays for 0.7.x." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 6: Scheduler and engine carry-overs, and the leader-only live-snapshot hook

This task covers:

- the carry-over "scheduler back-off ignores `delay()=null` (stray no-op timer)";
- 3a re-review **M1** (defer a hand-off only from live data) and **M3** (no first sight recorded while hidden);
- Plan 3 input 7: the notification hook fires from the leader only, inside `apply()`, on a live snapshot;
- input 11 / minor note: `api.reset()` no longer wipes the badge LRU on a 304 resync, while a session change still clears it.

**Files:**
- Modify: `src/lite/scheduler.js`, `src/lite/engine.js`
- Test: `test/lite-scheduler.test.js`, create `test/lite-engine-3b.test.js`

**Interfaces:**
- Produces: `createLiteEngine({ ..., onLiveSnapshot })`; `api.clearBadges()` called on expiry and session reset.

- [ ] **Step 1: Write the failing tests**

Append to `test/lite-scheduler.test.js`:
<!-- op:append test/lite-scheduler.test.js -->
```js
test('a failing job whose delay turns null arms no back-off timer', async () => {
  const { clock, scheduler } = setup();
  const gate = { open: true };
  scheduler.addJob('poll', { delay: () => (gate.open ? 60000 : null), runNow: true, run: () => { gate.open = false; throw new Error('down'); } });
  scheduler.start();
  await clock.advance(0);
  assert.equal(scheduler.failures('poll'), 1);
  assert.equal(clock.pending(), 0, 'no stray no-op back-off timer');
  gate.open = true;
  scheduler.reschedule('poll');
  assert.equal(clock.nextDelay(), 5000, 'the back-off still applies once the job is due again');
});
```
<!-- op:file test/lite-engine-3b.test.js -->
Create `test/lite-engine-3b.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiteEngine } = require('../src/lite/engine');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createFakeDocument, createFakeWindow } = require('./helpers/fake-dom');
const { createChannelHub, createLockManager, createAbortController } = require('./helpers/fake-tabs');

function memoryStorage() {
  const values = {};
  return { values, get: (key, fallback) => (key in values ? values[key] : fallback), set: (key, value) => { values[key] = value; } };
}

function snapshot(overrides = {}) {
  return {
    stateVersion: '0123456789abcdef',
    nextPollMs: 60000,
    me: { tornId: 1001, name: 'Patient', roles: ['requester'], verification: { usable: true, requester: true, reviver: false } },
    pro: { state: 'NONE' },
    activeRequest: null,
    activeTransactions: [],
    recentlyClosed: [],
    revivers: { online: 2 },
    queue: null,
    ...overrides
  };
}

function fakeApi(responses) {
  const api = {
    calls: 0,
    resets: 0,
    badgeClears: 0,
    reset() { api.resets += 1; },
    clearBadges() { api.badgeClears += 1; },
    async getState() {
      api.calls += 1;
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (next instanceof Error) throw next;
      return next;
    }
  };
  return api;
}

function tabs(count, clock, responsesFor) {
  const hub = createChannelHub();
  const locks = createLockManager();
  function BroadcastChannel(name) { return hub.createChannel(name); }
  const storage = memoryStorage();
  return Array.from({ length: count }, (_, index) => {
    const api = fakeApi(responsesFor(index));
    const window = createFakeWindow({ BroadcastChannel, locks });
    window.AbortController = function AbortController() { return createAbortController(); };
    const document = createFakeDocument();
    const live = [];
    const engine = createLiteEngine({ api, window, document, storage, clock, tabId: `t${index}`, headerSelectors: ['#rr-none'], onLiveSnapshot: snap => live.push(snap) });
    return { api, engine, document, live };
  });
}

test('onLiveSnapshot runs only in the leader of three tabs, only for live data, including after a hand-off', async () => {
  const clock = createFakeTimers();
  const [a, b, c] = tabs(3, clock, () => [{ notModified: false, snapshot: snapshot() }, new Error('down')]);
  a.engine.start();
  b.engine.start();
  c.engine.start();
  await clock.advance(0);
  assert.equal(a.live.length, 1);
  assert.equal(b.live.length + c.live.length, 0, 'followers render broadcasts but never notify');
  await clock.advance(60000);
  assert.equal(a.live.length, 1, 'an offline result is not live');
  a.document.setVisibility('hidden');
  await clock.advance(0);
  assert.equal(b.engine.isLeader(), true);
  await clock.advance(60000);
  assert.equal(b.live.length, 1);
  assert.equal(a.live.length + c.live.length, 1);
  a.engine.stop();
  b.engine.stop();
  c.engine.stop();
});

test('M1: a hand-off after a failed poll polls at once instead of waiting a cadence', async () => {
  const clock = createFakeTimers();
  const [a, b] = tabs(2, clock, index => (index === 0 ? [{ notModified: false, snapshot: snapshot() }, new Error('down')] : [{ notModified: false, snapshot: snapshot() }]));
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  a.engine.refresh();
  await clock.advance(0);
  assert.equal(b.engine.viewModel().offline, true, 'the follower shows the leader\'s failure');
  a.document.setVisibility('hidden');
  await clock.advance(0);
  assert.equal(b.api.calls, 1, 'non-live inherited data never defers the first poll');
  a.engine.stop();
  b.engine.stop();
});

test('M3: a hidden follower does not record first sight of an outcome', async () => {
  const clock = createFakeTimers();
  const closedAt = new Date(clock.now()).toISOString();
  const done = snapshot({ recentlyClosed: [{ id: 'tx1', participantRole: 'requester', state: 'COMPLETED', closedAt }] });
  const [a, b] = tabs(2, clock, () => [{ notModified: false, snapshot: done }]);
  b.document.visibilityState = 'hidden';
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  await clock.advance(4000);
  b.document.setVisibility('visible');
  await clock.advance(0);
  assert.equal(b.engine.viewModel().label, 'Revived', 'seen 4 s after the leader, but first displayed only now');
  await clock.advance(4000);
  assert.equal(b.engine.viewModel().label, 'Revived');
  a.engine.stop();
  b.engine.stop();
});

test('a session reset clears the badge LRU; a 304 resync keeps it', async () => {
  const clock = createFakeTimers();
  const [a] = tabs(1, clock, () => [{ notModified: false, snapshot: snapshot() }, { notModified: true, stateVersion: 'ffffffffffffffff' }]);
  a.engine.start();
  await clock.advance(0);
  await clock.advance(60000);
  assert.equal(a.api.resets, 1);
  assert.equal(a.api.badgeClears, 0);
  a.engine.resetSession();
  assert.equal(a.api.badgeClears, 1);
  a.engine.stop();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/lite-scheduler.test.js test/lite-engine-3b.test.js 2>&1 | grep -E '^not ok|^# (pass|fail)'`
Expected: `# fail 5`:

- "onLiveSnapshot runs only in the leader…"
- "M1: …"
- "M3: …"
- "a session reset clears the badge LRU…"
- "a failing job whose delay turns null…"

- [ ] **Step 3: Scheduler: no back-off timer for a job that is not due**
<!-- op:find src/lite/scheduler.js -->
Find:
```js
      const base = job.lastRunAt === null ? job.addedAt : job.lastRunAt;
      if (job.failures > 0) return base + job.backoff;
      const delay = job.delay(context(job));
      if (delay === null || delay === undefined || !Number.isFinite(Number(delay))) return null;
      return base + Math.max(0, Number(delay));
```
<!-- op:replace -->
Replace with:
```js
      const base = job.lastRunAt === null ? job.addedAt : job.lastRunAt;
      const delay = job.delay(context(job));
      if (delay === null || delay === undefined || !Number.isFinite(Number(delay))) return null;
      return base + (job.failures > 0 ? job.backoff : Math.max(0, Number(delay)));
```

- [ ] **Step 4: Engine edits**

In `src/lite/engine.js`, make these edits in order:
1. Accept the hook (`createLiteEngine` parameters).
   Find (exactly one occurrence):
```js
    onRender = null
  } = {}) {
```
   Replace with:
```js
    onRender = null,
    onLiveSnapshot = null
  } = {}) {
```
2. `reset()` alone now drops only the ETag; a session change also clears badges.
   Find (exactly one occurrence):
```js
    function resetApi() {
      if (typeof api.reset === 'function') api.reset();
    }
```
   Replace with:
```js
    function resetApi(badgesToo) {
      if (typeof api.reset === 'function') api.reset();
      if (badgesToo && typeof api.clearBadges === 'function') api.clearBadges();
    }
```
3. In `expire()`.
   Find (exactly one occurrence):
```js
      cache.clear();
      resetApi();
    }
```
   Replace with:
```js
      cache.clear();
      resetApi(true);
    }
```
4. In `resetSession()`. The 304-mismatch path keeps `resetApi()` (ETag only).
   Find (exactly one occurrence):
```js
      if (!keepCache) cache.clear();
      resetApi();
```
   Replace with:
```js
      if (!keepCache) cache.clear();
      resetApi(true);
```
5. M3, in `render()`.
   Find (exactly one occurrence):
```js
      if (lastView.refreshAt !== null && id && !firstSeen.has(id)) firstSeen.set(id, at);
```
   Replace with:
```js
      if (lastView.refreshAt !== null && id && !firstSeen.has(id) && !isHidden()) firstSeen.set(id, at);
```
6. Input 7, in `apply()`: leader only, live only.
   Find (exactly one occurrence):
```js
      if (isLeader()) leader.broadcast(statePayload(snapshot, freshness, fetchedAt, extra));
      render();
```
   Replace with:
```js
      if (isLeader()) leader.broadcast(statePayload(snapshot, freshness, fetchedAt, extra));
      if (freshness === 'live' && snapshot && isLeader() && typeof onLiveSnapshot === 'function') {
        try { onLiveSnapshot(snapshot); } catch (_) {}
      }
      render();
```
7. M1, in `onLeaderChange()`.
   Find (exactly one occurrence):
```js
      if (nowLeader && deferredPollAt === null) deferredPollAt = youngDataPollAt(lastFetchedAt);
```
   Replace with:
```js
      if (nowLeader && deferredPollAt === null && current.freshness === 'live') deferredPollAt = youngDataPollAt(lastFetchedAt);
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/lite-scheduler.test.js test/lite-engine-3b.test.js test/lite-engine.test.js test/lite-engine-session.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# fail 0`.

Run: `npm run build >/dev/null && node --test test 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 620`, `# fail 3` (known trio).

- [ ] **Step 6: Commit**
```bash
git add src/lite/scheduler.js src/lite/engine.js test/lite-scheduler.test.js test/lite-engine-3b.test.js
git commit -m "fix(engine): leader-only live-snapshot hook; M1 live-only hand-off deferral; M3 no hidden first sight; no stray back-off timer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 7: Badge LRU in GM storage, malformed 200s rejected, token-safe errors

**Files:**
- Modify: `src/lite/state-client.js` (full replacement)
- Test: `test/lite-state-client.test.js`

**Interfaces:**
- Produces: `createStateClient({ ..., storage })`, `BADGE_CACHE.key`, `clearBadges()`, `INVALID_BADGE_RESPONSE`.

- [ ] **Step 1: Write the failing tests and adjust the old ones**

In `test/lite-state-client.test.js`:

1. In "getPlayerBadge fetches once…", change the first response to `{ status: 200, body: { tornId: 42, requesterVerified: true, reviverVerified: false } }`. A `'yes'` boolean is now malformed; the next test covers it.
2. In "badge cache is an LRU bounded at 200 entries":
   - replace `assert.deepEqual(BADGE_CACHE, { ttlMs: 600000, maxEntries: 200 });` with `assert.deepEqual(BADGE_CACHE, { ttlMs: 600000, maxEntries: 200, key: 'reviverelay_badge_cache_v1' });`;
   - replace the responder with `const responder = input => ({ status: 200, body: { tornId: Number(input.url.split('/').at(-2)), requesterVerified: true, reviverVerified: false } });`.
3. Rename `test('reset forgets the version and the badge cache', …` to `test('reset forgets the version', …` (its body is unchanged).
4. Insert before `test('constructor validation'`:
```js
test('a malformed badge 200 is rejected and never cached', async () => {
  const { api, calls } = client([
    { status: 200, body: { tornId: 42, requesterVerified: 'yes', reviverVerified: true } },
    { status: 200, body: { tornId: 43, requesterVerified: true, reviverVerified: true } },
    { status: 200, responseText: 'null' },
    { status: 200, body: { tornId: 42, requesterVerified: true, reviverVerified: false } }
  ]);
  await assert.rejects(api.getPlayerBadge(42), error => error.code === 'INVALID_BADGE_RESPONSE' && error.retryable === true);
  await assert.rejects(api.getPlayerBadge(42), error => error.code === 'INVALID_BADGE_RESPONSE');
  await assert.rejects(api.getPlayerBadge(42), error => error.code === 'INVALID_BADGE_RESPONSE', 'a JSON null body');
  assert.equal(api.badgeCacheSize(), 0);
  assert.deepEqual(await api.getPlayerBadge(42), { tornId: 42, requesterVerified: true, reviverVerified: false });
  assert.equal(calls.length, 4);
});

test('the badge LRU persists in storage and a new client (page load) reuses it', async () => {
  const values = {};
  const storage = { get: (key, fallback) => (key in values ? values[key] : fallback), set: (key, value) => { values[key] = value; } };
  const first = client([{ status: 200, body: { tornId: 42, requesterVerified: true, reviverVerified: false } }], { now: () => 0, storage });
  await first.api.getPlayerBadge(42);
  assert.equal(values[BADGE_CACHE.key].length, 1);
  const second = client([], { now: () => 1000, storage });
  assert.deepEqual(await second.api.getPlayerBadge(42), { tornId: 42, requesterVerified: true, reviverVerified: false });
  assert.equal(second.calls.length, 0);
  values[BADGE_CACHE.key] = [['x', {}], 'junk', ['7', { badge: { tornId: 7 }, expiresAt: 'soon' }], ['8', { badge: { tornId: 8, requesterVerified: 'yes', reviverVerified: true }, expiresAt: 1e15 }]];
  assert.equal(client([], { storage }).api.badgeCacheSize(), 0, 'malformed stored entries are dropped');
});

test('reset forgets only the ETag; clearBadges empties the memory and stored LRU', async () => {
  const values = {};
  const storage = { get: (key, fallback) => (key in values ? values[key] : fallback), set: (key, value) => { values[key] = value; } };
  const { api } = client([{ status: 200, body: { tornId: 42, requesterVerified: true, reviverVerified: true } }], { storage });
  await api.getPlayerBadge(42);
  api.reset();
  assert.equal(api.badgeCacheSize(), 1);
  api.clearBadges();
  assert.equal(api.badgeCacheSize(), 0);
  assert.deepEqual(values[BADGE_CACHE.key], []);
});

test('the session token never appears in badge or state errors', async () => {
  const token = 'session-token';
  const leak = new Error(`socket closed for Bearer ${token}`);
  const { api } = client([leak, { status: 401, body: { error: 'AUTH_REQUIRED', token, detail: token } }, { status: 500, responseText: `oops ${token}` }]);
  for (const call of [() => api.getPlayerBadge(42), () => api.getPlayerBadge(42), () => api.getState()]) {
    await assert.rejects(call(), error => {
      const text = `${error.message} ${error.stack} ${JSON.stringify(error)} ${JSON.stringify(error.details)}`;
      assert.equal(text.includes(token), false, text);
      return true;
    });
  }
});

```

Run: `node --test test/lite-state-client.test.js 2>&1 | grep -E '^not ok|^# (pass|fail)'`
Expected: `# fail 4`:

- the LRU test (`BADGE_CACHE` has no `key` yet);
- "a malformed badge 200…" (no `INVALID_BADGE_RESPONSE`; a `responseText: 'null'` body throws a `TypeError` today);
- "the badge LRU persists…" (nothing stored; stored entries with non-boolean flags must be dropped);
- "reset forgets only the ETag…" (`api.clearBadges is not a function`).

The token test passes already; it pins existing behaviour.

- [ ] **Step 2: Replace `src/lite/state-client.js`**
<!-- op:file src/lite/state-client.js -->
```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteStateClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATE_PATH = '/v1/state';
  const STATE_VERSION_PATTERN = /^[0-9a-f]{16}$/;
  const TORN_ID_PATTERN = /^[1-9][0-9]{0,11}$/;
  const BADGE_CACHE = Object.freeze({ ttlMs: 10 * 60 * 1000, maxEntries: 200, key: 'reviverelay_badge_cache_v1' });

  const directApi = () => globalThis.ReviveRelayDirectApiClient || require('../direct-api-client');

  function clientError(code, options) {
    const { DirectApiClientError } = directApi();
    return new DirectApiClientError(code, options);
  }

  const validBadge = body => Boolean(body && typeof body.requesterVerified === 'boolean' && typeof body.reviverVerified === 'boolean');

  function createStateClient({ baseUrl, request, getToken = () => '', clientVersion = '', releaseChannel = '', now = () => Date.now(), storage = null } = {}) {
    const base = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('A valid ReviveRelay baseUrl is required');
    if (typeof request !== 'function') throw new Error('request transport is required');

    let lastStateVersion = null;
    let badges = null;

    function badgeMap() {
      if (badges) return badges;
      badges = new Map();
      let stored = null;
      try { stored = storage ? storage.get(BADGE_CACHE.key, null) : null; } catch (_) { stored = null; }
      for (const entry of Array.isArray(stored) ? stored.slice(-BADGE_CACHE.maxEntries) : []) {
        const [key, value] = Array.isArray(entry) ? entry : [];
        if (TORN_ID_PATTERN.test(String(key)) && value && validBadge(value.badge) && Number.isFinite(value.expiresAt)) badges.set(String(key), value);
      }
      return badges;
    }

    function saveBadges() {
      try { if (storage) storage.set(BADGE_CACHE.key, [...badgeMap()]); } catch (_) {}
    }

    function headers(extra = {}) {
      const result = {
        Accept: 'application/json',
        'X-ReviveRelay-Version': String(clientVersion || ''),
        'X-ReviveRelay-Channel': String(releaseChannel || ''),
        ...extra
      };
      const token = String((typeof getToken === 'function' ? getToken() : '') || '').trim();
      if (token) result.Authorization = `Bearer ${token}`;
      return result;
    }

    async function send(path, extraHeaders) {
      try {
        return await request({ method: 'GET', url: `${base}${path}`, headers: headers(extraHeaders) });
      } catch (error) {
        const { DirectApiClientError } = directApi();
        if (error instanceof DirectApiClientError) throw error;
        throw clientError('NETWORK_ERROR', { retryable: true });
      }
    }

    async function getState() {
      const sentVersion = lastStateVersion;
      const response = await send(STATE_PATH, sentVersion ? { 'If-None-Match': `"${sentVersion}"` } : {});
      const status = Number(response && response.status) || 0;
      if (status === 304) {
        if (!sentVersion) throw clientError('INVALID_STATE_RESPONSE', { status, retryable: true });
        return Object.freeze({ notModified: true, stateVersion: sentVersion });
      }
      const body = directApi().safeParseBody(response);
      if (status < 200 || status >= 300) throw directApi().mapHttpError(status, body);
      if (!body || typeof body !== 'object' || Array.isArray(body) || !STATE_VERSION_PATTERN.test(String(body.stateVersion || ''))) {
        throw clientError('INVALID_STATE_RESPONSE', { status, retryable: true });
      }
      lastStateVersion = body.stateVersion;
      return Object.freeze({ notModified: false, snapshot: body });
    }

    function rememberBadge(key, badge) {
      const map = badgeMap();
      map.delete(key);
      map.set(key, { badge, expiresAt: now() + BADGE_CACHE.ttlMs });
      while (map.size > BADGE_CACHE.maxEntries) map.delete(map.keys().next().value);
      saveBadges();
    }

    async function getPlayerBadge(tornId) {
      const key = String(tornId == null ? '' : tornId).trim();
      if (!TORN_ID_PATTERN.test(key)) throw clientError('INVALID_TORN_ID');
      const map = badgeMap();
      const cached = map.get(key);
      if (cached && cached.expiresAt > now()) {
        map.delete(key);
        map.set(key, cached);
        return cached.badge;
      }
      if (cached) map.delete(key);
      const response = await send(`/v1/players/${key}/badge`);
      const status = Number(response && response.status) || 0;
      const body = directApi().safeParseBody(response);
      if (status < 200 || status >= 300) throw directApi().mapHttpError(status, body);
      if (!validBadge(body) || String(body.tornId) !== key) {
        throw clientError('INVALID_BADGE_RESPONSE', { status, retryable: true });
      }
      const badge = Object.freeze({
        tornId: Number(key),
        requesterVerified: body.requesterVerified === true,
        reviverVerified: body.reviverVerified === true
      });
      rememberBadge(key, badge);
      return badge;
    }

    return Object.freeze({
      getState,
      getPlayerBadge,
      lastStateVersion: () => lastStateVersion,
      reset() {
        lastStateVersion = null;
      },
      clearBadges() {
        badges = new Map();
        saveBadges();
      },
      badgeCacheSize: () => badgeMap().size
    });
  }

  return Object.freeze({ STATE_PATH, BADGE_CACHE, createStateClient });
});
```

- [ ] **Step 3: Run the tests**

Run: `node --test test/lite-state-client.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 14`, `# fail 0`.

Run: `npm run build >/dev/null && node --test test 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 624`, `# fail 3`.

- [ ] **Step 4: Commit**
```bash
git add src/lite/state-client.js test/lite-state-client.test.js
git commit -m "feat(lite): persist the badge LRU in GM storage; never cache a malformed badge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 8: Profile badges

**Scope:**

- The chip appears only on `profiles.php?XID=…`, only while the page is visible, at most once per node (`data-rr-badge`), and is opt-out.
- It is scanned on the boot's existing one-shot relayout timers (start, SPA navigation, BFCache restore), and again whenever the page becomes visible (I-5: profiles are usually opened in a background tab). There is no interval and no observer.
- The relayout timers stand in for the spec's `requestIdleCallback` deferral (boot sequence step 4). They run 150 ms to 3 s after boot, off the boot path, with no new timer type.
- It is dormant when signed out (I-2): `enabled()` also requires a session token, so no request is sent without one.
- The 10-minute cache (Task 7) makes the repeated scans free.
- The slot selectors are unverified guesses; the owner smoke test checks them (item 6).
- **Hospital-list badges are not in this task.** The owner moved them to 1.1 (Appendix A, D-2).
- Disclosures: `docs/review/ENDPOINT-INVENTORY.md` and `PRIVACY.md` now say the client sends the viewed profile's Torn ID.

**Files:**
- Create: `src/lite/badges.js`
- Modify: `src/lite/boot.js`, `scripts/client-modules.js`, `test/lite-bundle.test.js`, `test/direct-only-build.test.js`, `test/helpers/fake-dom.js`
- Modify docs: `docs/review/ENDPOINT-INVENTORY.md`, `PRIVACY.md`
- Test: create `test/lite-badges.test.js`; `test/lite-boot.test.js`

**Interfaces:**
- Consumes: `api.getPlayerBadge(tornId)` (Task 7).
- Produces: `createBadges`, `BADGES_KEY` on `ReviveRelayLiteBoot`.

- [ ] **Step 1: Write the failing tests**
<!-- op:file test/lite-badges.test.js -->
Create `test/lite-badges.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBadges, badgeText } = require('../src/lite/badges');
const { createFakeDocument } = require('./helpers/fake-dom');

function setup({ href = 'https://www.torn.com/profiles.php?XID=42', badge = { tornId: 42, requesterVerified: false, reviverVerified: true }, enabled = true } = {}) {
  const document = createFakeDocument();
  const slot = document.createElement('div');
  slot.setAttribute('id', 'rr-profile');
  document.body.appendChild(slot);
  const calls = [];
  const api = { async getPlayerBadge(id) { calls.push(id); if (badge instanceof Error) throw badge; return badge; } };
  const badges = createBadges({ document, window: { location: { href } }, api, enabled: () => enabled, slots: ['#rr-profile'] });
  return { document, slot, calls, badges };
}

test('a visible profile page gets one RR verified chip, inserted once', async () => {
  const { badges, slot, calls } = setup();
  assert.equal(await badges.scan(), true);
  assert.equal(await badges.scan(), false);
  const chips = slot.querySelectorAll('[data-rr-badge]');
  assert.equal(chips.length, 1);
  assert.equal(chips[0].textContent, 'RR verified reviver');
  assert.deepEqual(calls, ['42']);
});

test('hidden pages, other pages, opt-out and unverified players get nothing', async () => {
  const hidden = setup();
  hidden.document.visibilityState = 'hidden';
  assert.equal(await hidden.badges.scan(), false);
  assert.equal(hidden.calls.length, 0);
  const other = setup({ href: 'https://www.torn.com/hospitalview.php' });
  assert.equal(await other.badges.scan(), false);
  const off = setup({ enabled: false });
  assert.equal(await off.badges.scan(), false);
  assert.equal(off.calls.length, 0);
  const plain = setup({ badge: { tornId: 42, requesterVerified: false, reviverVerified: false } });
  assert.equal(await plain.badges.scan(), false);
  assert.equal(plain.slot.querySelectorAll('[data-rr-badge]').length, 0);
});

test('a failed lookup leaves the page untouched', async () => {
  const { badges, slot } = setup({ badge: new Error('RATE_LIMITED') });
  assert.equal(await badges.scan(), false);
  assert.equal(slot.querySelectorAll('[data-rr-badge]').length, 0);
});

test('badge text names each verified role', () => {
  assert.equal(badgeText({ requesterVerified: true, reviverVerified: true }), 'RR verified requester · reviver');
  assert.equal(badgeText({ requesterVerified: false, reviverVerified: false }), '');
});
```
Append to `test/lite-boot.test.js`:
```js
function profilePage(platform) {
  const stateRequest = platform.request;
  platform.request = async input => (input.url.endsWith('/badge')
    ? (platform.requests.push(input), { status: 200, body: { tornId: 42, requesterVerified: true, reviverVerified: false } })
    : stateRequest(input));
}

function profileTitle(document) {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('class', 'content-title');
  wrapper.appendChild(document.createElement('h4'));
  document.body.appendChild(wrapper);
  return wrapper;
}

const badgeRequests = platform => platform.requests.filter(request => request.url.endsWith('/v1/players/42/badge')).length;

test('profile badges are scanned on the relayout timers, not on an interval', async () => {
  const platform = fakePlatform();
  profilePage(platform);
  const { boot, clock, document, window } = setup({ platform });
  window.location = { href: 'https://www.torn.com/profiles.php?XID=42' };
  const wrapper = profileTitle(document);
  boot.start();
  await clock.advance(3000);
  assert.equal(badgeRequests(platform), 1, 'three scans, one request (then cached)');
  assert.equal(wrapper.querySelectorAll('[data-rr-badge]').length, 1);
  boot.stop();
});

test('a profile opened in a background tab gets its badge once the tab becomes visible', async () => {
  const platform = fakePlatform();
  profilePage(platform);
  const { boot, clock, document, window } = setup({ platform });
  window.location = { href: 'https://www.torn.com/profiles.php?XID=42' };
  const wrapper = profileTitle(document);
  document.visibilityState = 'hidden';
  boot.start();
  await clock.advance(3000);
  assert.equal(badgeRequests(platform), 0, 'hidden: no lookup');
  document.setVisibility('visible');
  await clock.advance(0);
  assert.equal(badgeRequests(platform), 1);
  assert.equal(wrapper.querySelectorAll('[data-rr-badge]').length, 1);
  boot.stop();
});

test('a signed-out boot never looks up a badge', async () => {
  const platform = fakePlatform();
  profilePage(platform);
  const { boot, clock, document, window } = setup({ platform, session: { signedIn: false, tornId: null }, token: '' });
  window.location = { href: 'https://www.torn.com/profiles.php?XID=42' };
  profileTitle(document);
  boot.start();
  await clock.advance(3000);
  document.setVisibility('hidden');
  document.setVisibility('visible');
  await clock.advance(0);
  assert.equal(badgeRequests(platform), 0);
  boot.stop();
});
```
In the existing test "start and stop are idempotent and stop removes every listener and timer", the boot now adds a document listener. Change `  assert.equal(document.listenerCount('visibilitychange'), 1);` to `  assert.equal(document.listenerCount('visibilitychange'), 2, 'the engine and the badge re-scan');`. The later `0` check after `stop()` stays.
The boot test needs descendant selectors (`.content-title h4`) in the fake DOM. In `test/helpers/fake-dom.js`:
<!-- op:find test/helpers/fake-dom.js -->
Find:
```js
function compileSelector(selector) {
  const text = String(selector).trim();
  let m;
```
<!-- op:replace -->
Replace with:
```js
function compileSelector(selector) {
  const parts = String(selector).trim().split(/\s+/);
  if (parts.length > 1) {
    const own = compileSelector(parts.pop());
    const ancestor = compileSelector(parts.join(' '));
    if (!own || !ancestor) return null;
    return el => {
      if (!own(el)) return false;
      for (let node = el.parentNode; node && node.nodeType === 1; node = node.parentNode) if (ancestor(node)) return true;
      return false;
    };
  }
  const text = parts[0];
  let m;
```

Run: `node --test test/lite-badges.test.js test/lite-boot.test.js 2>&1 | grep -E '^not ok|^# (pass|fail)'`
Expected:

- `lite-badges` fails with `Cannot find module '../src/lite/badges'`;
- in `lite-boot`, the relayout test and the background-tab test fail (`0 !== 1`), and so does the listener count (`1 !== 2`);
- the signed-out test passes already, since nothing scans yet. It guards I-2 from here on.

- [ ] **Step 2: Create `src/lite/badges.js`**
<!-- op:file src/lite/badges.js -->
```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteBadges = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROFILE_PATTERN = /\/profiles\.php\?(?:[^#]*&)?XID=([1-9][0-9]{0,11})(?:[&#]|$)/;
  const PROFILE_SLOTS = Object.freeze(['#profileroot .profile-wrapper .title-black', '.content-title h4']);
  const BADGE_STYLE = 'margin-left:6px;padding:0 6px;border:1px solid #a4161a;border-radius:9px;font-size:11px;color:#a4161a';

  function badgeText(badge) {
    const roles = [badge.requesterVerified && 'requester', badge.reviverVerified && 'reviver'].filter(Boolean);
    return roles.length ? `RR verified ${roles.join(' · ')}` : '';
  }

  function createBadges({ document, window, api, enabled = () => true, slots = PROFILE_SLOTS }) {
    const pending = new Set();

    function slot() {
      for (const selector of slots) {
        let node = null;
        try { node = document.querySelector(selector); } catch (_) { node = null; }
        if (node) return node;
      }
      return null;
    }

    async function scan() {
      if (!enabled() || document.hidden || !api || typeof api.getPlayerBadge !== 'function') return false;
      const match = PROFILE_PATTERN.exec(String(window.location && window.location.href));
      const target = match && slot();
      if (!target || pending.has(match[1])) return false;
      const existing = target.querySelector('[data-rr-badge]');
      if (existing && existing.getAttribute('data-rr-badge') === match[1]) return false;
      pending.add(match[1]);
      try {
        const text = badgeText(await api.getPlayerBadge(match[1]));
        if (existing) existing.remove();
        if (!text || target.querySelector('[data-rr-badge]')) return false;
        const chip = document.createElement('span');
        chip.setAttribute('data-rr-badge', match[1]);
        chip.setAttribute('style', BADGE_STYLE);
        chip.textContent = text;
        target.appendChild(chip);
        return true;
      } catch (_) {
        return false;
      } finally {
        pending.delete(match[1]);
      }
    }

    return Object.freeze({ scan });
  }

  return Object.freeze({ PROFILE_PATTERN, PROFILE_SLOTS, badgeText, createBadges });
});
```

- [ ] **Step 3: Wire it in the boot and the bundle**

In `src/lite/boot.js`:

| Find | Replace with |
| --- | --- |
| `  const RELAYOUT_DELAYS_MS = Object.freeze([150, 1000, 3000]);` | the same line, then `  const BADGES_KEY = 'reviverelay_badges_enabled';` |
| `    const { createLiteEngine } = dependency('ReviveRelayLiteEngine', './engine');` | the same line, then `    const { createBadges } = dependency('ReviveRelayLiteBadges', './badges');` |
| `    const api = createStateClient({ baseUrl, request: platform.request, getToken, clientVersion, releaseChannel });` | `    const api = createStateClient({ baseUrl, request: platform.request, getToken, clientVersion, releaseChannel, storage: platform.storage });` then a new line `    const badges = createBadges({ document, window, api, enabled: () => Boolean(getToken()) && platform.storage.get(BADGES_KEY, true) !== false });` |
| `          engine.relayout();` | the same line, then `          badges.scan();` |
| `    const WINDOW_EVENTS = Object.freeze([` | `    function scanWhenVisible() {` / `      if (!document.hidden) badges.scan();` / `    }` / (blank line) / `    const WINDOW_EVENTS = Object.freeze([` |
| `      for (const [type, listener] of WINDOW_EVENTS) window.addEventListener(type, listener);` | the same line, then `      document.addEventListener('visibilitychange', scanWhenVisible);` |
| `      for (const [type, listener] of WINDOW_EVENTS) window.removeEventListener(type, listener);` | the same line, then `      document.removeEventListener('visibilitychange', scanWhenVisible);` |
| `  return Object.freeze({ RELAYOUT_DELAYS_MS, createLiteBoot });` | `  return Object.freeze({ RELAYOUT_DELAYS_MS, BADGES_KEY, createLiteBoot });` |

In `scripts/client-modules.js`, `test/lite-bundle.test.js` (`EXPECTED`) and `test/direct-only-build.test.js` (`REQUIRED`), insert `'src/lite/badges.js',` between `'src/lite/engine.js',` and `'src/lite/boot.js'`. In `scripts/client-modules.js`, also update the load-order comment to `… → engine → badges → boot`. In `test/lite-bundle.test.js` `GLOBALS`, add `  'src/lite/badges.js': 'ReviveRelayLiteBadges',` after the engine entry.

Disclosures (review package, Minor 8):

- In `docs/review/ENDPOINT-INVENTORY.md`, after the row ``| GET | `/v1/me` | … |``, add:
  ``| GET | `/v1/players/:tornId/badge` | Returns only `{ tornId, requesterVerified, reviverVerified }`. Called by the signed-in client only while a Torn profile page is visible, cached for 10 minutes; 60/min per session. |``
- In `PRIVACY.md`, after the line that starts `- any logged-in user can check whether a given Torn ID is a verified ReviveRelay requester`, add:
  `- from 1.0.1, while you are signed in and a Torn profile page is visible, the client automatically sends that profile's Torn ID to ReviveRelay to look up its badge (opt out in Settings → Notifications). The result is cached in your browser for 10 minutes.`

- [ ] **Step 4: Run the tests**

Run: `npm run build >/dev/null && node --test test 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 631`, `# fail 3`.

- [ ] **Step 5: Commit**
```bash
git add src/lite/badges.js src/lite/boot.js scripts/client-modules.js test docs/review/ENDPOINT-INVENTORY.md PRIVACY.md
git commit -m "feat(lite): RR verified badge on visible Torn profile pages, signed in only" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 9: Notifications and sound, from the leader, without the panel

**Behaviour (spec "Notifications", decision 5, single-actor invariant):**

- **Requester events:**
  - accepted (`WAITING_FOR_PAYMENT`, sound);
  - payment verified (`WAITING_FOR_REVIVE`, silent);
  - revived (`COMPLETED`, sound);
  - failed (`FAILED_ATTEMPT_CHOICE`, silent);
  - refund resolved (`REFUNDED`, sound).
- **Reviver events:**
  - payment received (`WAITING_FOR_REVIVE`, sound);
  - refund owed (`REFUND_REQUIRED`, sound);
  - new request: queue count rises; opt-in, silent, at most one a minute, count only.
- **Event id:** `<transaction id>:<state>`, read from `activeTransactions` and `recentlyClosed`. The 100 most recent ids are kept in GM storage, which every tab shares.
- **Quiet hours** suppress delivery but still mark the event seen.
- **Delivery:**
  - `platform.notify` uses `GM_notification` on desktop and the existing in-page toast on TornPDA.
  - A failing `notify` never blocks dedupe or sound.
  - **No tab-title fallback (I-3).** Notifications come only from a live leader poll, and hidden tabs never poll, so a "hidden tab" title badge could never fire. On PDA the toast is always shown.
  - The spec's "tab title badge as fallback on PDA" is therefore recorded as a deviation (Appendix B). The visible-tab requirement is disclosed in the CHANGELOG.
- **Storage:** the dedupe record is written only when it changes, not on every poll (Minor 4).
- **Sound:**
  - a ~0.4 s soft WebAudio chime, synthesized in the bundle (no asset, no network); see the D-3 note;
  - one toggle (`sound`) turns all sound off.

**Files:**
- Create: `src/lite/notify.js`
- Modify: `src/lite/boot.js`, `scripts/client-modules.js`, `test/lite-bundle.test.js`, `test/direct-only-build.test.js`
- Test: create `test/lite-notify.test.js`; `test/lite-boot.test.js`

**Interfaces:**
- Consumes: `onLiveSnapshot` (Task 6), `platform.notify`, `platform.storage`.
- Produces: `createNotifier`; `boot.notifier`.

- [ ] **Step 1: Write the failing tests**
<!-- op:file test/lite-notify.test.js -->
Create `test/lite-notify.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { SEEN_KEY, SETTINGS_KEY, createNotifier } = require('../src/lite/notify');

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return { values, get: (key, fallback) => (key in values ? values[key] : fallback), set: (key, value) => { values[key] = value; } };
}

function setup({ settings = null, hour = 12, shown = true, hidden = false } = {}) {
  const storage = memoryStorage(settings ? { [SETTINGS_KEY]: settings } : {});
  const shownList = [];
  const chimes = [];
  const document = { hidden, title: 'Torn' };
  const at = new Date(2026, 10, 26, hour, 0, 0).getTime();
  let now = at;
  const notifier = createNotifier({
    storage,
    notify: options => { shownList.push(options); return shown; },
    window: { focus() {} },
    document,
    now: () => now,
    chime: () => chimes.push(1)
  });
  return { storage, shownList, chimes, document, notifier, advance: ms => { now += ms; } };
}

const tx = (id, participantRole, state) => ({ id, participantRole, state });

test('each transaction event fires once, with sound only for action and outcome events', () => {
  const { notifier, shownList, chimes } = setup();
  const snapshot = { activeTransactions: [tx('t1', 'requester', 'WAITING_FOR_PAYMENT'), tx('t2', 'reviver', 'WAITING_FOR_REVIVE')], recentlyClosed: [tx('t0', 'requester', 'COMPLETED')] };
  assert.equal(notifier.onSnapshot(snapshot), 3);
  assert.equal(notifier.onSnapshot(snapshot), 0, 'deduped by event id');
  assert.deepEqual(shownList.map(entry => entry.text), ['A reviver accepted: time to pay', 'Payment received: revive now', 'You were revived']);
  assert.equal(chimes.length, 3);
  notifier.onSnapshot({ activeTransactions: [tx('t1', 'requester', 'WAITING_FOR_REVIVE')] });
  assert.equal(shownList.at(-1).text, 'Payment verified');
  assert.equal(chimes.length, 3, 'payment verified is silent');
});

test('the dedupe store is shared GM storage, so a second notifier (another tab) stays quiet', () => {
  const first = setup();
  const snapshot = { activeTransactions: [tx('t1', 'reviver', 'REFUND_REQUIRED')] };
  first.notifier.onSnapshot(snapshot);
  const second = createNotifier({ storage: first.storage, notify: () => assert.fail('duplicate notification'), chime: () => assert.fail('duplicate sound') });
  assert.equal(second.onSnapshot(snapshot), 0);
  assert.equal(first.storage.values[SEEN_KEY].ids.length, 1);
});

test('new queue requests are opt-in, silent and at most one a minute', () => {
  const off = setup();
  off.notifier.onSnapshot({ queue: { count: 1 } });
  off.notifier.onSnapshot({ queue: { count: 3 } });
  assert.equal(off.shownList.length, 0, 'off by default');
  const on = setup({ settings: { types: { newRequest: true } } });
  on.notifier.onSnapshot({ queue: { count: 1 } });
  assert.equal(on.shownList.length, 0, 'the first count is a baseline');
  on.notifier.onSnapshot({ queue: { count: 2 } });
  on.advance(30000);
  on.notifier.onSnapshot({ queue: { count: 3 } });
  assert.equal(on.shownList.length, 1, 'rate limited');
  on.advance(60000);
  on.notifier.onSnapshot({ queue: { count: 4 } });
  assert.equal(on.shownList.length, 2);
  assert.equal(on.chimes.length, 0);
});

test('master switch, per-type toggles, sound toggle and quiet hours', () => {
  const disabled = setup({ settings: { enabled: false } });
  disabled.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] });
  assert.equal(disabled.shownList.length, 0);
  const typeOff = setup({ settings: { types: { accepted: false } } });
  typeOff.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] });
  assert.equal(typeOff.shownList.length, 0);
  const silent = setup({ settings: { sound: false } });
  silent.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] });
  assert.equal(silent.shownList.length, 1);
  assert.equal(silent.chimes.length, 0);
  const night = setup({ settings: { quietFrom: 22, quietTo: 7 }, hour: 23 });
  night.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] });
  assert.equal(night.shownList.length, 0);
  assert.equal(night.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] }), 0, 'still marked seen');
  const day = setup({ settings: { quietFrom: 22, quietTo: 7 }, hour: 12 });
  day.notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'WAITING_FOR_PAYMENT')] });
  assert.equal(day.shownList.length, 1);
});

test('a failing notification API still marks the event seen and plays the chime', () => {
  const storage = memoryStorage();
  const chimes = [];
  const notifier = createNotifier({ storage, notify: () => { throw new Error('denied'); }, chime: () => chimes.push(1) });
  assert.equal(notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'COMPLETED')] }), 1);
  assert.equal(notifier.onSnapshot({ activeTransactions: [tx('a', 'requester', 'COMPLETED')] }), 0);
  assert.equal(chimes.length, 1);
});

test('the dedupe store is written only when it changes, not on every poll', () => {
  const writes = [];
  const values = {};
  const storage = { get: (key, fallback) => (key in values ? values[key] : fallback), set: (key, value) => { writes.push(key); values[key] = value; } };
  const notifier = createNotifier({ storage, notify: () => true, chime: () => {} });
  const snapshot = { activeTransactions: [tx('a', 'requester', 'WAITING_FOR_REVIVE')], queue: { count: 2 } };
  notifier.onSnapshot(snapshot);
  notifier.onSnapshot(snapshot);
  notifier.onSnapshot(snapshot);
  assert.equal(writes.length, 1);
});

test('notifyOnce delivers a system message once per id', () => {
  const { notifier, shownList } = setup();
  assert.equal(notifier.notifyOnce('update:1.0.2', 'ReviveRelay 1.0.2 is available.'), true);
  assert.equal(notifier.notifyOnce('update:1.0.2', 'ReviveRelay 1.0.2 is available.'), false);
  assert.equal(shownList.length, 1);
});

test('a queue notification carries only the count, never request details', () => {
  const { notifier, shownList } = setup({ settings: { types: { newRequest: true } } });
  notifier.onSnapshot({ queue: { count: 1 } });
  notifier.onSnapshot({ queue: { count: 2 }, activeTransactions: [] });
  assert.deepEqual(shownList.map(entry => entry.text), ['New revive request (2 in queue)']);
  assert.equal(notifier.onSnapshot({ queue: null }), 0, 'no queue access, no queue notification');
});
```
Append to `test/lite-boot.test.js`:
```js
test('the leader notifies a live transaction event once, with the panel closed, through platform.notify', async () => {
  const body = stateBody({ nextPollMs: 5000, activeTransactions: [{ id: 'tx9', participantRole: 'requester', state: 'WAITING_FOR_PAYMENT', paymentDeadline: '2026-11-25T12:10:00.000Z' }] });
  const platform = fakePlatform({ body });
  const notes = [];
  platform.notify = options => { notes.push(options.text); return true; };
  const { boot, clock } = setup({ platform });
  boot.start();
  await clock.advance(0);
  await clock.advance(5000);
  assert.deepEqual(notes, ['A reviver accepted: time to pay']);
  assert.deepEqual(platform.values.reviverelay_notified_events_v1.ids, ['tx9:WAITING_FOR_PAYMENT']);
  assert.equal(typeof boot.notifier.notifyOnce, 'function');
  boot.stop();
});
```
Run: `node --test test/lite-notify.test.js test/lite-boot.test.js 2>&1 | grep -E '^not ok|^# (pass|fail)'`
Expected: `Cannot find module '../src/lite/notify'`, and the boot notification test fails (`[] !== [...]`).

- [ ] **Step 2: Create `src/lite/notify.js`**
<!-- op:file src/lite/notify.js -->
```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteNotify = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SEEN_KEY = 'reviverelay_notified_events_v1';
  const SETTINGS_KEY = 'reviverelay_notification_settings_v1';
  const MAX_SEEN = 100;
  const QUEUE_GAP_MS = 60000;
  const EVENTS = Object.freeze({
    'requester:WAITING_FOR_PAYMENT': ['accepted', 'A reviver accepted: time to pay', true],
    'requester:WAITING_FOR_REVIVE': ['paymentVerified', 'Payment verified', false],
    'requester:COMPLETED': ['revived', 'You were revived', true],
    'requester:FAILED_ATTEMPT_CHOICE': ['failed', 'Revive failed: choose retry or refund', false],
    'requester:REFUNDED': ['refundResolved', 'Refund verified', true],
    'reviver:WAITING_FOR_REVIVE': ['paymentReceived', 'Payment received: revive now', true],
    'reviver:REFUND_REQUIRED': ['refundOwed', 'Refund owed', true]
  });

  function read(storage, key) {
    try {
      const value = storage.get(key, null);
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function allowed(settings, type, hour) {
    const types = settings.types || {};
    if (settings.enabled === false || (type === 'newRequest' ? types.newRequest !== true : types[type] === false)) return false;
    const { quietFrom: from, quietTo: to } = settings;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return true;
    return from < to ? hour < from || hour >= to : hour < from && hour >= to;
  }

  function playChime(window) {
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const tone = context.createOscillator();
      const gain = context.createGain();
      const t = context.currentTime;
      tone.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      tone.connect(gain).connect(context.destination);
      tone.onended = () => context.close();
      tone.start(t);
      tone.stop(t + 0.4);
      return true;
    } catch (_) {
      return false;
    }
  }

  function createNotifier({ storage, notify, window = null, now = () => Date.now(), chime = () => playChime(window) } = {}) {
    function deliver(type, text, sound, settings) {
      if (!allowed(settings, type, new Date(now()).getHours())) return false;
      try { notify({ title: 'ReviveRelay', text, timeout: 12000, onclick: () => window && window.focus() }); } catch (_) {}
      if (sound && settings.sound !== false) chime();
      return true;
    }

    function save(seen, before) {
      const next = { ...seen, ids: seen.ids.slice(-MAX_SEEN) };
      if (JSON.stringify(next) === before) return;
      try { storage.set(SEEN_KEY, next); } catch (_) {}
    }

    function seenState() {
      const seen = read(storage, SEEN_KEY);
      return { ids: Array.isArray(seen.ids) ? seen.ids : [], queueCount: Number.isFinite(seen.queueCount) ? seen.queueCount : null, queueAt: Number(seen.queueAt) || 0 };
    }

    function onSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return 0;
      const settings = read(storage, SETTINGS_KEY);
      const seen = seenState();
      const before = JSON.stringify(seen);
      let fired = 0;
      for (const tx of [].concat(snapshot.activeTransactions || [], snapshot.recentlyClosed || [])) {
        const event = tx && EVENTS[`${tx.participantRole}:${tx.state}`];
        const id = event && `${tx.id}:${tx.state}`;
        if (!id || seen.ids.includes(id)) continue;
        seen.ids.push(id);
        if (deliver(event[0], event[1], event[2], settings)) fired += 1;
      }
      const count = snapshot.queue ? Number(snapshot.queue.count) : NaN;
      if (Number.isFinite(count)) {
        if (seen.queueCount !== null && count > seen.queueCount && now() - seen.queueAt >= QUEUE_GAP_MS &&
            deliver('newRequest', `New revive request (${count} in queue)`, false, settings)) {
          seen.queueAt = now();
          fired += 1;
        }
        seen.queueCount = count;
      }
      save(seen, before);
      return fired;
    }

    function notifyOnce(id, text) {
      const seen = seenState();
      if (seen.ids.includes(id)) return false;
      seen.ids.push(id);
      save(seen);
      return deliver('system', text, false, read(storage, SETTINGS_KEY));
    }

    return Object.freeze({ onSnapshot, notifyOnce });
  }

  return Object.freeze({ SEEN_KEY, SETTINGS_KEY, EVENTS, allowed, playChime, createNotifier });
});
```

- [ ] **Step 3: Wire it in the boot and the bundle**

In `src/lite/boot.js`:

| Find | Replace with |
| --- | --- |
| `    const { createBadges } = dependency('ReviveRelayLiteBadges', './badges');` | `    const { createNotifier } = dependency('ReviveRelayLiteNotify', './notify');` then the same badges line |
| `    const badges = createBadges(` (the whole line) | `    const notifier = createNotifier({ storage: platform.storage, notify: typeof platform.notify === 'function' ? platform.notify : () => false, window, now });` then the same badges line |
| `      getSession,` + next line `      onRender` + `    });` (inside `createLiteEngine({`) | `      getSession,` / `      onRender,` / `      onLiveSnapshot: notifier.onSnapshot` / `    });` |
| `      api,` + next line `      engine` + `    });` (the returned object) | `      api,` / `      engine,` / `      notifier` / `    });` |

In `scripts/client-modules.js`, `test/lite-bundle.test.js` (`EXPECTED`) and `test/direct-only-build.test.js` (`REQUIRED`), insert `'src/lite/notify.js',` between `'src/lite/engine.js',` and `'src/lite/badges.js',`. Update the comment to `… → engine → notify → badges → boot`. In `GLOBALS`, add `  'src/lite/notify.js': 'ReviveRelayLiteNotify',`.

- [ ] **Step 4: Run the tests**

Run: `npm run build >/dev/null && node --test test 2>&1 | grep -E '^# (pass|fail)' && node scripts/size-report.js | head -3`
Expected: `# pass 640`, `# fail 3`; `"liteCore": 107877`.

**If the Lite core reads above 108,000, stop.** The 2 KB margin is gone, so compare each module's size with the table in "Size verdict" before going on.

- [ ] **Step 5: Commit**
```bash
git add src/lite/notify.js src/lite/boot.js scripts/client-modules.js test
git commit -m "feat(lite): leader-only, deduplicated notifications with sound, working with the panel closed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 10: Panel side: settings, update notice, invoice expiry, M2, M4, M5, M6

**This task closes three CHANGELOG limitations:**

- **"Notifications only while the panel is open":** the panel's own queue notifier (`notifyNewQueueRequests`, `readSeenRequestIds`, `writeSeenRequestIds`, `MAX_SEEN_REQUEST_IDS`) is deleted; Task 9's notifier replaces it.
- **"Update available only in the panel":** the update manager's existing background check (throttled to 12 h) now also sends one notification per new version through `boot.notifier.notifyOnce`.
  - **I-6:** it is sent only when `liteBoot.engine.isLeader()`, so two tabs loaded together cannot both announce it.
  - Trade-off: if the check finds the update in a follower tab, the notice waits until a leader tab's check (at the latest the next 12 h check). The panel's status line still shows it at once.
- **"Invoice expiry shows PENDING until reopen":** while the panel is open, the 1 s pill render re-checks a PENDING invoice once, as soon as its `expiresAt` passes.

**Settings (decision 15: they stay in the panel).** The Notifications section gets:

- notifications on/off;
- sound;
- **one toggle per event type (I-4):**
  - accepted;
  - payment verified;
  - revived;
  - failed;
  - refund verified;
  - payment received;
  - refund owed;
- reviver new-request opt-in;
- quiet hours from/to;
- profile badges.

These cost 0 B of Lite core.

**I-1:** at boot, before the Lite engine starts, `migrateNotificationSettings()` writes the Lite settings object once when it is missing, with `enabled` taken from the 0.7 desktop toggle. So `notify.js` honours a 0.7 "off" from the first poll, not only after the user saves a setting.

The new GM keys join `KEYS`, so the TornPDA storage migration carries them. Account deletion resets the notification settings, the notified-event ids and the badge cache (Minor 11).

**3a re-review fixes:**

- **M2:** a closed reviver transaction that the pill no longer shows is dropped, not refetched.
- **M4:** reopening on an idle state clears a stale "Needs attention" line.
- **M5:** `retryInitWhenShown` returns at once while a Lite boot is live. Task 5 already removed the throwing drain that triggered it; the guard stays as a defence.
- **M6:** the harness pill stub is a singleton like `pill-view.js`, and the stub boot mounts the engine pill, so "the Lite pill replaces the retry pill" is asserted directly.

M7 (the 335 B headroom) is closed by the trims: 2,123 B of headroom now.

**Files:**
- Modify: `torn-revive-chat-collector.user.js`, `test/helpers/main-harness.js`
- Test: `test/main-panel-glue.test.js`; adjust `test/client-hardening.test.js`, `test/pro-ui.test.js`, `test/requester-ui.test.js`

**Interfaces:**
- Consumes: `boot.notifier.notifyOnce` (Task 9), `boot.engine.isLeader()`, `BADGES_KEY` (Task 8), `SETTINGS_KEY` (Task 9).

- [ ] **Step 1: Harness and failing tests**

In `test/helpers/main-harness.js`:

| Find | Replace with |
| --- | --- |
| `  'refreshMe', 'requestRevive', 'cancelActiveRequest', 'runTransactionAction', 'activatePanelTab', 'renderAll'` | the same line followed by `,` and a new line `  'retryInitWhenShown', 'deleteReviveRelayAccount'` |
| `        engine: { viewModel: () => harness.view }` | `        engine: { viewModel: () => harness.view, isLeader: () => harness.leader !== false }` |
| `        start() { boot.calls.push('start'); },` | `        notifier: { notes: [], notifyOnce(id, text) { boot.notifier.notes.push([id, text]); return true; } },` / `        start() {` / `          boot.calls.push('start');` / `          context.ReviveRelayLitePillView.mountPill({ lite: true });` / `        },` |
| `    // Records the pills MAIN mounts itself (the retry pill after a failed init).` + `    ReviveRelayLitePillView: {` + `      mountPill(options) {` + `        const pill = {` | `    // Records every pill mounted (MAIN's retry pill, the engine's pill on boot.start()); like the real` / `    // pill-view module it is a singleton: mounting destroys the previous pill.` / `    ReviveRelayLitePillView: {` / `      mountPill(options) {` / `        const previous = harness.pills[harness.pills.length - 1];` / `        if (previous && !previous.destroyed) previous.destroy();` / `        const pill = {` |

In `test/main-panel-glue.test.js`, in "a failed init mounts a 'tap to retry' pill…", replace `  assert.equal(harness.boots.length, 1, 'the Lite pill replaces the retry pill');` with:
```js
  assert.equal(harness.boots.length, 1);
  assert.equal(pill.destroyed, true, 'the Lite pill replaces the retry pill');
```
Append to `test/main-panel-glue.test.js`:
```js
// ---- Plan 3b: notification settings, update notice, invoice expiry, carry-over fixes ----

const plain = value => JSON.parse(JSON.stringify(value));
const changeEvent = target => ({ type: 'change', target: { dataset: {}, ...target } });

test('boot seeds the Lite notification settings once from the 0.7 desktop toggle, so the notifier honours it', async () => {
  const off = await bootMain({ store: { reviverelay_desktop_notifications_enabled: false } });
  assert.deepEqual(plain(off.store.reviverelay_notification_settings_v1), { enabled: false });
  const on = await bootMain();
  assert.deepEqual(plain(on.store.reviverelay_notification_settings_v1), { enabled: true });
  const kept = await bootMain({ store: { reviverelay_desktop_notifications_enabled: false, reviverelay_notification_settings_v1: { enabled: true, sound: false } } });
  assert.deepEqual(plain(kept.store.reviverelay_notification_settings_v1), { enabled: true, sound: false }, 'never overwrites saved settings');
});

test('Settings saves the Lite notification, per-type and badge settings', async () => {
  const harness = await bootMain({ store: { reviverelay_desktop_notifications_enabled: false } });
  harness.view = { sheet: 'request' };
  await openPanel(harness);
  const onChange = harness.main.panel.listeners.get('change');
  onChange(changeEvent({ type: 'checkbox', checked: false, dataset: { rrNotify: 'sound' } }));
  assert.deepEqual(plain(harness.store.reviverelay_notification_settings_v1), { enabled: false, sound: false });
  onChange(changeEvent({ type: 'checkbox', checked: true, dataset: { rrNotify: 'enabled' } }));
  onChange(changeEvent({ type: 'checkbox', checked: true, dataset: { rrNotify: 'type:newRequest' } }));
  onChange(changeEvent({ type: 'checkbox', checked: false, dataset: { rrNotify: 'type:accepted' } }));
  onChange(changeEvent({ type: 'select-one', value: '22', dataset: { rrNotify: 'quietFrom' } }));
  onChange(changeEvent({ type: 'select-one', value: '', dataset: { rrNotify: 'quietTo' } }));
  assert.deepEqual(plain(harness.store.reviverelay_notification_settings_v1), { enabled: true, sound: false, types: { newRequest: true, accepted: false }, quietFrom: 22, quietTo: null });
  onChange(changeEvent({ type: 'checkbox', checked: false, dataset: { rrBadges: '' } }));
  assert.equal(harness.store.reviverelay_badges_enabled, false);
});
test('a background update check announces a new version once, from the leader tab only', async () => {
  for (const leader of [true, false]) {
    const harness = loadMain({ store: { ...SIGNED_IN } });
    harness.leader = leader;
    harness.context.ReviveRelayUpdateManager = { createUpdateManager: () => ({ check: async () => ({ updateAvailable: true, latestVersion: '1.0.2' }), openUpdate: () => false }) };
    harness.run();
    await harness.clock.flush();
    assert.deepEqual(harness.boot.notifier.notes.map(([id]) => id), leader ? ['update:1.0.2'] : [], `leader=${leader}`);
    if (leader) assert.match(harness.boot.notifier.notes[0][1], /1\.0\.2 is available/);
  }
});

test('account deletion clears the Lite notification and badge storage', async () => {
  const harness = await bootMain({ store: { ...SIGNED_IN, reviverelay_notified_events_v1: { ids: ['tx1:COMPLETED'] }, reviverelay_badge_cache_v1: [['42', {}]] } });
  harness.view = { sheet: 'request' };
  await openPanel(harness);
  await harness.main.deleteReviveRelayAccount();
  await harness.clock.flush();
  assert.equal(harness.count('POST /v1/account/delete'), 1);
  assert.equal(harness.store.reviverelay_notified_events_v1, null);
  assert.equal(harness.store.reviverelay_badge_cache_v1, null);
  assert.equal(harness.store.reviverelay_notification_settings_v1, null);
});

test('an open panel re-checks a PENDING invoice once when its expiry passes', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'reviver-pro' };
  await openPanel(harness);
  harness.main.state.currentInvoice = { id: 'inv-1', state: 'PENDING', expiresAt: new Date(harness.clock.now() - 1000).toISOString() };
  harness.main.handlePillRender({ snapshot: {} });
  await harness.clock.flush();
  harness.main.handlePillRender({ snapshot: {} });
  await harness.clock.flush();
  assert.equal(harness.count('GET /v1/pro/invoices/inv-1'), 1);
});

test('M2: a closed reviver transaction the pill no longer shows is dropped, not refetched', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'reviver-queue' };
  await openPanel(harness);
  harness.main.state.activeTransaction = { id: 'tx-7', participantRole: 'reviver', state: 'COMPLETED' };
  harness.main.handlePillRender({ snapshot: { stateVersion: 'queue-changed' } });
  await harness.clock.flush();
  assert.equal(harness.count('GET /v1/transactions/tx-7'), 0);
  assert.equal(harness.main.state.activeTransaction, null);
});

test('M4: reopening the pill on an idle state clears a stale "Needs attention" line', async () => {
  const harness = await bootMain();
  harness.view = { role: 'requester', state: 'REPORTABLE_NO_ATTEMPT', transactionId: 'tx-9', sheet: 'request-report' };
  await openPanel(harness);
  assert.match(statusLine(harness), /Needs attention/);
  harness.main.handlePillActivate();
  harness.view = { role: 'requester', state: null, transactionId: null, sheet: 'request' };
  await openPanel(harness);
  assert.doesNotMatch(statusLine(harness), /Needs attention/);
});

test('M5/M6: once the Lite boot runs, the retry path never mounts over it, and the engine pill replaces the retry pill', async () => {
  const harness = await bootMain();
  const before = harness.pills.length;
  harness.main.retryInitWhenShown();
  assert.equal(harness.pills.length, before, 'no retry pill over a live engine');
  assert.equal(harness.document.count('visibilitychange'), 0);
});
```
Replace the two panel-notifier source tests:

- In `test/pro-ui.test.js`, replace the whole test "Pro queue notifications are bounded, persisted, Pro-only and never auto-accept" with:
```js
test('queue notifications come from the Lite notifier: opt-in, count-only and never auto-accept',()=>{
  assert.match(source,/@grant\s+GM_notification/);
  assert.doesNotMatch(source,/notifyNewQueueRequests|MAX_SEEN_REQUEST_IDS/);
  const notifier=fs.readFileSync(path.resolve(__dirname,'..','src','lite','notify.js'),'utf8');
  assert.doesNotMatch(notifier,/accept\w*\(|requesterName|offerAmount/);
  assert.match(notifier,/'newRequest'/);
});
```
- In `test/requester-ui.test.js`, replace the whole test "desktop notifications can be disabled from Settings and default to enabled" with:
```js
test('Settings holds the Lite notification, sound, quiet-hours and badge controls, seeded from the 0.7 toggle', () => {
  for (const name of ['enabled', 'sound', 'type:newRequest', 'quietFrom', 'quietTo']) assert.match(source, new RegExp(`data-rr-notify="${name}"`));
  assert.match(source, /data-rr-notify="type:\$\{type\}"/);
  for (const type of ['accepted', 'paymentVerified', 'revived', 'failed', 'refundResolved', 'paymentReceived', 'refundOwed']) assert.match(source, new RegExp(`\\['${type}', '`));
  assert.match(source, /data-rr-badges/);
  assert.match(source, /notificationSettings: 'reviverelay_notification_settings_v1'/);
  assert.match(source, /storage\.get\(KEYS\.desktopNotificationsEnabled, true\) !== false/);
  assert.match(source, /function migrateNotificationSettings\(\)/);
});
```

In `test/client-hardening.test.js`, delete these three tests. They slice the deleted `notifyNewQueueRequests`; their guarantees now live in `test/lite-notify.test.js` ("dedupe store", "master switch…", "a queue notification carries only the count…"):

- "notification API is optional and absence cannot break queue processing"
- "disabled desktop notifications still record a bounded seen-ID set without delivery"
- "denied, pending, and invalid reviver state cannot disclose request details by notification"

Then change every `'refreshReviverEligibility','readSeenRequestIds'` to `'refreshReviverEligibility','notificationSettings'` (four slices).

Run: `node --test test/main-panel-glue.test.js 2>&1 | grep -E '^not ok|^# (pass|fail)'`
Expected: the eight new tests fail. The retry-pill assertion passes already, because the harness singleton alone satisfies it (M6 is a test-fidelity fix); it stays as a guard.

`bootMain(options)` spreads `options` after its own `store`, so a test that passes `store` must include `...SIGNED_IN` itself when it needs a session. The deletion test does.

- [ ] **Step 2: MAIN edits**

In `torn-revive-chat-collector.user.js`, make these edits in order:
1. Delete the panel's seen-id bound.
   Delete this whole line (exactly one occurrence):
```js
  const MAX_SEEN_REQUEST_IDS = 200;
```
2. Terminal states for M2.
   Find (exactly one occurrence):
```js
  const MASKED_VERIFICATION_KEY = '••••••••••••••••';
```
   Replace with:
```js
  const MASKED_VERIFICATION_KEY = '••••••••••••••••';
  const TERMINAL_STATE = /^(COMPLETED|REFUNDED|CANCELLED_BY_REQUESTER|PAYMENT_EXPIRED|CLOSED_|REPORTABLE_)/;
```
3. New GM keys (also migrated to TornPDA storage, because `storageKeys` is `Object.values(KEYS)`) and the per-type labels (I-4).
   Find (exactly one occurrence):
```js
    clientDiagnosticsEnabled: 'reviverelay_client_diagnostics_enabled',
    telemetryOutbox: 'reviverelay_telemetry_outbox'
  });
```
   Replace with:
```js
    clientDiagnosticsEnabled: 'reviverelay_client_diagnostics_enabled',
    telemetryOutbox: 'reviverelay_telemetry_outbox',
    notificationSettings: 'reviverelay_notification_settings_v1',
    notifiedEvents: 'reviverelay_notified_events_v1',
    badgeCache: 'reviverelay_badge_cache_v1',
    badgesEnabled: 'reviverelay_badges_enabled'
  });
  const NOTIFY_SETTINGS_KEY = KEYS.notificationSettings;
  const BADGES_KEY = KEYS.badgesEnabled;
  const NOTIFY_TYPES = Object.freeze([
    ['accepted', 'Requester: a reviver accepted (time to pay)'],
    ['paymentVerified', 'Requester: payment verified'],
    ['revived', 'Requester: revived'],
    ['failed', 'Requester: revive failed'],
    ['refundResolved', 'Requester: refund verified'],
    ['paymentReceived', 'Reviver: payment received (revive now)'],
    ['refundOwed', 'Reviver: refund owed']
  ]);
```
4. Their legacy defaults.
   Find (exactly one occurrence):
```js
    [KEYS.telemetryOutbox]: []
  });
```
   Replace with:
```js
    [KEYS.telemetryOutbox]: [],
    [KEYS.notificationSettings]: null,
    [KEYS.notifiedEvents]: null,
    [KEYS.badgeCache]: null,
    [KEYS.badgesEnabled]: true
  });
```
5. Invoice-expiry latch.
   Find (exactly one occurrence):
```js
  let updateResult = null;
```
   Replace with:
```js
  let updateResult = null;
  let expiredInvoiceChecked = null;
```
6. Replace the range that starts at the line `  function readSeenRequestIds() {` and ends just before the line `  async function refreshReviverQueue() {`. That range holds `readSeenRequestIds`, `writeSeenRequestIds`, `desktopNotificationsEnabled` and `notifyNewQueueRequests`. The find text below is abbreviated, so select the range by those two anchor lines and replace it with the block (keep one blank line before `  async function refreshReviverQueue() {`)
   Find (exactly one occurrence):
```js
  function readSeenRequestIds() {
    … (through the end of notifyNewQueueRequests) …
  }
```
   Replace with:
```js
  // Lite notification settings (src/lite/notify.js reads them). Seeded once at boot from the 0.7 desktop toggle.
  function notificationSettings() {
    const saved = storage.get(NOTIFY_SETTINGS_KEY, null);
    return saved && typeof saved === 'object' ? saved : { enabled: storage.get(KEYS.desktopNotificationsEnabled, true) !== false };
  }

  function migrateNotificationSettings() {
    const saved = storage.get(NOTIFY_SETTINGS_KEY, null);
    if (!saved || typeof saved !== 'object') storage.set(NOTIFY_SETTINGS_KEY, notificationSettings());
  }

  function hourOptions(selected) {
    const hours = [['', 'off'], ...Array.from({ length: 24 }, (_, hour) => [String(hour), `${String(hour).padStart(2, '0')}:00`])];
    return hours.map(([value, label]) => `<option value="${value}"${String(selected ?? '') === value ? ' selected' : ''}>${label}</option>`).join('');
  }

  function saveNotificationSetting(name, value) {
    const next = { ...notificationSettings() };
    if (name.startsWith('type:')) next.types = { ...(next.types || {}), [name.slice(5)]: value };
    else next[name] = value;
    storage.set(NOTIFY_SETTINGS_KEY, next);
  }
```
7. In `refreshReviverQueue`, delete the call.
   Delete this whole line (exactly one occurrence):
```js
        notifyNewQueueRequests(state.reviverQueue);
```
8. M2, in `refreshPanelData`.
   Find (exactly one occurrence):
```js
      if (reviverSide && state.activeTransaction?.participantRole === 'reviver') await refreshActiveTransaction();
```
   Replace with:
```js
      const own = state.activeTransaction;
      if (reviverSide && own?.participantRole === 'reviver') {
        if (TERMINAL_STATE.test(String(own.state)) && String(own.id) !== String(liteBoot?.engine.viewModel()?.transactionId)) state.activeTransaction = null;
        else await refreshActiveTransaction();
      }
```
9. M4, in `handlePillActivate`.
   Find (exactly one occurrence):
```js
    if (problem) setStatus(`Needs attention: ${problem}. Report it to the ReviveRelay operator.`, true);
```
   Replace with:
```js
    if (problem) setStatus(`Needs attention: ${problem}. Report it to the ReviveRelay operator.`, true);
    else if (statusMessage.startsWith('Needs attention:')) setStatus('');
```
10. Invoice expiry, in `handlePillRender`, which runs every second while the panel is open.
   Find (exactly one occurrence):
```js
    if (!panel || state.minimized || pageHidden()) return;
    if (latestPillStateVersion && latestPillStateVersion !== panelStateVersion) {
```
   Replace with:
```js
    if (!panel || state.minimized || pageHidden()) return;
    const invoice = state.currentInvoice;
    if (invoice?.state === 'PENDING' && invoice.id !== expiredInvoiceChecked && Date.parse(invoice.expiresAt) <= Date.now()) {
      expiredInvoiceChecked = invoice.id;
      refreshCurrentInvoice().then(renderLiveState, () => {});
    }
    if (latestPillStateVersion && latestPillStateVersion !== panelStateVersion) {
```
11. In `renderSettingsDrawer`.
   Find (exactly one occurrence):
```js
    const validation = RequestPreset.validatePreset(state.preset);
    const preset = validation.ok ? validation.preset : { paymentMethod: 'cash', offerAmount: 500000, comment: '' };
```
   Replace with:
```js
    const validation = RequestPreset.validatePreset(state.preset);
    const preset = validation.ok ? validation.preset : { paymentMethod: 'cash', offerAmount: 500000, comment: '' };
    const notifications = notificationSettings();
```
12. The Notifications section controls.
   Find (exactly one occurrence):
```js
        <label><input id="rr-desktop-notifications-enabled" type="checkbox" ${desktopNotificationsEnabled() ? 'checked' : ''}> Desktop notifications for new certified requests</label>
        <p class="rr-muted">Notifications are on by default while Reviver Pro is active and your reviver setup is complete. Turning them off does not affect the live queue or Accept controls.</p>
```
   Replace with:
```js
        <label><input data-rr-notify="enabled" type="checkbox" ${notifications.enabled !== false ? 'checked' : ''}> Notifications (one visible Torn tab notifies, even with this panel closed)</label>
        <label><input data-rr-notify="sound" type="checkbox" ${notifications.sound !== false ? 'checked' : ''}> Sound for accepted, revived, payment and refund events</label>
        ${NOTIFY_TYPES.map(([type, label]) => `<label><input data-rr-notify="type:${type}" type="checkbox" ${notifications.types?.[type] !== false ? 'checked' : ''}> ${label}</label>`).join('')}
        <label><input data-rr-notify="type:newRequest" type="checkbox" ${notifications.types?.newRequest === true ? 'checked' : ''}> Reviver: new queue requests (silent, at most one a minute)</label>
        <label>Quiet hours <select data-rr-notify="quietFrom">${hourOptions(notifications.quietFrom)}</select> to <select data-rr-notify="quietTo">${hourOptions(notifications.quietTo)}</select></label>
        <label><input data-rr-badges type="checkbox" ${storage.get(BADGES_KEY, true) !== false ? 'checked' : ''}> "RR verified" badges on Torn profiles</label>
```
13. In the panel's `change` handler.
   Find (exactly one occurrence):
```js
      if (event.target?.id === 'rr-desktop-notifications-enabled') {
        storage.set(KEYS.desktopNotificationsEnabled, Boolean(event.target.checked));
      }
```
   Replace with:
```js
      const notifySetting = event.target?.dataset?.rrNotify;
      if (notifySetting) {
        const raw = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        saveNotificationSetting(notifySetting, typeof raw === 'boolean' ? raw : (raw === '' ? null : Number(raw)));
      }
      if (event.target?.dataset?.rrBadges !== undefined) storage.set(BADGES_KEY, Boolean(event.target.checked));
```
14. Update notice, in `checkUpdates`, leader tab only (I-6).
   Find (exactly one occurrence):
```js
        setStatus(`ReviveRelay ${updateResult.latestVersion} update available. Open Settings → Updates to install it.`);
```
   Replace with:
```js
        setStatus(`ReviveRelay ${updateResult.latestVersion} update available. Open Settings → Updates to install it.`);
        if (liteBoot?.engine.isLeader()) liteBoot.notifier.notifyOnce(`update:${updateResult.latestVersion}`, `ReviveRelay ${updateResult.latestVersion} is available. Open the panel: Settings → Updates.`);
```
15. I-1: seed the Lite settings at boot, before `startLite()`.
   Find (exactly one occurrence):
```js
  function hydratePersistentState() {
    hydrateSession();
```
   Replace with:
```js
  function hydratePersistentState() {
    hydrateSession();
    migrateNotificationSettings();
```
16. Minor 11, in `deleteReviveRelayAccount` (the rest of the `setStatus` line is unchanged).
   Find (exactly one occurrence):
```js
        storage.set(KEYS.telemetryOutbox, []);
        setStatus('ReviveRelay account data deletion completed.
```
   Replace with:
```js
        storage.set(KEYS.telemetryOutbox, []);
        storage.set(KEYS.notificationSettings, null);
        storage.set(KEYS.notifiedEvents, null);
        storage.set(KEYS.badgeCache, null);
        setStatus('ReviveRelay account data deletion completed.
```
17. M5.
   Find (exactly one occurrence):
```js
  function retryInitWhenShown() {
    try {
```
   Replace with:
```js
  function retryInitWhenShown() {
    if (liteBoot) return;
    try {
```

Check: `grep -n "notifyNewQueueRequests\|SeenRequestIds\|MAX_SEEN\|rr-desktop-notifications-enabled\|function desktopNotificationsEnabled" torn-revive-chat-collector.user.js`
Expected: no output.

- [ ] **Step 3: Run everything**

Run: `npm run build >/dev/null && node --test test 2>&1 | grep -E '^# (pass|fail)' && node scripts/size-report.js | head -7`
Expected: `# pass 645`, `# fail 3`; `"whole": 228012`, `"liteCore": 107877`, `"liteCoreHeadroom": 2123`, `"wholeHeadroom": 3988`. Allow ±50 B on `whole` for blank lines.

- [ ] **Step 4: Commit**
```bash
git add torn-revive-chat-collector.user.js test
git commit -m "feat(panel): Lite notification, per-type and badge settings migrated at boot; leader-only update notice; invoice expiry re-check; fix M2, M4, M5, M6" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 11: Version 1.0.1, changelog, re-pinned manifest, full verification

**Why 1.0.1, not 1.1.0:**

- Spec decision 14 reserves 1.1 for the release that replaces the old panel with new sheets **and** must bring the whole file to ≤ 110 KB. Calling this 1.1.0 would claim both, and neither is true.
- Everything here is 1.0-scope work from the spec (notifications, sound, badges) plus fixes, with no new server contract.
- A higher version than the pinned 1.0.0 review build is required, so userscript managers update.
- `versioning.js` allows single digits, and 1.0.1 is valid.

As in Plan 3a, pin last: any later change to bundled source or MAIN invalidates the SHA-256.

**Files:**
- Modify: `package.json`, `CHANGELOG.md`, `README.md`, `PRIVACY.md`
- Modify tests: `test/review-package.test.js`, `test/release-build.test.js`, `test/direct-only-build.test.js`, `test/test-command.test.js`
- Modify: `docs/review/BUILD-MANIFEST.json` (generated)

**Interfaces:** none.

- [ ] **Step 1: Point the version tests at 1.0.1 (they fail first)**

| File | Change |
| --- | --- |
| `test/review-package.test.js` | `assert.equal(pkg.version,'1.0.0');` → `assert.equal(pkg.version,'1.0.1');` and replace the test "the 1.0.0 known limitations list what the final fixes left, and nothing they fixed" with the test below |
| `test/release-build.test.js` | in the first test, replace every `1.0.0` with `1.0.1` (the title, the `pkg.version` check, the file name and the `@version` check) |
| `test/direct-only-build.test.js` | `test('ReviveRelay 1.0 is versioned 1.0.0'` → `test('ReviveRelay 1.0 is versioned 1.0.1'`, `'1.0.0'` → `'1.0.1'` |
| `test/test-command.test.js` | `ReviveRelay-1.0.0.user.js` → `ReviveRelay-1.0.1.user.js` |

```js
test('the 1.0.1 notes close the 1.0.0 panel-only limitations and keep the ones still true',()=>{
  const entry=read('CHANGELOG.md').split('\n## ')[1];
  assert.match(entry,/^1\.0\.1 /);
  const limitations=entry.split('### Known limitations')[1].split('\n### ')[0];
  assert.doesNotMatch(limitations,/only fire while the panel is open/i,'notifications work with the panel closed');
  assert.doesNotMatch(limitations,/only visible inside the panel/i,'update notice outside the panel');
  assert.doesNotMatch(limitations,/PENDING until the panel is reopened/i,'invoice expiry re-check');
  assert.match(limitations,/"Revived".*per tab/i);
  assert.match(limitations,/operator/i);
  assert.match(limitations,/sheets/i,'the deferred sheets are disclosed');
  assert.match(limitations,/visible Torn tab/i,'notifications need a visible tab (I-3)');
});
```
Run: `node --test test/review-package.test.js test/release-build.test.js test/direct-only-build.test.js test/test-command.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: failures (`'1.0.0' !== '1.0.1'` and the missing `1.0.1` entry).

- [ ] **Step 2: Bump the version and write the notes**

```bash
sed -i 's/"version": "1.0.0"/"version": "1.0.1"/; s/ReviveRelay-1\.0\.0\.user\.js/ReviveRelay-1.0.1.user.js/g' package.json
sed -i 's/1\.0\.0/1.0.1/g' README.md PRIVACY.md
```
Then check: `grep -n '1\.0\.[01]' README.md PRIVACY.md package.json`. Expected: only `1.0.1` mentions, and the `check`/`verify:review` scripts name `ReviveRelay-1.0.1.user.js`.

<!-- op:find CHANGELOG.md -->
In `CHANGELOG.md`, find:
```markdown
# Changelog

```
<!-- op:replace -->
Replace with:
```markdown
# Changelog

## 1.0.1 - Notifications, sound and profile badges (review)

### Added

- Notifications no longer need the panel: one visible Torn tab per browser (the one that polls) notifies once per event. Requesters are told when a reviver accepts (time to pay), when payment is verified, when they are revived, when a revive fails and when a refund is verified. Revivers are told when payment arrives (revive now) and when a refund is owed.
- A short, soft chime plays for accepted, revived, refund verified, payment received and refund owed. One Settings toggle turns all sound off.
- Settings → Notifications adds notifications on/off, one toggle per event type, sound, quiet hours, opt-in silent new-queue-request notices for revivers (at most one a minute, count only) and an opt-out for profile badges. A 0.7 "desktop notifications off" choice carries over.
- An "RR verified requester/reviver" chip appears next to a player's name on their Torn profile when ReviveRelay has verified them. It is looked up only while you are signed in and the profile is visible, and cached for 10 minutes across page loads.
- A newer ReviveRelay version is announced once by notification, even with the panel closed.
- An open panel re-checks a Pro invoice as soon as it expires.

### Changed

- New-request notifications for revivers are now opt-in and silent (0.7 had them on by default), and they give only the queue count.

### Removed

- The opt-in Diagnostics option (off by default) and its error reports. ReviveRelay 1.0.1 sends no diagnostics.

### Fixed

- After a failed poll, a new polling tab polls at once instead of waiting a full cadence.
- A background tab no longer uses up the 5 s "Revived" display before you look at it.
- The panel no longer re-fetches a reviver transaction that has closed, and reopening it on an idle pill clears an old "Needs attention" line.

### Known limitations

- Notifications and sound need a visible Torn tab (or TornPDA in the foreground): hidden tabs do no work, so with every Torn tab in the background nothing is checked or announced until one is shown again. There is no tab-title fallback.
- Duplicate notifications are possible only if two tabs poll at once (a browser without BroadcastChannel, or several TornPDA tabs).
- The new requester and reviver sheets, and hospital-list "RR" badges, come in 1.1. Everyday requests, the reviver queue and transactions still open in the panel from the pill.
- "Revived" shows for 5 s from when each tab first displays it; this is kept per tab and in memory, so a tab opened or reloaded within 30 s of the revive shows it again for up to 5 s.
- For a reviver, a failed transaction that needs reporting shows "Needs attention" on the pill only while the Queue count is not shown.
- There is no in-app way to report a problem yet: the panel says what happened and asks you to report it to the ReviveRelay operator.
- Browsers may block the first chime until you have clicked the page once.
- The whole file is 228.0 KB; the light core is 107.9 KB.

### Release status

1.0.1 is a Beta/Review candidate on the review channel. Stable remains 0.4.4; 0.7.3 remains the rollback.

```

- [ ] **Step 3: Commit the source that the manifest will pin**
```bash
git add package.json CHANGELOG.md README.md PRIVACY.md test
git commit -m "release: ReviveRelay 1.0.1 notifications, badges and trims" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Expected between Step 3 and Step 5 (Minor 3).** After the bump, the three release-pin tests are green: the manifest version differs, so they use HEAD. But `test/review-package.test.js` "the pinned build manifest pins the current package version" fails, because the manifest still says 1.0.0. Steps 4–5 fix it; do not change the test.

- [ ] **Step 4: Build from that commit and write the manifest (the Plan 3a script)**

The manifest pins 1.0.0, so `npm run build` makes a fresh 1.0.1 artifact from HEAD (`resolveBuildIdentity` only reproduces a manifest of the same version).
```bash
npm run build
node -e '
const fs=require("fs");const crypto=require("crypto");const cp=require("child_process");
const version=require("./package.json").version;const artifact=`dist/review/ReviveRelay-${version}.user.js`;
const bytes=fs.readFileSync(artifact);const text=bytes.toString("utf8");
const commit=text.match(/ReviveRelay-Build-Commit:\s*([0-9a-f]{40})/)[1];
const buildTimestamp=text.match(/ReviveRelay-Build-Timestamp:\s*(\S+)/)[1];
if(commit!==cp.execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim())throw new Error("artifact was not built from HEAD");
const previous=JSON.parse(fs.readFileSync("docs/review/BUILD-MANIFEST.json","utf8"));
const manifest={product:"ReviveRelay",version,channel:"review",artifact,artifactSourceCommit:commit,buildTimestamp,sha256:crypto.createHash("sha256").update(bytes).digest("hex"),sizeBytes:bytes.length,updateUrl:previous.updateUrl,downloadUrl:previous.downloadUrl,publicProductionVersion:previous.publicProductionVersion,publicPromoted:false};
fs.writeFileSync("docs/review/BUILD-MANIFEST.json",JSON.stringify(manifest,null,2)+"\n");console.log(manifest);'
```
Expected:

- the build prints `Built immutable ReviveRelay 1.0.1 review artifact at <HEAD>`;
- the manifest shows `version: '1.0.1'`, `artifactSourceCommit` = `git rev-parse HEAD` and `sizeBytes: 228012`.

`sizeBytes` is ±0: the version strings have the same length. If it differs, stop and run `node scripts/size-report.js`.

- [ ] **Step 5: Commit the manifest and verify the pinned reproduction**
```bash
git add docs/review/BUILD-MANIFEST.json
git commit -m "release: pin the ReviveRelay 1.0.1 review artifact" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Run: `npm run build && node scripts/verify-review-artifact.js && npm run audit:review`
Expected:

- `Built immutable ReviveRelay 1.0.1 review artifact at <pinned commit> (reproduced from pinned manifest)`;
- then `"ok": true` with `"sizeBytes": 228012`;
- then the audit's `"ok": true` with `"findings": []`.

- [ ] **Step 6: Run everything**

Run: `npm run test:client 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 648`, `# fail 0` (the known trio is green again).

Run: `(cd server && TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55442/postgres npm test 2>&1 | grep -E '^# (pass|fail)')`, with the Plan 3a test database running.
Expected: `# pass 407`, `# fail 0` (no server change).

Run: `node --check dist/review/ReviveRelay-1.0.1.user.js && node scripts/size-report.js | head -7`
Expected:

- `ok`;
- `"liteCore": 107877` (≤ 110,000, headroom 2,123 ≥ 2,000);
- `"whole": 228012` (≤ 232,000, headroom 3,988).

---

## Real-browser and TornPDA smoke test (owner; cannot run on this host)

Use the pinned 1.0.1 review build from Task 11. Record results in the PR. Notifications need at least one **visible** Torn tab: hidden tabs do no work by design.

1. **Notifications with the panel closed, desktop (Tampermonkey and Violentmonkey).** Keep one Torn tab visible on each account.
   - Request a revive from account A and accept it from reviver B.
   - A gets exactly one "A reviver accepted: time to pay" desktop notification with a soft chime.
   - Then, in order: "Payment verified" (silent) → B gets "Payment received: revive now" (chime) → A gets "You were revived" (chime).
   - Repeat with three Torn tabs open on each account, one visible: still exactly one notification per event (DevTools: only the leader tab logs `/v1/state`).
   - Hide every Torn tab: there are no polls and no notifications. When a tab is shown again, any event that happened meanwhile is notified once.
2. **Sound.**
   - The first chime may be blocked until you have clicked the page once (browser autoplay policy). Note whether it plays without a prior click in Chrome, Firefox and TornPDA.
   - Turn "Sound" off in Settings: notifications stay, chimes stop.
3. **Settings.**
   - Turn off one event type (for example "Requester: payment verified"): only that one stops.
   - Set quiet hours to cover the current hour: no notification and no chime. Switch them off: the next new event notifies, and the suppressed one does not replay.
   - On a profile that had 0.7 "Desktop notifications" off, update to 1.0.1: Settings shows notifications off, and no notification arrives (I-1).
4. **Reviver new requests.** Off by default (0.7 had them on: CHANGELOG "Changed"). Opt in: a new queue request gives one silent "New revive request (n in queue)", at most one a minute, and the text names no player.
5. **TornPDA (Android, and iOS if available)**, with the app in the foreground.
   - Each event shows the in-page toast once, with the chime.
   - With the app backgrounded, nothing is polled or shown. Events are notified once when you return, if they are still current.
   - Settings survive an app restart: `reviverelay_notification_settings_v1`, `reviverelay_notified_events_v1` and `reviverelay_badge_cache_v1` are migrated to PDA storage.
   - With two PDA tabs: does each tab poll and notify? This is the pre-existing "PDA single WebView" assumption, where duplicates are possible; see Appendix B.
6. **Profile badge.**
   - Signed in, open the profile of a verified reviver: an "RR verified reviver" chip appears next to the name, exactly once, including after Torn SPA navigation and back/forward.
   - Middle-click a profile from the hospital list, then switch to that tab: the chip appears on arrival (I-5).
   - Check the slot selectors `#profileroot .profile-wrapper .title-black` and `.content-title h4` on live Torn, desktop and PDA. If neither matches, record the right selector.
   - Turn "Profile badges" off: no chip and no `/badge` request.
   - Reload within 10 minutes: no new `/badge` request (GM-persisted LRU).
   - Sign out: no `/badge` request at all on profile pages (I-2).
7. **Update notice.**
   - With a newer review build published (or the update state edited), one notification "ReviveRelay x.y.z is available…" appears per version, with the panel closed.
   - It appears from the leader tab only, even after a session restore of several tabs.
8. **Invoice expiry.** Create a Pro invoice and keep the panel open past `expiresAt`: within a second the panel shows EXPIRED without reopening.
9. **Regression checks from Plan 3a:**
   - the pill sits in the header (light and dark) and falls back to the launcher;
   - hiding or closing the leader hands over within 5 s;
   - a sign-out in one tab blanks every tab;
   - no Diagnostics option in Settings, and no `/v1/telemetry/errors` request in DevTools.

---

## Appendix A: Owner decisions (taken 2026-11-26) and the numbers behind them

**D-1. Sheets → 1.1 (decided).**

- A compact requester and reviver sheet prototype measures **12,090 B**. 1.0.1 + sheets would be ≈ **120,550 B** Lite core: ≈ 10,550 B over the gate and ≈ 12,550 B short of the 2 KB margin.
- The prototype covers:
  - popover on desktop, bottom sheet on coarse pointers;
  - Esc, outside-click and close button;
  - every state card with its actions;
  - keyed, sorted queue rows with "Taken by another reviver" and a 3 s highlight;
  - no innerHTML.
- No spec-preserving core trims remain.

**For 1.1:**

- Design the sheets against the 110 KB whole-file target from the start.
- When they land, delete the panel's request/queue/activity rendering, `requestRevive`, `cancelActiveRequest`, `acceptMarketplaceRequest`, `runTransactionAction`, `refreshReviverQueue` and the transaction cards. That frees ≈ 20 KB of the whole file.
- Spec-visible core trims the owner could still sanction then, with sizes:
  - the heartbeat election fallback for browsers without Web Locks: ≈ 6–7 KB of `tab-leader.js`;
  - the TornPDA storage migration/recovery: ≈ 2.5 KB;
  - the TornPDA in-page toast: ≈ 1.3 KB.

**D-2. Hospital-list "RR" badges → 1.1 (decided).**

- `/v1/state` carries only `queue.count`. The rows the spec relies on ("the shared queue state; no extra requests") exist only while a queue sheet is open, which is itself 1.1.

**D-3. Sound: synthesized chime accepted for now (decided).**

- A 0.4 s WebAudio chime: no binary asset, no fetch, ≈ 600 B.
- A recorded sample as a data URI would cost several KB of core.
- Revisit after smoke item 2 if needed.

**Per-type toggles (I-4): no decision needed.**

- They are panel controls over settings that `notify.js` already reads, so they cost 0 B of core and ≈ 600 B of the whole file.
- They fit: 2,123 B core headroom, 3,988 B whole headroom.

## Appendix B: Carry-over and review disposition

| Item | Where |
| --- | --- |
| Plan 3 input 7: notifications leader-only, in `apply()`, live, GM dedupe, sound | Tasks 6, 9 |
| Input 8: sheet uses `setSheetOpen` and the 1 s tick | With the sheets, in 1.1 (D-1). The prototype uses only the engine tick |
| Input 11: badge GM LRU, no caching of malformed 200s, token never in errors | Task 7 |
| Minor: `api.reset()` also cleared the badge LRU | Tasks 6 and 7 (`reset` keeps it; `clearBadges` runs on a session change) |
| Minor: scheduler back-off ignored `delay()=null` | Task 6 |
| Minor: Web Locks present but BroadcastChannel missing → every tab solo | **Not changed.** Taking the lock without a state channel would leave followers unable to receive state. TornPDA deliberately passes no channel; this needs the real-device answer to smoke item 5 first |
| Other notes: header and profile selectors unverified | Smoke items 6 and 9 |
| Other notes: abroad wording regex (server) | Unchanged; needs the owner's public key |
| Other notes: legacy MAIN source-regex tests | Rewritten or retired in Tasks 5 and 10 (listed there) |
| M1 / M2 / M3 / M4 / M5 / M6 | Tasks 6, 10, 6, 10, 10, 10 |
| M7: 335 B headroom | 2,123 B after Tasks 2–10 |
| CHANGELOG: notifications only while the panel is open | Tasks 9, 10. The new limitation "needs a visible Torn tab" is disclosed (I-3) |
| CHANGELOG: "Update available" only in the panel | Task 10, leader-only (I-6) |
| CHANGELOG: invoice PENDING until reopen | Task 10 |
| Review I-1 (0.7 toggle ignored by the notifier) | Task 10, `migrateNotificationSettings()` at boot, with a test |
| Review I-2 (badge lookups while signed out) | Task 8, token gate, with a test |
| Review I-3 (dead title fallback) | Task 9 drops it. **Spec deviation:** "tab title badge as fallback on PDA" is not implemented. On PDA the toast always shows, and hidden tabs never poll, so a title badge could not fire. Disclosed in the CHANGELOG |
| Review I-4 (per-type toggles) | Task 10 |
| Review I-5 (background-opened profiles) | Task 8, `visibilitychange` re-scan, with a test |
| Review I-6 (update notice not leader-only) | Task 10, `isLeader()` gate, with a test |
| Review Minor 1 (four Task 10 find strings) | Re-verified against `666ea60`: the deletions are now "delete this line" with no trailing blank lines |
| Review Minor 2 (counts) | Task 2 is now `23`; Task 5 is now −9,991; Task 10 notes that the retry-pill guard passes first |
| Review Minor 3 | Note after Task 11 Step 3 |
| Review Minor 4 (GM write every poll) | Task 9, written only on change, with a test |
| Review Minor 5 (non-atomic dedupe) | Disclosed in the CHANGELOG: duplicates are possible only when two tabs lead at once (no BroadcastChannel, or several TornPDA tabs) |
| Review Minor 6 (stored LRU validation, `null` body) | Task 7, `validBadge()` on both paths, with tests. **Known:** each tab writes back its whole in-memory map, so a `clearBadges` in one tab can be undone by a stale write from another tab. Impact: badge flags for other players may survive a sign-out for up to 10 minutes. These are public verification flags, not account data |
| Review Minor 7 (stale diagnostics docs) | Task 5 docs table |
| Review Minor 8 (badge endpoint and privacy disclosure) | Task 8 |
| Review Minor 9 (reviver queue notices now opt-in) | CHANGELOG "Changed" |
| Review Minor 10 (boot test title) | Task 9 test renamed |
| Review Minor 11 (deletion leaves keys) | Task 10, with a test |
| Review Minor 12 (`requestIdleCallback`, three-tab test) | Task 8 note; the Task 6 hook test now uses three tabs |

## Self-review notes

**Spec coverage:**

| Spec item | Where |
| --- | --- |
| Notifications: requester and reviver event lists, once per event id across tabs, `GM_notification` (title badge: recorded deviation), quiet hours, per-type toggles | Tasks 6, 9, 10 |
| Sound per decision 5 | Task 9; D-3 |
| Profile badges: visible page (including on becoming visible), signed in only, 10 min memory + GM LRU of 200, `data-rr-badge`, opt-out | Tasks 7, 8, 10 |
| Hospital badges, sheets | 1.1 (D-1, D-2) |
| Size gates unchanged, ≥ 2 KB margin | Size verdict, Tasks 1–5, 9, 11 |
| Single-actor invariant | Task 6 (three tabs) and Task 10 (update notice) |

**Placeholder scan:**

- Every code step has the full code or an exact find/replace.
- The Task 10 find strings were re-run against the source with exact-count matching on the prototype.
- The only computed outputs are byte counts from the prototype builds and the generated notes and manifest.

**Names used across tasks:**

| Name | Defined in |
| --- | --- |
| `measure`, `artifactText` | Task 1 |
| `createPanelApiClient`, `validateReviewRuntime`, `safeParseBody`, `segment`, `setBoundToken` | Task 3 |
| `onLiveSnapshot`, `clearBadges` | Tasks 6–7 |
| `BADGE_CACHE.key`, `validBadge` | Task 7 |
| `createBadges`, `BADGES_KEY`, `scanWhenVisible` | Task 8 |
| `createNotifier`, `SEEN_KEY`, `SETTINGS_KEY`, `notifyOnce`, `boot.notifier` | Task 9 |
| `notificationSettings`, `migrateNotificationSettings`, `saveNotificationSetting`, `hourOptions`, `NOTIFY_TYPES`, `NOTIFY_SETTINGS_KEY`, `TERMINAL_STATE`, `expiredInvoiceChecked` | Task 10 |
