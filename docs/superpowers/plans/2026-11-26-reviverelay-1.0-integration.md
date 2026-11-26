# ReviveRelay 1.0 Integration (Plan 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ReviveRelay 1.0.0: the Lite engine and header pill become the userscript's runtime (one scheduler, no `setInterval`, `/v1/state` outcomes reach the pill), while the rarely used 0.7 screens keep working through the existing panel, opened from the pill.

**Architecture:** Plan 3a of the "Staged: core first" rollout. The server adds `recentlyClosed` and `serverTime` to `/v1/state`; the pill state and engine consume them, and gain session awareness (signed-out, expired, never another user's cache). A new `src/lite/boot.js` wires the engine to the real platform transport, GM/PDA storage and page lifecycle. The userscript entry (MAIN, `torn-revive-chat-collector.user.js`) drops its nine intervals, the sidebar action and the 0.7.3 launcher, starts the Lite boot, and opens the existing panel from the pill; the panel refreshes only while open, when the pill's `stateVersion` changes. Plan 3b (later) replaces the everyday panel flows with sheets.

**Tech Stack:** Userscript (Tampermonkey/Violentmonkey/TornPDA), UMD modules bundled verbatim by `scripts/build.js`, `node:test` with in-repo fakes (no jsdom); server Node 20, Fastify, PostgreSQL 16 via `pg`.

**Branch:** cut `feat/reviverelay-1.0-integration` from `feat/reviverelay-1.0-client-engine` (which already contains the Plan 1 server work, PR #17, and the Plan 2 engine, PR #18).

## Global Constraints

- Owner decision (binding): "Staged: core first." 1.0 ships the Lite engine and header pill; key/verification setup, Pro plans/invoices, settings (incl. diagnostics), account deletion and reviver registration keep working through the EXISTING panel, opened from the pill. New requester/reviver sheets, profile badges UI, notifications and sound are Plan 3b.
- Single-actor invariant (spec): "For one browser profile, at most one tab polls the server and at most one tab fires a given notification. Other tabs render shared state."
- No recurring `setInterval` anywhere in MAIN or `src/lite/*`; all recurring work goes through the engine's one scheduler. One-shot `setTimeout`s for header re-placement are allowed.
- Performance budget (spec): "Bundled userscript ≤ 110 KB unminified" (1 KB = 1000 bytes, as the spec's "172 KB" for the 172,402-byte 0.7.3 build). In 3a it gates the Lite core (bundle minus the legacy panel); the whole bundle gets a ratchet ceiling (Task 9).
- Bundled modules stay byte-identical to their source files (`scripts/release-client.js` `validateBundledModuleBytes` and pinned-dependency verification depend on it): no build-time comment stripping or minification.
- Versions: single-digit components only (`src/versioning.js`: `^[0-9]\.[0-9]\.[0-9]$`). This release is `1.0.0`.
- Session/auth: on sign-in, sign-out or account deletion the pill resets (`api.reset()`, cache cleared, engine restarted); a 401/`AUTH_REQUIRED` from `/v1/state` renders "Sign in again" (never "Offline") and stops polling until re-auth; a cached or broadcast snapshot whose `me.tornId` differs from the stored identity is never painted.
- Lite sources: no `innerHTML`/`outerHTML`/`insertAdjacentHTML`, no `eval`/`new Function`, no `fetch`/`XMLHttpRequest`, no `localStorage`/`sessionStorage`/`indexedDB` (pinned by `test/lite-bundle.test.js`).
- Server poll hint unchanged: "`nextPollMs`: 5000 with an active request or any open transaction, 20000 for revivers, 60000 otherwise." Recently closed transactions do not make a user "active".
- Code style: CommonJS/UMD, two-space indent, single quotes; server repository pattern `async function x(pool, input)` plus `createXRepository(pool)`.
- Commit after every task; end each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Setup (once, before Task 1)

```bash
git switch -c feat/reviverelay-1.0-integration feat/reviverelay-1.0-client-engine
(cd server && npm install)
docker run -d --rm --name rr-plan3a-testdb -e POSTGRES_PASSWORD=test -p 127.0.0.1:55442:5432 postgres:16
export TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55442/postgres
```

Client commands run from the repository root (`npm run test:client` builds first; `node --test test/<file>` runs one file against the last build). Server commands run from `server/` with `TEST_DATABASE_URL` exported. Stop the database at the end with `docker stop rr-plan3a-testdb`.

Baseline on the source branch: client 558 pass; server 399 pass, 2 fail (`test/routes/admin-pro.test.js`: two tests use fixed September 2026 dates and expired on the calendar; Task 1 fixes them).

## File Structure

| File | Responsibility |
| --- | --- |
| Modify `server/test/routes/admin-pro.test.js` | Clock-independent Pro grant/invoice dates (Task 1) |
| Modify `server/src/db/transactions.js` | `listRecentlyClosedTransactionIdsForUser` (outcomes 30 s, reportables 1 h) |
| Create `server/test/db/recently-closed.test.js` | Repository windows, ordering, participants |
| Modify `server/src/routes/state.js` | `recentlyClosed` array and `serverTime` (outside `stateVersion`) |
| Modify `server/test/routes/state.test.js` | Contract tests for both fields |
| Modify `src/lite/pill-state.js` | Outcomes from `recentlyClosed`, clock skew, `signed-out`/`expired` views |
| Modify `src/lite/engine.js` | Session gate, auth expiry, identity guard, skew capture, `relayout`, `onRender`, `resetSession` |
| Create `src/lite/boot.js` | Global `ReviveRelayLiteBoot`: state client + engine + page lifecycle + tab id |
| Modify `scripts/client-modules.js` | Lite modules bundled; sidebar action dropped; `LEGACY_PANEL_MODULES` for the size gate |
| Modify `torn-revive-chat-collector.user.js` (MAIN) | 1.0 entry: Lite boot, pill opens panel, no intervals/sidebar/launcher |
| Delete `src/sidebar-action.js` | Replaced by the header pill |
| Create `test/lite-engine-session.test.js`, `test/lite-boot.test.js`, `test/lite-userscript-boot.test.js`, `test/bundle-size.test.js` | New behaviour, real-bundle boot smoke test, size gate |
| Modify/Delete legacy MAIN source-regex tests | Retired or rewritten one by one (Task 8 table) |
| Modify `package.json`, `CHANGELOG.md`, `docs/review/BUILD-MANIFEST.json` | 1.0.0 and the re-pinned review artifact |

## Interfaces used across tasks

- `/v1/state` 200 body (Task 3): existing fields plus `recentlyClosed: Transaction[]` (same shape as `activeTransactions`, newest `closedAt` first; `COMPLETED`/`REFUNDED` for 30 s, `REPORTABLE_*` for 1 h) and `serverTime: string` (ISO, not hashed into `stateVersion`).
- `PillState.derivePill(snapshot, freshness, now)` (Task 4): `freshness` ∈ `FRESHNESS` (`live`/`syncing`/`offline`) or `SESSION_STATES` (`signed-out`/`expired`); honours `snapshot.clockSkewMs`.
- `createLiteEngine({ ..., getSession: () => ({ signedIn: boolean, tornId: number|null }), onRender: ({ view, snapshot, freshness }) => void })` returns `{ start, stop, setSheetOpen, refresh, relayout, resetSession, isStarted, isLeader, viewModel }` (Task 5).
- `ReviveRelayLiteBoot.createLiteBoot({ platform, window, document, baseUrl, clientVersion, releaseChannel, getToken, getSession, onActivate, onRender, clock?, headerSelectors? })` returns `{ start, stop, resetSession, setPanelOpen(open), refresh, tabId, api, engine }`; `RELAYOUT_DELAYS_MS = [150, 1000, 3000]` (Task 6).
---

### Task 1: Make the two date-bound admin-pro tests clock-independent

The suite must be green before new work. Both tests grant Pro at a fixed September 2026 date, then call routes that use the real clock, so the one-month grant has expired.

**Files:**
- Modify: `server/test/routes/admin-pro.test.js` (tests "manual revoke exposes REVOKED Pro state…" and "full refund preserves paid invoice/evidence…")

**Interfaces:** none.

- [ ] **Step 1: Confirm the failure**

Run: `cd server && node --test test/routes/admin-pro.test.js`
Expected: `# pass 5`, `# fail 2` (`'EXPIRED'` where `'ACTIVE'` was expected).

- [ ] **Step 2: Date the grant and the invoice relative to now**
<!-- op:find server/test/routes/admin-pro.test.js -->
Find in `server/test/routes/admin-pro.test.js`:
```js
    await repo.grantManual({userId,months:1,reason:'initial manual entitlement',operatorTornId:3877028,now:new Date('2026-09-01T12:00:00Z')});
```
<!-- op:replace -->
Replace with:
```js
    // The route revokes at the real current time, so the grant must still be active then.
    await repo.grantManual({userId,months:1,reason:'initial manual entitlement',operatorTornId:3877028,now:new Date(Date.now()-24*60*60*1000)});
```
<!-- op:find server/test/routes/admin-pro.test.js -->
Find in `server/test/routes/admin-pro.test.js`:
```js
    const createdAt=new Date('2026-09-07T09:00:00Z');
    const invoice=await invoices.createInvoice({userId,tornId,planId:'monthly',currency:'cash',now:createdAt});
    const paidAt=new Date('2026-09-07T09:02:00Z');
```
<!-- op:replace -->
Replace with:
```js
    // The route refunds at the real current time, so the paid month must still be running then.
    const createdAt=new Date(Date.now()-60*60*1000);
    const invoice=await invoices.createInvoice({userId,tornId,planId:'monthly',currency:'cash',now:createdAt});
    const paidAt=new Date(createdAt.getTime()+2*60*1000);
```
<!-- op:find server/test/routes/admin-pro.test.js -->
Find in `server/test/routes/admin-pro.test.js`:
```js
      evidenceAt:new Date('2026-09-07T09:01:00Z'),
```
<!-- op:replace -->
Replace with:
```js
      evidenceAt:new Date(createdAt.getTime()+60*1000),
```
- [ ] **Step 3: Run the tests**

Run: `cd server && node --test test/routes/admin-pro.test.js`
Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 4: Commit**
```bash
git add server/test/routes/admin-pro.test.js
git commit -m "test(server): date admin Pro fixtures relative to the real clock" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 2: Repository query for recently closed transactions

**Files:**
- Modify: `server/src/db/transactions.js`
- Test: `server/test/db/recently-closed.test.js`

**Interfaces:**
- Produces: `listRecentlyClosedTransactionIdsForUser(pool, userId, { now: Date }) → Promise<string[]>` (also on `createTransactionRepository(pool)` as `listRecentlyClosedTransactionIdsForUser(userId, { now })`), `RECENTLY_CLOSED_WINDOW_MS = { OUTCOME: 30000, REPORTABLE: 3600000 }`. Returns ids of transactions the user takes part in, closed at or before `now`: `COMPLETED`/`REFUNDED` closed within 30 s, `REPORTABLE_NO_ATTEMPT`/`REPORTABLE_MISSING_REFUND` within 1 h; newest `closed_at` first, then id; at most 10.

- [ ] **Step 1: Write the failing test**
<!-- op:file server/test/db/recently-closed.test.js -->
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { acceptRequest, createTransactionRepository, RECENTLY_CLOSED_WINDOW_MS } = require('../../src/db/transactions');

const NOW = new Date('2026-11-26T12:00:00Z');

async function insertUser(pool, tornId, name) {
  return (await pool.query('INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id', [tornId, name])).rows[0].id;
}

async function openTransaction(pool, requesterId, reviverId) {
  await pool.query(`
    INSERT INTO api_credentials (user_id,ciphertext,iv,auth_tag,access_scope,purpose,capability,last_validated_at)
    VALUES ($1,'c','i','t','{}'::jsonb,'transaction_verification','{"requester":true,"reviver":false}'::jsonb,now())
    ON CONFLICT DO NOTHING
  `, [requesterId]);
  const requestId = (await pool.query("INSERT INTO revive_requests (requester_id,payment_method,offer_amount,state) VALUES ($1,'cash',500000,'AVAILABLE') RETURNING id", [requesterId])).rows[0].id;
  const accepted = await acceptRequest(pool, { requestId, reviverId, now: new Date(NOW.getTime() - 10 * 60 * 1000) });
  assert.equal(accepted.accepted, true);
  return accepted.transaction.id;
}

async function close(pool, transactionId, state, closedAt) {
  await pool.query('UPDATE transactions SET state=$2, closed_at=$3 WHERE id=$1', [transactionId, state, closedAt]);
  await pool.query('UPDATE revive_requests SET state=$2, closed_at=$3 WHERE id=(SELECT request_id FROM transactions WHERE id=$1)', [transactionId, state, closedAt]);
}

test('recently closed lists outcomes for 30 s and reportables for one hour, newest first, for both participants only', async () => {
  await withDisposableDatabase('recently_closed', async pool => {
    const requester = await insertUser(pool, 880001, 'Req');
    const reviver = await insertUser(pool, 880002, 'Rev');
    const bystander = await insertUser(pool, 880003, 'Other');
    await pool.query("INSERT INTO revivers (user_id,standing) VALUES ($1,'active')", [reviver]);
    const repo = createTransactionRepository(pool);

    // One open request per requester: each transaction is closed before the next one opens.
    const closedAgo = async (state, ms) => {
      const id = await openTransaction(pool, requester, reviver);
      await close(pool, id, state, new Date(NOW.getTime() - ms));
      return id;
    };
    const completed = await closedAgo('COMPLETED', 5 * 1000);
    const refunded = await closedAgo('REFUNDED', 20 * 1000);
    const reportable = await closedAgo('REPORTABLE_NO_ATTEMPT', 50 * 60 * 1000);
    await closedAgo('COMPLETED', RECENTLY_CLOSED_WINDOW_MS.OUTCOME + 1000);
    await closedAgo('REPORTABLE_MISSING_REFUND', RECENTLY_CLOSED_WINDOW_MS.REPORTABLE + 1000);
    await closedAgo('PAYMENT_EXPIRED', 2 * 1000);
    const stillOpen = await openTransaction(pool, requester, reviver);

    const expected = [completed, refunded, reportable];
    assert.deepEqual(await repo.listRecentlyClosedTransactionIdsForUser(requester, { now: NOW }), expected);
    assert.deepEqual(await repo.listRecentlyClosedTransactionIdsForUser(reviver, { now: NOW }), expected);
    assert.deepEqual(await repo.listRecentlyClosedTransactionIdsForUser(bystander, { now: NOW }), []);
    assert.equal((await repo.listRecentlyClosedTransactionIdsForUser(requester, { now: NOW })).includes(stillOpen), false);
  });
});

test('recently closed ignores closures stamped after now and rejects an invalid clock', async () => {
  await withDisposableDatabase('recently_closed_clock', async pool => {
    const requester = await insertUser(pool, 880011, 'Req');
    const reviver = await insertUser(pool, 880012, 'Rev');
    await pool.query("INSERT INTO revivers (user_id,standing) VALUES ($1,'active')", [reviver]);
    const repo = createTransactionRepository(pool);
    const future = await openTransaction(pool, requester, reviver);
    await close(pool, future, 'COMPLETED', new Date(NOW.getTime() + 60 * 1000));
    assert.deepEqual(await repo.listRecentlyClosedTransactionIdsForUser(requester, { now: NOW }), []);
    await assert.rejects(repo.listRecentlyClosedTransactionIdsForUser(requester, { now: new Date('nope') }), /valid Date/);
  });
});

```
- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && node --test test/db/recently-closed.test.js`
Expected: `# fail 2` with `TypeError: repo.listRecentlyClosedTransactionIdsForUser is not a function`.

- [ ] **Step 3: Implement the query**
<!-- op:find server/src/db/transactions.js -->
Find in `server/src/db/transactions.js`:
```js
async function listOpenTransactionIdsForUser(pool, userId) {
```
<!-- op:replace -->
Replace with:
```js
// Closed transactions the client still has to show: an outcome (Revived / Refunded) for
// 30 s after it closed, and a reportable failure (Needs attention) for one hour.
const RECENTLY_CLOSED_WINDOW_MS = Object.freeze({ OUTCOME: 30 * 1000, REPORTABLE: 60 * 60 * 1000 });
const RECENT_OUTCOME_STATES = Object.freeze(['COMPLETED', 'REFUNDED']);
const RECENT_REPORTABLE_STATES = Object.freeze(['REPORTABLE_NO_ATTEMPT', 'REPORTABLE_MISSING_REFUND']);

async function listRecentlyClosedTransactionIdsForUser(pool, userId, { now = new Date() } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('now must be a valid Date');
  const outcomeSince = new Date(now.getTime() - RECENTLY_CLOSED_WINDOW_MS.OUTCOME);
  const reportableSince = new Date(now.getTime() - RECENTLY_CLOSED_WINDOW_MS.REPORTABLE);
  const result = await pool.query(`
    SELECT id
    FROM transactions
    WHERE (requester_id = $1 OR reviver_id = $1)
      AND closed_at IS NOT NULL
      AND closed_at <= $2
      AND (
        (state = ANY($3::text[]) AND closed_at > $4)
        OR (state = ANY($5::text[]) AND closed_at > $6)
      )
    ORDER BY closed_at DESC, id ASC
    LIMIT 10
  `, [userId, now, RECENT_OUTCOME_STATES, outcomeSince, RECENT_REPORTABLE_STATES, reportableSince]);
  return result.rows.map(row => row.id);
}

async function listOpenTransactionIdsForUser(pool, userId) {
```
<!-- op:find server/src/db/transactions.js -->
Find in `server/src/db/transactions.js`:
```js
    listOpenTransactionIdsForUser(userId) {
      return listOpenTransactionIdsForUser(pool, userId);
    }
  };
```
<!-- op:replace -->
Replace with:
```js
    listOpenTransactionIdsForUser(userId) {
      return listOpenTransactionIdsForUser(pool, userId);
    },
    listRecentlyClosedTransactionIdsForUser(userId, options) {
      return listRecentlyClosedTransactionIdsForUser(pool, userId, options);
    }
  };
```
<!-- op:find server/src/db/transactions.js -->
Find in `server/src/db/transactions.js`:
```js
module.exports = {
  REQUESTER_STATUS_STALE_MS,
```
<!-- op:replace -->
Replace with:
```js
module.exports = {
  REQUESTER_STATUS_STALE_MS,
  RECENTLY_CLOSED_WINDOW_MS,
```
<!-- op:find server/src/db/transactions.js -->
Find in `server/src/db/transactions.js`:
```js
  listOpenTransactionIdsForUser,
  createTransactionRepository
```
<!-- op:replace -->
Replace with:
```js
  listOpenTransactionIdsForUser,
  listRecentlyClosedTransactionIdsForUser,
  createTransactionRepository
```
- [ ] **Step 4: Run the test**

Run: `cd server && node --test test/db/recently-closed.test.js test/db/open-transaction.test.js`
Expected: `# fail 0` (2 new tests plus the existing open-transaction tests).

- [ ] **Step 5: Commit**
```bash
git add server/src/db/transactions.js server/test/db/recently-closed.test.js
git commit -m "feat(server): list recently closed transactions for the state endpoint" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 3: `/v1/state` returns `recentlyClosed` and `serverTime`

`recentlyClosed` lets outcomes reach the client ("Revived", "Refunded", "Needs attention"); `serverTime` lets the client correct its clock so the 5 s fade and countdowns run on server time. `serverTime` is added after hashing, so `stateVersion`, the ETag and 304s are unaffected. The repository function is optional in the route so older wiring (and `test/routes/state-wiring.test.js`) keeps working with an empty list.

**Files:**
- Modify: `server/src/routes/state.js`
- Test: `server/test/routes/state.test.js`

**Interfaces:**
- Consumes: `transactionRepository.listRecentlyClosedTransactionIdsForUser(userId, { now })` (Task 2), `transactionRepository.getTransactionForUser({ transactionId, userId })` (existing).
- Produces: 200 body gains `recentlyClosed` (array, same shape as `activeTransactions`) and `serverTime` (ISO string).

- [ ] **Step 1: Extend the test app and add the failing tests**
<!-- op:find server/test/routes/state.test.js -->
Find in `server/test/routes/state.test.js`:
```js
async function makeApp({ user = REQUESTER, activeRequest = null, openTransactionIds = [], transactions = {}, queue = [], online = 3, presence = true, proState = 'NONE', mode = 'review', verificationStatus, verificationRepository = verificationStatus !== undefined } = {}) {
```
<!-- op:replace -->
Replace with:
```js
async function makeApp({ user = REQUESTER, activeRequest = null, openTransactionIds = [], closedTransactionIds = [], closedRepository = true, transactions = {}, queue = [], online = 3, presence = true, proState = 'NONE', mode = 'review', verificationStatus, verificationRepository = verificationStatus !== undefined, clock = () => NOW } = {}) {
```
<!-- op:find server/test/routes/state.test.js -->
Find in `server/test/routes/state.test.js`:
```js
  const calls = { online: [], count: 0 };
```
<!-- op:replace -->
Replace with:
```js
  const calls = { online: [], count: 0, closedAt: [] };
```
<!-- op:find server/test/routes/state.test.js -->
Find in `server/test/routes/state.test.js`:
```js
      async listOpenTransactionIdsForUser(userId) { assert.equal(userId, user.userId); return openTransactionIds; },
```
<!-- op:replace -->
Replace with:
```js
      async listOpenTransactionIdsForUser(userId) { assert.equal(userId, user.userId); return openTransactionIds; },
      ...(closedRepository ? {
        async listRecentlyClosedTransactionIdsForUser(userId, { now }) {
          assert.equal(userId, user.userId);
          assert.ok(now instanceof Date);
          calls.closedAt.push(now);
          return closedTransactionIds;
        }
      } : {}),
```
<!-- op:find server/test/routes/state.test.js -->
Find in `server/test/routes/state.test.js`:
```js
    config: { SUBSCRIPTION_MODE: mode, PRO_RECEIVER_TORN_ID: 3877028 },
    clock: () => NOW
  });
```
<!-- op:replace -->
Replace with:
```js
    config: { SUBSCRIPTION_MODE: mode, PRO_RECEIVER_TORN_ID: 3877028 },
    clock
  });
```
Append to `server/test/routes/state.test.js`:
<!-- op:append server/test/routes/state.test.js -->
```js

test('recently closed transactions are returned newest first and do not make the user active', async t => {
  const revived = { id: 'tx-new', state: 'COMPLETED', participantRole: 'requester', closedAt: '2026-11-25T11:59:55.000Z' };
  const reportable = { id: 'tx-old', state: 'REPORTABLE_NO_ATTEMPT', participantRole: 'requester', closedAt: '2026-11-25T11:20:00.000Z' };
  const { app, calls } = await makeApp({ closedTransactionIds: ['tx-new', 'tx-gone', 'tx-old'], transactions: { 'tx-new': revived, 'tx-old': reportable } });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.deepEqual(body.recentlyClosed, [revived, reportable]);
  assert.deepEqual(body.activeTransactions, []);
  assert.equal(body.nextPollMs, STATE_POLL_MS.IDLE);
  assert.deepEqual(calls.closedAt, [NOW]);
});

test('recentlyClosed is an empty array when nothing closed recently or the repository predates it', async t => {
  const empty = await makeApp();
  const legacy = await makeApp({ closedRepository: false });
  t.after(() => Promise.all([empty.app.close(), legacy.app.close()]));
  assert.deepEqual((await empty.app.inject({ method: 'GET', url: '/v1/state' })).json().recentlyClosed, []);
  assert.deepEqual((await legacy.app.inject({ method: 'GET', url: '/v1/state' })).json().recentlyClosed, []);
});

test('a transaction closing changes the state version', async t => {
  const tx = { id: 'tx-1', state: 'WAITING_FOR_REVIVE', participantRole: 'requester', closedAt: null };
  const open = await makeApp({ openTransactionIds: ['tx-1'], transactions: { 'tx-1': tx } });
  const closed = await makeApp({ closedTransactionIds: ['tx-1'], transactions: { 'tx-1': { ...tx, state: 'COMPLETED', closedAt: '2026-11-25T11:59:58.000Z' } } });
  t.after(() => Promise.all([open.app.close(), closed.app.close()]));
  const va = (await open.app.inject({ method: 'GET', url: '/v1/state' })).json().stateVersion;
  const vb = (await closed.app.inject({ method: 'GET', url: '/v1/state' })).json().stateVersion;
  assert.notEqual(va, vb);
});

test('serverTime reports the server clock and is not part of the state version', async t => {
  let current = NOW;
  const { app } = await makeApp({ clock: () => current });
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/v1/state' });
  assert.equal(first.json().serverTime, NOW.toISOString());
  current = new Date(NOW.getTime() + 7000);
  const second = await app.inject({ method: 'GET', url: '/v1/state' });
  assert.equal(second.json().serverTime, current.toISOString());
  assert.equal(second.json().stateVersion, first.json().stateVersion);
  const third = await app.inject({ method: 'GET', url: '/v1/state', headers: { 'if-none-match': first.headers.etag } });
  assert.equal(third.statusCode, 304);
});

```
- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && node --test test/routes/state.test.js`
Expected: `# pass 22`, `# fail 3` (`recentlyClosed` and `serverTime` are `undefined`).

- [ ] **Step 3: Implement**
<!-- op:find server/src/routes/state.js -->
Find in `server/src/routes/state.js`:
```js
    const [activeRequest, openTransactionIds, status, online, verificationStatus] = await Promise.all([
      requestRepository.getActiveRequest(user.userId),
      transactionRepository.listOpenTransactionIdsForUser(user.userId),
```
<!-- op:replace -->
Replace with:
```js
    const [activeRequest, openTransactionIds, closedTransactionIds, status, online, verificationStatus] = await Promise.all([
      requestRepository.getActiveRequest(user.userId),
      transactionRepository.listOpenTransactionIdsForUser(user.userId),
      typeof transactionRepository.listRecentlyClosedTransactionIdsForUser === 'function'
        ? transactionRepository.listRecentlyClosedTransactionIdsForUser(user.userId, { now })
        : [],
```
<!-- op:find server/src/routes/state.js -->
Find in `server/src/routes/state.js`:
```js
    const activeTransactions = openTransactions.filter(Boolean).sort(compareByNearestDeadline);

```
<!-- op:replace -->
Replace with:
```js
    const activeTransactions = openTransactions.filter(Boolean).sort(compareByNearestDeadline);
    // Newest closure first, as the repository returns them.
    const recentlyClosed = (await Promise.all((closedTransactionIds || []).map(transactionId =>
      transactionRepository.getTransactionForUser({ transactionId, userId: user.userId })
    ))).filter(Boolean);

```
<!-- op:find server/src/routes/state.js -->
Find in `server/src/routes/state.js`:
```js
      activeTransactions,
      revivers:
```
<!-- op:replace -->
Replace with:
```js
      activeTransactions,
      recentlyClosed,
      revivers:
```
<!-- op:find server/src/routes/state.js -->
Find in `server/src/routes/state.js`:
```js
    return reply.code(200).send({ stateVersion, nextPollMs, ...serialized });
```
<!-- op:replace -->
Replace with:
```js
    // serverTime lets the client correct its clock for countdowns and the 5 s "Revived" fade.
    // It is deliberately outside stateVersion, so an unchanged state still answers 304.
    return reply.code(200).send({ stateVersion, nextPollMs, serverTime: now.toISOString(), ...serialized });
```
- [ ] **Step 4: Run the route tests and the full server suite**

Run: `cd server && node --test test/routes/state.test.js test/routes/state-wiring.test.js`
Expected: `# pass 28`, `# fail 0`.

Run: `cd server && npm test`
Expected: `# fail 0` (407 tests).

- [ ] **Step 5: Commit**
```bash
git add server/src/routes/state.js server/test/routes/state.test.js
git commit -m "feat(server): add recentlyClosed and serverTime to /v1/state" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 4: Pill state from real outcomes, server clock and session states

Priority stays: open requester transaction → open `activeRequest` → open reviver transaction → **recently closed (requester, then reviver; newest first; only states that still map)** → idle. `COMPLETED` keeps its 5 s fade (`closedAt`), now on server time via `snapshot.clockSkewMs` (bounded to ±24 h). `signed-out` and `expired` are session states passed as `freshness`: they ignore the snapshot entirely and are never "Offline". `FRESHNESS` itself is unchanged, so the existing state × role × freshness table test still enumerates only data freshness.

**Files:**
- Modify: `src/lite/pill-state.js`
- Test: `test/lite-pill-state.test.js`

**Interfaces:**
- Produces: `SESSION_STATES = ['signed-out', 'expired']`; `derivePill(snapshot, 'signed-out'|'expired', now)` → frozen view `{ role: 'none', label: 'Set up revives'|'Sign in again', tone: 'attention', icon: 'shield', sheet: 'requester-setup'|'session-expired', syncing: false, offline: false, timer: null, refreshAt: null, text }`. Reads `snapshot.recentlyClosed` and `snapshot.clockSkewMs`.

- [ ] **Step 1: Write the failing tests**

Append to `test/lite-pill-state.test.js`:
<!-- op:append test/lite-pill-state.test.js -->
```js

test('a recently closed COMPLETED transaction shows "Revived" for 5 s after closing, then idle', () => {
  const closed = transaction('COMPLETED', 'requester', { closedAt: iso(-2000) });
  const view = derivePill(snapshot({ recentlyClosed: [closed] }), 'live', NOW);
  assert.equal(view.text, 'Revived');
  assert.equal(view.tone, 'success');
  assert.equal(view.transactionId, 'tx-requester-COMPLETED');
  assert.equal(view.refreshAt, NOW + 3000);
  assert.equal(derivePill(snapshot({ recentlyClosed: [closed] }), 'live', NOW + 3000).text, 'Revive me · 3 online');
});

test('recently closed REFUNDED and REPORTABLE_* show "Refunded" and "Needs attention" from real data', () => {
  const refunded = transaction('REFUNDED', 'requester', { closedAt: iso(-20000) });
  const reportable = transaction('REPORTABLE_MISSING_REFUND', 'requester', { closedAt: iso(-600000) });
  assert.equal(derivePill(snapshot({ recentlyClosed: [refunded] }), 'live', NOW).text, 'Refunded');
  const attention = derivePill(snapshot({ recentlyClosed: [reportable] }), 'live', NOW);
  assert.equal(attention.text, 'Needs attention');
  assert.equal(attention.tone, 'attention');
  assert.equal(derivePill(snapshot({ recentlyClosed: [reportable] }), 'syncing', NOW).tone, 'neutral');
});

test('recently closed outcomes never hide an open request or transaction, and the newest one wins', () => {
  const revived = transaction('COMPLETED', 'requester', { id: 'tx-new', closedAt: iso(-1000) });
  const attention = transaction('REPORTABLE_NO_ATTEMPT', 'requester', { id: 'tx-old', closedAt: iso(-900000) });
  const request = { id: 'req-2', state: 'AVAILABLE', paymentMethod: 'cash', offerAmount: 1, createdAt: iso(-5000), transactionId: null };
  assert.equal(derivePill(snapshot({ activeRequest: request, recentlyClosed: [revived] }), 'live', NOW).label, 'Waiting');
  const reviving = transaction('WAITING_FOR_REVIVE', 'reviver', deadlinesFor('WAITING_FOR_REVIVE'));
  assert.equal(derivePill(snapshot({ activeTransactions: [reviving], recentlyClosed: [revived] }), 'live', NOW).label, 'Revive Patient now');
  assert.equal(derivePill(snapshot({ recentlyClosed: [revived, attention] }), 'live', NOW).transactionId, 'tx-new');
  assert.equal(derivePill(snapshot({ recentlyClosed: [revived, attention] }), 'live', NOW + 6000).transactionId, 'tx-old');
});

test('recently closed states that do not map (cancelled, expired, unknown) leave the pill idle', () => {
  const closed = [
    transaction('PAYMENT_EXPIRED', 'requester', { closedAt: iso(-1000) }),
    transaction('CLOSED_NATURAL_EXPIRY', 'reviver', { closedAt: iso(-1000) }),
    transaction('SOMETHING_NEW', 'requester', { closedAt: iso(-1000) })
  ];
  assert.equal(derivePill(snapshot({ recentlyClosed: closed }), 'live', NOW).text, 'Revive me · 3 online');
});

test('the snapshot clock skew corrects the fade and countdowns', () => {
  const closed = transaction('COMPLETED', 'requester', { closedAt: iso(-2000) });
  // The client clock is 10 s ahead of the server: without the skew "Revived" would never show.
  const ahead = NOW + 10000;
  assert.equal(derivePill(snapshot({ recentlyClosed: [closed] }), 'live', ahead).text, 'Revive me · 3 online');
  assert.equal(derivePill(snapshot({ recentlyClosed: [closed], clockSkewMs: -10000 }), 'live', ahead).text, 'Revived');
  const paying = transaction('WAITING_FOR_PAYMENT', 'requester');
  assert.equal(derivePill(snapshot({ activeTransactions: [paying], clockSkewMs: -10000 }), 'live', ahead).detail, '1:30 left');
  assert.equal(derivePill(snapshot({ activeTransactions: [paying], clockSkewMs: 'x' }), 'live', NOW).detail, '1:30 left');
  assert.equal(derivePill(snapshot({ activeTransactions: [paying], clockSkewMs: 48 * 3600 * 1000 }), 'live', NOW).detail, '1:30 left');
});

test('signed-out and expired sessions ignore the snapshot and are never "Offline"', () => {
  const busy = snapshot({ activeTransactions: [transaction('WAITING_FOR_PAYMENT', 'requester')] });
  const signedOut = derivePill(busy, 'signed-out', NOW);
  assert.equal(signedOut.text, 'Set up revives');
  assert.equal(signedOut.sheet, 'requester-setup');
  assert.equal(signedOut.offline, false);
  assert.equal(signedOut.syncing, false);
  const expired = derivePill(busy, 'expired', NOW);
  assert.equal(expired.text, 'Sign in again');
  assert.equal(expired.tone, 'attention');
  assert.equal(expired.sheet, 'session-expired');
  assert.equal(expired.transactionId, null);
  assert.equal(Object.isFrozen(expired), true);
});

```
- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/lite-pill-state.test.js`
Expected: `# pass 119`, `# fail 5` (e.g. `'Revive me · 3 online' !== 'Revived'`, `'ReviveRelay' !== 'Set up revives'`; the "states that do not map" test already passes because they fall through to idle).

- [ ] **Step 3: Implement**
<!-- op:find src/lite/pill-state.js -->
Find in `src/lite/pill-state.js`:
```js
  const FRESHNESS = Object.freeze(['live', 'syncing', 'offline']);
```
<!-- op:replace -->
Replace with:
```js
  const FRESHNESS = Object.freeze(['live', 'syncing', 'offline']);
  // Session states replace the snapshot entirely: nothing cached is ever painted under them.
  const SESSION_STATES = Object.freeze(['signed-out', 'expired']);
  const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
```
<!-- op:find src/lite/pill-state.js -->
Find in `src/lite/pill-state.js`:
```js
      if (mapped) return { mapped, transaction };
    }
    return null;
  }

  function hasRole(me, role) {
```
<!-- op:replace -->
Replace with:
```js
      if (mapped) return { mapped, transaction };
    }
    return null;
  }

  // Recently closed transactions arrive newest first. Only outcomes that still map (Revived
  // within its fade, Refunded, Needs attention) drive the pill; unknown states are skipped.
  function firstClosed(transactions, role, now) {
    const mapper = role === 'requester' ? requesterMapping : reviverMapping;
    for (const transaction of transactions) {
      if (!transaction || transaction.participantRole !== role || !TRANSACTION_STATES.includes(transaction.state)) continue;
      const mapped = mapper(transaction.state, transaction, now);
      if (mapped) return { mapped, transaction };
    }
    return null;
  }

  function hasRole(me, role) {
```
<!-- op:find src/lite/pill-state.js -->
Find in `src/lite/pill-state.js`:
```js
    const reviver = firstMapped(transactions, 'reviver', now);
    if (reviver) return fromMapped('reviver', reviver.mapped, reviver.transaction.state, reviver.transaction.id, now);

    const idle
```
<!-- op:replace -->
Replace with:
```js
    const reviver = firstMapped(transactions, 'reviver', now);
    if (reviver) return fromMapped('reviver', reviver.mapped, reviver.transaction.state, reviver.transaction.id, now);

    const closed = Array.isArray(snapshot.recentlyClosed) ? snapshot.recentlyClosed : [];
    const outcome = firstClosed(closed, 'requester', now) || firstClosed(closed, 'reviver', now);
    if (outcome) return fromMapped(outcome.transaction.participantRole, outcome.mapped, outcome.transaction.state, outcome.transaction.id, now);

    const idle
```
<!-- op:find src/lite/pill-state.js -->
Find in `src/lite/pill-state.js`:
```js
  function derivePill(snapshot, freshness, now) {
    const mode = FRESHNESS.includes(freshness) ? freshness : 'syncing';
    const at = Number.isFinite(Number(now)) ? Number(now) : 0;
    const view = baseView(snapshot, at);
```
<!-- op:replace -->
Replace with:
```js
  // The engine stores the measured server-minus-client offset on the snapshot it received.
  function serverNow(snapshot, now) {
    const skew = snapshot && typeof snapshot === 'object' ? Number(snapshot.clockSkewMs) : NaN;
    return Number.isFinite(skew) && Math.abs(skew) <= MAX_CLOCK_SKEW_MS ? now + skew : now;
  }

  function sessionView(state) {
    const expired = state === 'expired';
    return Object.freeze({
      role: 'none',
      state: null,
      transactionId: null,
      label: expired ? 'Sign in again' : 'Set up revives',
      detail: '',
      tone: 'attention',
      icon: 'shield',
      sheet: expired ? 'session-expired' : 'requester-setup',
      timer: null,
      refreshAt: null,
      syncing: false,
      offline: false,
      text: expired ? 'Sign in again' : 'Set up revives'
    });
  }

  function derivePill(snapshot, freshness, now) {
    if (SESSION_STATES.includes(freshness)) return sessionView(freshness);
    const mode = FRESHNESS.includes(freshness) ? freshness : 'syncing';
    const at = serverNow(snapshot, Number.isFinite(Number(now)) ? Number(now) : 0);
    const view = baseView(snapshot, at);
```
<!-- op:find src/lite/pill-state.js -->
Find in `src/lite/pill-state.js`:
```js
    TONES,
    FRESHNESS,
    TRANSACTION_STATES,
```
<!-- op:replace -->
Replace with:
```js
    TONES,
    FRESHNESS,
    SESSION_STATES,
    TRANSACTION_STATES,
```
- [ ] **Step 4: Run the tests**

Run: `node --test test/lite-pill-state.test.js`
Expected: `# pass 124`, `# fail 0`.

- [ ] **Step 5: Commit**
```bash
git add src/lite/pill-state.js test/lite-pill-state.test.js
git commit -m "feat(lite): drive outcomes from recentlyClosed on server time and add session pill states" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 5: Engine session awareness, auth expiry, clock skew and lifecycle hooks

**Files:**
- Modify: `src/lite/engine.js`
- Test: `test/lite-engine-session.test.js` (new; `test/lite-engine.test.js` stays unchanged and must stay green: `getSession` omitted means "signed in, identity unknown")

**Interfaces:**
- Consumes: `PillState.SESSION_STATES`/`derivePill` (Task 4); `api.getState()`/`api.reset()` (Plan 2 `createStateClient`); `DirectApiClientError` `code`/`status`.
- Produces: `createLiteEngine` options `getSession: () => ({ signedIn, tornId })`, `onRender: ({ view, snapshot, freshness }) => void`; new methods `relayout()` (re-place pill + re-read theme) and `resetSession()` (stop, clear cache, `api.reset()`, restart if it was started). Behaviour:
  - signed out → no poll, no cached paint, "Set up revives";
  - 401/`AUTH_REQUIRED` → "Sign in again", cache cleared, `api.reset()`, no back-off timer, no further polls until `resetSession()` or a new `start()`;
  - boot cache or follower broadcast whose `me.tornId` ≠ `getSession().tornId` → discarded (cache cleared) / ignored;
  - 200 with `serverTime` → `snapshot.clockSkewMs = serverTime − midpoint(request, response)` (stored in the cache with the snapshot, so followers and later page loads use it);
  - `onRender` runs after every render; listener errors are swallowed.

- [ ] **Step 1: Write the failing tests**
<!-- op:file test/lite-engine-session.test.js -->
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiteEngine } = require('../src/lite/engine');
const { HOST_ID } = require('../src/lite/pill-view');
const { SNAPSHOT_KEY } = require('../src/lite/snapshot-cache');
const { DirectApiClientError } = require('../src/direct-api-client');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createFakeDocument, createFakeWindow } = require('./helpers/fake-dom');
const { createChannelHub, createLockManager, createAbortController } = require('./helpers/fake-tabs');

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    get: (key, fallback) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback),
    set: (key, value) => { values[key] = value; }
  };
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
    reset() { api.resets += 1; },
    async getState() {
      api.calls += 1;
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next() : next;
    }
  };
  return api;
}

function makeEngine({ clock, api, session = { signedIn: true, tornId: 1001 }, storage = memoryStorage(), window = createFakeWindow(), document = createFakeDocument(), tabId = 'tab', headerSelectors = ['#rr-none'], onRender = null }) {
  const holder = { session };
  const engine = createLiteEngine({ api, window, document, storage, clock, tabId, headerSelectors, getSession: () => holder.session, onRender });
  return { engine, document, window, storage, holder };
}

const pillText = engine => engine.viewModel() && engine.viewModel().text;
const authError = () => new DirectApiClientError('AUTH_REQUIRED', { status: 401, retryable: false });

test('signed out: never polls, never paints the cache, shows "Set up revives" and holds no timer', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage({ [SNAPSHOT_KEY]: { stateVersion: '0123456789abcdef', fetchedAt: clock.now() - 1000, data: snapshot({ revivers: { online: 9 } }) } });
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api, storage, session: { signedIn: false, tornId: null } });
  engine.start();
  await clock.advance(120000);
  assert.equal(api.calls, 0);
  assert.equal(pillText(engine), 'Set up revives');
  assert.equal(engine.viewModel().offline, false);
  assert.equal(clock.pending(), 0);
  engine.stop();
});

test('AUTH_REQUIRED shows "Sign in again" (not Offline), clears the cache and stops polling without back-off', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }, authError()]);
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  assert.ok(storage.values[SNAPSHOT_KEY]);
  await clock.advance(60000);
  assert.equal(api.calls, 2);
  assert.equal(pillText(engine), 'Sign in again');
  assert.equal(engine.viewModel().offline, false);
  assert.equal(storage.values[SNAPSHOT_KEY], null);
  assert.equal(api.resets, 1);
  assert.equal(clock.pending(), 0);
  await clock.advance(600000);
  assert.equal(api.calls, 2);
  engine.stop();
});

test('resetSession after re-authentication polls again at once with a clean client', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([authError(), { notModified: false, snapshot: snapshot({ revivers: { online: 5 } }) }]);
  const { engine } = makeEngine({ clock, api });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Sign in again');
  engine.resetSession();
  await clock.advance(0);
  assert.equal(api.calls, 2);
  assert.equal(api.resets, 2);
  assert.equal(pillText(engine), 'Revive me · 5 online');
  engine.stop();
});

test('resetSession on sign-out forgets the cached snapshot and goes quiet', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine, holder } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  holder.session = { signedIn: false, tornId: null };
  engine.resetSession();
  assert.equal(storage.values[SNAPSHOT_KEY], null);
  assert.equal(pillText(engine), 'Set up revives');
  await clock.advance(120000);
  assert.equal(api.calls, 1);
  engine.stop();
});

test('a cached snapshot of another Torn user is discarded at boot and never painted', async () => {
  const clock = createFakeTimers();
  const other = snapshot({ me: { tornId: 2002, name: 'Someone', roles: ['requester'], verification: null } });
  const storage = memoryStorage({ [SNAPSHOT_KEY]: { stateVersion: '0123456789abcdef', fetchedAt: clock.now() - 1000, data: other } });
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  assert.equal(pillText(engine), 'ReviveRelay');
  assert.equal(storage.values[SNAPSHOT_KEY], null);
  await clock.advance(0);
  assert.equal(api.calls, 1);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  engine.stop();
});

test('a follower ignores broadcasts carrying another Torn user\'s snapshot', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  function BroadcastChannel(name) { return hub.createChannel(name); }
  const tab = (tabId, api, session) => {
    const window = createFakeWindow({ BroadcastChannel, locks });
    window.AbortController = function AbortController() { return createAbortController(); };
    return makeEngine({ clock, api, window, tabId, session });
  };
  const leaderApi = fakeApi([{ notModified: false, snapshot: snapshot({ me: { tornId: 2002, name: 'Old', roles: ['requester'], verification: null } }) }]);
  const followerApi = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const a = tab('a', leaderApi, { signedIn: true, tornId: 2002 });
  const b = tab('b', followerApi, { signedIn: true, tornId: 1001 });
  a.engine.start();
  b.engine.start();
  await clock.advance(0);
  assert.equal(a.engine.isLeader(), true);
  assert.equal(pillText(b.engine), 'ReviveRelay');
  assert.equal(b.engine.viewModel().syncing, true);
  a.engine.stop();
  b.engine.stop();
});

test('serverTime sets the snapshot clock skew so "Revived" fades on server time', async () => {
  const clock = createFakeTimers();
  const serverNow = clock.now() - 10000;
  const closedAt = new Date(serverNow - 1000).toISOString();
  const revived = { id: 'tx-1', state: 'COMPLETED', participantRole: 'requester', closedAt, updatedAt: closedAt };
  const api = fakeApi([{ notModified: false, snapshot: snapshot({ serverTime: new Date(serverNow).toISOString(), recentlyClosed: [revived] }) }]);
  const storage = memoryStorage();
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  assert.equal(storage.values[SNAPSHOT_KEY].data.clockSkewMs, -10000);
  assert.equal(pillText(engine), 'Revived');
  await clock.advance(4000);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  engine.stop();
});

test('onRender reports every render, and listener errors never break the engine', async () => {
  const clock = createFakeTimers();
  const seen = [];
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({
    clock,
    api,
    onRender: event => {
      seen.push([event.view.text, event.freshness, event.snapshot ? event.snapshot.stateVersion : null]);
      throw new Error('listener bug');
    }
  });
  engine.start();
  await clock.advance(0);
  assert.deepEqual(seen, [['ReviveRelay', 'syncing', null], ['Revive me · 2 online', 'live', '0123456789abcdef']]);
  engine.stop();
});

test('relayout moves the pill into Torn\'s header once it renders and re-reads the theme', async () => {
  const clock = createFakeTimers();
  const document = createFakeDocument();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api, document, headerSelectors: ['#rr-test-header'] });
  engine.start();
  const host = document.getElementById(HOST_ID);
  assert.equal(host.getAttribute('data-rr-placement'), 'launcher');
  const slot = document.createElement('div');
  slot.setAttribute('id', 'rr-test-header');
  slot.rect.width = 300;
  document.body.appendChild(slot);
  document.body.classList.add('dark-mode');
  engine.relayout();
  assert.equal(host.parentNode, slot);
  assert.equal(host.getAttribute('data-rr-placement'), 'header');
  assert.equal(host.getAttribute('data-theme'), 'dark');
  engine.stop();
  engine.relayout();
});

```
- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/lite-engine-session.test.js`
Expected: `# fail` ≥ 6 (`'Revive me · 2 online' !== 'Set up revives'`, `engine.resetSession is not a function`, `engine.relayout is not a function`, …).

- [ ] **Step 3: Implement**
<!-- op:find src/lite/engine.js -->
Find in `src/lite/engine.js`:
```js
    tabId,
    headerSelectors,
    onActivate = () => {}
  } = {}) {
```
<!-- op:replace -->
Replace with:
```js
    tabId,
    headerSelectors,
    onActivate = () => {},
    // () => ({ signedIn, tornId }). Omitted: always signed in, identity unknown.
    getSession = null,
    // Called after every render with { view, snapshot, freshness } (e.g. to refresh an open panel).
    onRender = null
  } = {}) {
```
<!-- op:find src/lite/engine.js -->
Find in `src/lite/engine.js`:
```js
    // Set at boot when the cached snapshot is younger than the cadence: the first poll waits for it.
    let deferredPollAt = null;

```
<!-- op:replace -->
Replace with:
```js
    // Set at boot when the cached snapshot is younger than the cadence: the first poll waits for it.
    let deferredPollAt = null;
    // Set when the server rejected the session: no polling until resetSession() or a restart.
    let authExpired = false;

    function session() {
      if (typeof getSession !== 'function') return { signedIn: true, tornId: null };
      let value = null;
      try { value = getSession(); } catch (_) { value = null; }
      const tornId = value && Number.isSafeInteger(Number(value.tornId)) && Number(value.tornId) > 0 ? Number(value.tornId) : null;
      return { signedIn: Boolean(value && value.signedIn), tornId };
    }

    // 'signed-out' or 'expired' while the session cannot poll; otherwise null.
    function sessionGate() {
      if (!session().signedIn) return 'signed-out';
      return authExpired ? 'expired' : null;
    }

    // A snapshot belongs to the signed-in Torn user, or to nobody known yet.
    function ownedBySession(snapshot) {
      const expected = session().tornId;
      if (expected === null || !snapshot || typeof snapshot !== 'object') return true;
      const owner = snapshot.me && Number(snapshot.me.tornId);
      return owner === expected;
    }

    function isAuthError(error) {
      return Boolean(error && (error.code === 'AUTH_REQUIRED' || Number(error.status) === 401));
    }

```
<!-- op:find src/lite/engine.js -->
Find in `src/lite/engine.js`:
```js
    function render() {
      if (!view) return;
      lastView = PillState.derivePill(current.snapshot, current.freshness, now());
      view.update(lastView);
    }
```
<!-- op:replace -->
Replace with:
```js
    function render() {
      if (!view) return;
      lastView = PillState.derivePill(current.snapshot, current.freshness, now());
      view.update(lastView);
      if (typeof onRender === 'function') {
        try { onRender({ view: lastView, snapshot: current.snapshot, freshness: current.freshness }); } catch (_) { /* listener errors stay with the caller */ }
      }
    }
```
<!-- op:find src/lite/engine.js -->
Find in `src/lite/engine.js`:
```js
    function pollDelay() {
      if (!isLeader()) return null;
```
<!-- op:replace -->
Replace with:
```js
    function pollDelay() {
      if (!isLeader() || sessionGate()) return null;
```
<!-- op:find src/lite/engine.js -->
Find in `src/lite/engine.js`:
```js
    async function poll() {
      if (!isLeader()) return;
```
<!-- op:replace -->
Replace with:
```js
    async function poll() {
      if (!isLeader() || sessionGate()) return;
```
<!-- op:find src/lite/engine.js -->
Find in `src/lite/engine.js`:
```js
      try {
        result = await api.getState();
      } catch (error) {
        // A stale session or a tab that lost leadership neither renders "Offline" nor backs off.
        if (!stillCurrent(runEpoch)) return;
        apply(current.snapshot, 'offline', null);
        throw error;
      }
```
<!-- op:replace -->
Replace with:
```js
      try {
        result = await api.getState();
      } catch (error) {
        // A stale session or a tab that lost leadership neither renders "Offline" nor backs off.
        if (!stillCurrent(runEpoch)) return;
        if (isAuthError(error)) {
          // Expired or revoked session: show it as such, forget this user's cache, stop polling.
          authExpired = true;
          cache.clear();
          if (typeof api.reset === 'function') api.reset();
          apply(null, 'expired', null);
          return;
        }
        apply(current.snapshot, 'offline', null);
        throw error;
      }
```
<!-- op:find src/lite/engine.js -->
Find in `src/lite/engine.js`:
```js
      const snapshot = result && result.snapshot;
      if (!snapshot) return;
      apply(snapshot, 'live', requestedAt);
```
<!-- op:replace -->
Replace with:
```js
      const snapshot = result && result.snapshot;
      if (!snapshot) return;
      const serverMs = Date.parse(snapshot.serverTime);
      if (Number.isFinite(serverMs)) snapshot.clockSkewMs = serverMs - Math.round((requestedAt + now()) / 2);
      apply(snapshot, 'live', requestedAt);
```
<!-- op:find src/lite/engine.js -->
Find in `src/lite/engine.js`:
```js
      if (!started || isLeader() || !payload || typeof payload !== 'object') return;
      // Another tab is leading, so a later hand-off to this tab must poll promptly.
      deferredPollAt = null;
      const freshness = PillState.FRESHNESS.includes(payload.freshness) ? payload.freshness : 'syncing';
      current = { snapshot: payload.snapshot || current.snapshot, freshness };
```
<!-- op:replace -->
Replace with:
```js
      if (!started || isLeader() || !payload || typeof payload !== 'object') return;
      // Never paint another Torn user's state (a tab still holding an older session).
      if (sessionGate() === 'signed-out' || !ownedBySession(payload.snapshot)) return;
      // Another tab is leading, so a later hand-off to this tab must poll promptly.
      deferredPollAt = null;
      if (payload.freshness === 'expired') {
        current = { snapshot: null, freshness: 'expired' };
        render();
        rescheduleLocal();
        return;
      }
      const freshness = PillState.FRESHNESS.includes(payload.freshness) ? payload.freshness : 'syncing';
      current = { snapshot: payload.snapshot || current.snapshot, freshness };
```
<!-- op:find src/lite/engine.js -->
Find in `src/lite/engine.js`:
```js
      lastFetchedAt = null;
      resyncSoon = false;
      const cached = cache.read();
      current = { snapshot: cached ? cached.snapshot : null, freshness: 'syncing' };
```
<!-- op:replace -->
Replace with:
```js
      lastFetchedAt = null;
      resyncSoon = false;
      authExpired = false;
      const gate = sessionGate();
      let cached = gate ? null : cache.read();
      if (cached && !ownedBySession(cached.snapshot)) {
        cache.clear();
        cached = null;
      }
      current = gate ? { snapshot: null, freshness: gate } : { snapshot: cached ? cached.snapshot : null, freshness: 'syncing' };
```
<!-- op:find src/lite/engine.js -->
Find in `src/lite/engine.js`:
```js
    function refresh() {
      if (scheduler && isLeader()) scheduler.trigger('poll');
    }

    return Object.freeze({
      start,
      stop,
      setSheetOpen,
      refresh,
```
<!-- op:replace -->
Replace with:
```js
    function refresh() {
      if (scheduler && isLeader()) scheduler.trigger('poll');
    }

    // Torn re-renders its header on SPA navigation: re-attach the pill and re-read the theme.
    function relayout() {
      if (!view) return;
      view.place();
      view.refreshTheme();
    }

    // Sign-in, sign-out or a different Torn user: forget everything tied to the old session.
    function resetSession() {
      const wasStarted = started;
      stop();
      authExpired = false;
      current = { snapshot: null, freshness: 'syncing' };
      lastFetchedAt = null;
      cache.clear();
      if (typeof api.reset === 'function') api.reset();
      if (wasStarted) start();
    }

    return Object.freeze({
      start,
      stop,
      setSheetOpen,
      refresh,
      relayout,
      resetSession,
```
- [ ] **Step 4: Run the engine tests**

Run: `node --test test/lite-engine-session.test.js test/lite-engine.test.js test/lite-bundle.test.js`
Expected: `# pass 43`, `# fail 0` (9 + 30 + 4).

- [ ] **Step 5: Commit**
```bash
git add src/lite/engine.js test/lite-engine-session.test.js
git commit -m "feat(lite): session gate, auth expiry, identity guard and clock skew in the engine" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 6: `src/lite/boot.js`: the engine on the real platform and page lifecycle

`boot.js` is what MAIN calls. It builds the `/v1/state` client on `platform.request`, hands the engine `platform.storage` (GM or PDA storage; `storage.set` already swallows errors), `platform.runtime.isTornPda`, a tab id fixed for the page load, and the page lifecycle: `pagehide` stops the engine (releases the Web Lock, closes channels, clears timers); a BFCache `pageshow` (`persisted: true`) restarts it; `popstate`, `hashchange` and TornPDA's `flutterInAppWebViewPlatformReady` re-place the pill and re-read the theme after Torn re-renders its header (one-shot timeouts at 150 ms, 1 s and 3 s; no interval, cleared on stop).

**Files:**
- Create: `src/lite/boot.js`
- Test: `test/lite-boot.test.js`

**Interfaces:**
- Consumes: `ReviveRelayLiteStateClient.createStateClient`, `ReviveRelayLiteEngine.createLiteEngine` (Task 5).
- Produces: global `ReviveRelayLiteBoot = { RELAYOUT_DELAYS_MS, createLiteBoot }` (see "Interfaces used across tasks").

- [ ] **Step 1: Write the failing test**
<!-- op:file test/lite-boot.test.js -->
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiteBoot, RELAYOUT_DELAYS_MS } = require('../src/lite/boot');
const { HOST_ID } = require('../src/lite/pill-view');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createFakeDocument, createFakeWindow } = require('./helpers/fake-dom');

const BASE_URL = 'https://reviverelay.voidsmithindustries.com/review';

function stateBody(overrides = {}) {
  return {
    stateVersion: '0123456789abcdef',
    nextPollMs: 60000,
    me: { tornId: 1001, name: 'Patient', roles: ['requester'], verification: { usable: true, requester: true, reviver: false } },
    pro: { state: 'NONE' },
    activeRequest: null,
    activeTransactions: [],
    recentlyClosed: [],
    revivers: { online: 4 },
    queue: null,
    ...overrides
  };
}

function fakePlatform({ status = 200, body = stateBody() } = {}) {
  const values = {};
  const requests = [];
  return {
    requests,
    values,
    runtime: { isTornPda: false },
    storage: {
      get: (key, fallback) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback),
      set: (key, value) => { values[key] = value; }
    },
    async request(input) {
      requests.push(input);
      return { status, body };
    }
  };
}

function setup({ platform = fakePlatform(), session = { signedIn: true, tornId: 1001 }, token = 'session-token' } = {}) {
  const clock = createFakeTimers();
  const document = createFakeDocument();
  const window = createFakeWindow();
  const activations = [];
  const renders = [];
  const boot = createLiteBoot({
    platform,
    window,
    document,
    baseUrl: BASE_URL,
    clientVersion: '1.0.0',
    releaseChannel: 'review',
    getToken: () => token,
    getSession: () => session,
    onActivate: () => activations.push(1),
    onRender: event => renders.push(event),
    clock,
    headerSelectors: ['#rr-test-header']
  });
  return { boot, clock, document, window, platform, activations, renders };
}

function addHeader(document) {
  const slot = document.createElement('div');
  slot.setAttribute('id', 'rr-test-header');
  slot.rect.width = 300;
  document.body.appendChild(slot);
  return slot;
}

test('start polls /v1/state through the platform transport with the session token and paints the pill', async () => {
  const { boot, clock, document, platform } = setup();
  boot.start();
  await clock.advance(0);
  assert.equal(platform.requests.length, 1);
  assert.equal(platform.requests[0].method, 'GET');
  assert.equal(platform.requests[0].url, `${BASE_URL}/v1/state`);
  assert.equal(platform.requests[0].headers.Authorization, 'Bearer session-token');
  assert.equal(platform.requests[0].headers['X-ReviveRelay-Version'], '1.0.0');
  assert.equal(boot.engine.viewModel().text, 'Revive me · 4 online');
  assert.ok(document.getElementById(HOST_ID));
  assert.ok(platform.values.reviverelay_state_snapshot_v1);
  boot.stop();
});

test('clicking the pill calls onActivate, and onRender sees each render', async () => {
  const { boot, clock, document, activations, renders } = setup();
  boot.start();
  await clock.advance(0);
  const host = document.getElementById(HOST_ID);
  host.attachedShadow.querySelector('.rr-pill').click();
  assert.equal(activations.length, 1);
  assert.equal(renders[renders.length - 1].view.text, 'Revive me · 4 online');
  boot.stop();
});

test('the pill moves into Torn\'s header when it renders after boot, without any interval', async () => {
  const { boot, clock, document } = setup();
  boot.start();
  const host = document.getElementById(HOST_ID);
  assert.equal(host.getAttribute('data-rr-placement'), 'launcher');
  addHeader(document);
  await clock.advance(RELAYOUT_DELAYS_MS[0]);
  assert.equal(host.getAttribute('data-rr-placement'), 'header');
  await clock.advance(RELAYOUT_DELAYS_MS[RELAYOUT_DELAYS_MS.length - 1]);
  boot.stop();
  assert.equal(clock.pending(), 0);
});

test('SPA navigation (popstate, hashchange) re-places the pill after Torn re-renders its header', async () => {
  const { boot, clock, document, window } = setup();
  const first = addHeader(document);
  boot.start();
  await clock.advance(5000);
  const host = document.getElementById(HOST_ID);
  assert.equal(host.parentNode, first);
  first.remove();
  const second = addHeader(document);
  window.dispatch('popstate');
  await clock.advance(RELAYOUT_DELAYS_MS[0]);
  assert.equal(host.parentNode, second);
  second.remove();
  const third = addHeader(document);
  window.dispatch('hashchange');
  await clock.advance(RELAYOUT_DELAYS_MS[0]);
  assert.equal(host.parentNode, third);
  boot.stop();
});

test('pagehide stops the engine; a BFCache pageshow restarts it with the same tab id', async () => {
  const { boot, clock, document, window, platform } = setup();
  const tabId = boot.tabId;
  boot.start();
  await clock.advance(0);
  window.dispatch('pagehide', { persisted: true });
  assert.equal(boot.engine.isStarted(), false);
  assert.equal(document.getElementById(HOST_ID), null);
  assert.equal(clock.pending(), 0);
  window.dispatch('pageshow', { persisted: false });
  assert.equal(boot.engine.isStarted(), false);
  window.dispatch('pageshow', { persisted: true });
  assert.equal(boot.engine.isStarted(), true);
  assert.ok(document.getElementById(HOST_ID));
  assert.equal(boot.tabId, tabId);
  await clock.advance(60000);
  assert.ok(platform.requests.length >= 2);
  boot.stop();
});

test('each boot gets its own tab id', () => {
  assert.notEqual(setup().boot.tabId, setup().boot.tabId);
});

test('start and stop are idempotent and stop removes every listener and timer', async () => {
  const { boot, clock, window, document } = setup();
  boot.start();
  boot.start();
  assert.equal(window.listenerCount('pagehide'), 1);
  assert.equal(document.listenerCount('visibilitychange'), 1);
  await clock.advance(0);
  boot.stop();
  boot.stop();
  for (const type of ['pagehide', 'pageshow', 'popstate', 'hashchange', 'flutterInAppWebViewPlatformReady', 'resize']) {
    assert.equal(window.listenerCount(type), 0, type);
  }
  assert.equal(document.listenerCount('visibilitychange'), 0);
  assert.equal(clock.pending(), 0);
});

test('setPanelOpen drives the 1 s tick and resetSession re-polls with a clean client', async () => {
  const { boot, clock, platform } = setup();
  boot.start();
  await clock.advance(5000);
  boot.setPanelOpen(true);
  await clock.advance(0);
  assert.equal(clock.nextDelay(), 1000);
  boot.setPanelOpen(false);
  boot.resetSession();
  await clock.advance(0);
  assert.equal(platform.requests.length, 2);
  assert.equal(platform.requests[1].headers['If-None-Match'], undefined);
  boot.stop();
});

test('a signed-out boot makes no request', async () => {
  const { boot, clock, platform } = setup({ session: { signedIn: false, tornId: null }, token: '' });
  boot.start();
  await clock.advance(120000);
  assert.equal(platform.requests.length, 0);
  assert.equal(boot.engine.viewModel().text, 'Set up revives');
  boot.stop();
});

test('a 401 from /v1/state renders "Sign in again" and stops polling', async () => {
  const { boot, clock, platform } = setup({ platform: fakePlatform({ status: 401, body: { error: 'AUTH_REQUIRED' } }) });
  boot.start();
  await clock.advance(0);
  assert.equal(boot.engine.viewModel().text, 'Sign in again');
  await clock.advance(600000);
  assert.equal(platform.requests.length, 1);
  boot.stop();
});

test('constructor validation', () => {
  assert.throws(() => createLiteBoot({}), /platform/);
  assert.throws(() => createLiteBoot({ platform: fakePlatform() }), /window/);
});

```
- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/lite-boot.test.js`
Expected: FAIL with `Cannot find module '../src/lite/boot'`.

- [ ] **Step 3: Implement**
<!-- op:file src/lite/boot.js -->
```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteBoot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // After a start or a Torn SPA navigation the header renders late: re-place the pill a few times.
  const RELAYOUT_DELAYS_MS = Object.freeze([150, 1000, 3000]);

  function dependency(globalName, path) {
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
    if (typeof require === 'function') return require(path);
    throw new Error(`${globalName} unavailable`);
  }

  function createLiteBoot({
    platform,
    window,
    document,
    baseUrl,
    clientVersion = '',
    releaseChannel = '',
    getToken = () => '',
    getSession = null,
    onActivate = () => {},
    onRender = null,
    clock = {},
    headerSelectors
  } = {}) {
    if (!platform || typeof platform.request !== 'function' || !platform.storage) throw new Error('platform with request and storage is required');
    if (!window || typeof window.addEventListener !== 'function') throw new Error('window is required');
    const { createStateClient } = dependency('ReviveRelayLiteStateClient', './state-client');
    const { createLiteEngine } = dependency('ReviveRelayLiteEngine', './engine');

    const now = typeof clock.now === 'function' ? clock.now : () => Date.now();
    const random = typeof clock.random === 'function' ? clock.random : Math.random;
    const setTimer = typeof clock.setTimeout === 'function' ? clock.setTimeout : (fn, ms) => globalThis.setTimeout(fn, ms);
    const clearTimer = typeof clock.clearTimeout === 'function' ? clock.clearTimeout : handle => globalThis.clearTimeout(handle);

    // One id per page load, kept across BFCache restarts so leadership logs stay readable.
    const tabId = `rr-${now().toString(36)}-${random().toString(36).slice(2, 10)}`;
    const api = createStateClient({ baseUrl, request: platform.request, getToken, clientVersion, releaseChannel });
    const engine = createLiteEngine({
      platform,
      api,
      window,
      document,
      storage: platform.storage,
      clock,
      tabId,
      headerSelectors,
      onActivate,
      getSession,
      onRender
    });

    let started = false;
    const relayoutTimers = new Set();

    function clearRelayout() {
      for (const handle of relayoutTimers) clearTimer(handle);
      relayoutTimers.clear();
    }

    function scheduleRelayout() {
      clearRelayout();
      for (const delay of RELAYOUT_DELAYS_MS) {
        const handle = setTimer(() => {
          relayoutTimers.delete(handle);
          engine.relayout();
        }, delay);
        relayoutTimers.add(handle);
      }
    }

    function onPageHide() {
      clearRelayout();
      engine.stop();
    }

    function onPageShow(event) {
      // Only a BFCache restore needs a restart; a normal load already started.
      if (!event || event.persisted !== true) return;
      engine.stop();
      engine.start();
      scheduleRelayout();
    }

    const WINDOW_EVENTS = Object.freeze([
      ['pagehide', onPageHide],
      ['pageshow', onPageShow],
      ['popstate', scheduleRelayout],
      ['hashchange', scheduleRelayout],
      ['flutterInAppWebViewPlatformReady', scheduleRelayout]
    ]);

    function start() {
      if (started) return;
      started = true;
      for (const [type, listener] of WINDOW_EVENTS) window.addEventListener(type, listener);
      engine.start();
      scheduleRelayout();
    }

    function stop() {
      if (!started) return;
      started = false;
      for (const [type, listener] of WINDOW_EVENTS) window.removeEventListener(type, listener);
      clearRelayout();
      engine.stop();
    }

    return Object.freeze({
      start,
      stop,
      resetSession: () => engine.resetSession(),
      setPanelOpen: open => engine.setSheetOpen(open),
      refresh: () => engine.refresh(),
      tabId,
      api,
      engine
    });
  }

  return Object.freeze({ RELAYOUT_DELAYS_MS, createLiteBoot });
});

```
- [ ] **Step 4: Run it**

Run: `node --test test/lite-boot.test.js`
Expected: `# pass 11`, `# fail 0`.

- [ ] **Step 5: Commit**
```bash
git add src/lite/boot.js test/lite-boot.test.js
git commit -m "feat(lite): boot module wiring the engine to the platform and page lifecycle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 7: Version 1.0.0 and the Lite modules in the bundle

The Lite modules (plus `boot.js`) join `DIRECT_SUPPORT_MODULES` after `direct-api-client` and `versioning`, in the load order pill-state → scheduler → snapshot-cache → tab-leader → state-client → icons → tokens → pill-view → engine → boot. MAIN is unchanged in this task, so the sidebar action is still bundled.

Any change to bundled bytes breaks the pinned 0.7.3 manifest, so the version moves to 1.0.0 in the same task. Until Task 10 re-pins `docs/review/BUILD-MANIFEST.json`, the manifest names 0.7.3: the build is unpinned (fresh `HEAD`), and `test/review-artifact-verifier.test.js` asserts the real rule for that case (a manifest for another version never verifies) instead of the pinned check.

**Files:**
- Modify: `scripts/client-modules.js` (full replacement below)
- Modify: `package.json` (`0.7.3` → `1.0.0` in `version`, `check` and `verify:review`)
- Modify: `test/direct-only-build.test.js` (full replacement), `test/lite-bundle.test.js`, `test/release-build.test.js`, `test/review-package.test.js`, `test/test-command.test.js`, `test/review-artifact-verifier.test.js`

**Interfaces:**
- Produces: `require('./scripts/client-modules')` → `{ DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES }`; `LITE_ENGINE_MODULES` now ends with `'src/lite/boot.js'`.

- [ ] **Step 1: Update the inventory and version tests first**

Replace the whole of `test/direct-only-build.test.js` with:
<!-- op:file test/direct-only-build.test.js -->
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES } = require('../scripts/client-modules');

const REQUIRED = [
  'src/platform.js',
  'src/core.js',
  'src/direct-api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  'src/sidebar-action.js',
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js',
  'src/lite/boot.js'
];

const FORBIDDEN = [
  'src/api-client.js',
  'src/chat-dom.js',
  'src/public-channels.js',
  'src/client-chat-policy.js',
  'src/revive-classifier.js',
  'src/candidate-pipeline.js'
];

function bundledMarker(relativePath) {
  return `/* ReviveRelay bundled module: ${relativePath} */`;
}

test('canonical direct module inventory is exact and immutable', () => {
  assert.deepEqual([...DIRECT_SUPPORT_MODULES], REQUIRED);
  assert.equal(Object.isFrozen(DIRECT_SUPPORT_MODULES), true);
  assert.deepEqual([...LITE_ENGINE_MODULES], REQUIRED.filter(modulePath => modulePath.startsWith('src/lite/')));
});

test('the Lite state client loads after the direct API client and versioning it depends on', () => {
  const index = modulePath => DIRECT_SUPPORT_MODULES.indexOf(modulePath);
  assert.ok(index('src/direct-api-client.js') < index('src/lite/state-client.js'));
  assert.ok(index('src/versioning.js') < index('src/lite/state-client.js'));
  assert.ok(index('src/lite/engine.js') < index('src/lite/boot.js'));
});

test('main bootstrap consumes the exact core global exported by src/core.js', () => {
  const coreSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'core.js'), 'utf8');
  const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

  assert.match(coreSource, /root\.TornReviveCore\s*=\s*api/);
  assert.match(mainSource, /const Core = globalThis\.TornReviveCore;/);
  assert.doesNotMatch(mainSource, /TornReviveChatCollectorCore/);
});

test('current review bundle contains direct support exactly once and zero legacy chat/candidate modules', () => {
  const version = require('../package.json').version;
  const filename = `review/ReviveRelay-${version}.user.js`;
  const built = fs.readFileSync(path.resolve(__dirname, '..', 'dist', filename), 'utf8');
  for (const modulePath of REQUIRED) {
    assert.equal(built.split(bundledMarker(modulePath)).length - 1, 1, `${filename}: ${modulePath}`);
  }
  for (const modulePath of FORBIDDEN) {
    assert.equal(built.includes(bundledMarker(modulePath)), false, `${filename}: ${modulePath}`);
  }
  assert.doesNotMatch(built, /\/v1\/candidates|Shared public chat requests|Live Capture|Rescan public chats/);
  assert.doesNotMatch(built, /ReviveRelayApiClient|ReviveRelayProClient|createProClient|submitCandidate|drainCandidateOutbox|createOutboxEntry/);
  assert.match(built, /ReviveRelayDirectApiClient/);
  assert.match(built, /ReviveRelayLiteBoot/);
  assert.match(built, /ReviveRelay → Revive Me!/);
  assert.match(built, /const UPDATE_CHANNEL = 'review'/);
});

test('ReviveRelay 1.0 is versioned 1.0.0', () => {
  assert.equal(require('../package.json').version, '1.0.0');
});

```
<!-- op:find test/lite-bundle.test.js -->
Find in `test/lite-bundle.test.js`:
```js
  'src/lite/pill-view.js',
  'src/lite/engine.js'
];
```
<!-- op:replace -->
Replace with:
```js
  'src/lite/pill-view.js',
  'src/lite/engine.js',
  'src/lite/boot.js'
];
```
<!-- op:find test/lite-bundle.test.js -->
Find in `test/lite-bundle.test.js`:
```js
  'src/lite/engine.js': 'ReviveRelayLiteEngine'
};
```
<!-- op:replace -->
Replace with:
```js
  'src/lite/engine.js': 'ReviveRelayLiteEngine',
  'src/lite/boot.js': 'ReviveRelayLiteBoot'
};
```
<!-- op:find test/lite-bundle.test.js -->
Find in `test/lite-bundle.test.js`:
```js
test('lite engine inventory is exact, frozen and kept out of the pinned 0.7.3 bundle', () => {
  assert.deepEqual([...LITE_ENGINE_MODULES], EXPECTED);
  assert.equal(Object.isFrozen(LITE_ENGINE_MODULES), true);
  for (const modulePath of LITE_ENGINE_MODULES) {
    assert.equal(DIRECT_SUPPORT_MODULES.includes(modulePath), false, modulePath);
  }
  const version = require('../package.json').version;
  const built = fs.readFileSync(path.join(root, 'dist', 'review', `ReviveRelay-${version}.user.js`), 'utf8');
  assert.doesNotMatch(built, /ReviveRelay bundled module: src\/lite\//);
  assert.equal(fs.existsSync(path.join(root, 'src', 'core')), false);
});
```
<!-- op:replace -->
Replace with:
```js
test('lite engine inventory is exact, frozen and bundled in load order at the end of the 1.0 bundle', () => {
  assert.deepEqual([...LITE_ENGINE_MODULES], EXPECTED);
  assert.equal(Object.isFrozen(LITE_ENGINE_MODULES), true);
  assert.deepEqual([...DIRECT_SUPPORT_MODULES].slice(-EXPECTED.length), EXPECTED);
  const version = require('../package.json').version;
  const built = fs.readFileSync(path.join(root, 'dist', 'review', `ReviveRelay-${version}.user.js`), 'utf8');
  const positions = EXPECTED.map(modulePath => built.indexOf(`/* ReviveRelay bundled module: ${modulePath} */`));
  for (const position of positions) assert.ok(position > 0);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.equal(fs.existsSync(path.join(root, 'src', 'core')), false);
});
```
<!-- op:find test/review-package.test.js -->
Find in `test/review-package.test.js`:
```js
  assert.equal(pkg.version,'0.7.3');
```
<!-- op:replace -->
Replace with:
```js
  assert.equal(pkg.version,'1.0.0');
```
<!-- op:find test/test-command.test.js -->
Find in `test/test-command.test.js`:
```js
dist/review/ReviveRelay-0.7.3.user.js
```
<!-- op:replace -->
Replace with:
```js
dist/review/ReviveRelay-1.0.0.user.js
```
<!-- op:find test/release-build.test.js -->
Find in `test/release-build.test.js`:
```js
test('build produces ReviveRelay 0.7.3 review artifact with permanent review distribution update URLs',()=>{
  assert.equal(pkg.version,'0.7.3');
  const file='dist/review/ReviveRelay-0.7.3.user.js';
  assert.ok(fs.existsSync(file),file);
  const text=fs.readFileSync(file,'utf8');
  assert.equal(text.match(/@version\s+(\S+)/)?.[1],'0.7.3');
```
<!-- op:replace -->
Replace with:
```js
test('build produces ReviveRelay 1.0.0 review artifact with permanent review distribution update URLs',()=>{
  assert.equal(pkg.version,'1.0.0');
  const file='dist/review/ReviveRelay-1.0.0.user.js';
  assert.ok(fs.existsSync(file),file);
  const text=fs.readFileSync(file,'utf8');
  assert.equal(text.match(/@version\s+(\S+)/)?.[1],'1.0.0');
```
<!-- op:find test/review-artifact-verifier.test.js -->
Find in `test/review-artifact-verifier.test.js`:
```js
test('immutable review verifier accepts the exact pinned candidate and rejects byte or provenance drift', () => {
  const { verifyReviewArtifactData } = require('../scripts/verify-review-artifact');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/review/BUILD-MANIFEST.json'), 'utf8'));
  const built = buildChannelArtifact('review', {
```
<!-- op:replace -->
Replace with:
```js
test('immutable review verifier accepts the exact pinned candidate and rejects byte or provenance drift', () => {
  const { verifyReviewArtifactData } = require('../scripts/verify-review-artifact');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/review/BUILD-MANIFEST.json'), 'utf8'));
  const version = require('../package.json').version;
  if (manifest.version !== version) {
    // A manifest pinning another version never verifies; the release task re-pins it.
    const fresh = buildChannelArtifact('review', { gitCommit: 'c'.repeat(40), buildTimestamp: '2026-11-26T12:00:00.000Z', write: false });
    assert.throws(() => verifyReviewArtifactData({ manifest, artifact: Buffer.from(fresh.artifact), meta: fresh.meta, version }), /version mismatch/i);
    return;
  }
  const built = buildChannelArtifact('review', {
```
- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:client 2>&1 | grep -E '^# (pass|fail)'`
Expected: several failures, including `canonical direct module inventory is exact and immutable`, `the Lite state client loads after…`, `ReviveRelay 1.0 is versioned 1.0.0`, `lite engine inventory is exact, frozen and bundled in load order…` and the `1.0.0` release-build/review-package/test-command assertions.

- [ ] **Step 3: Bundle the Lite modules and bump the version**

Replace the whole of `scripts/client-modules.js` with:
<!-- op:file scripts/client-modules.js -->
```js
'use strict';

// ReviveRelay 1.0 Lite engine, in load order. pill-state → scheduler → snapshot-cache →
// tab-leader → state-client → icons → tokens → pill-view → engine → boot.
const LITE_ENGINE_MODULES = Object.freeze([
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js',
  'src/lite/boot.js'
]);

// Bundle order: direct-api-client and versioning load before the Lite state client.
const DIRECT_SUPPORT_MODULES = Object.freeze([
  'src/platform.js',
  'src/core.js',
  'src/direct-api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  'src/sidebar-action.js',
  ...LITE_ENGINE_MODULES
]);

module.exports = { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES };

```
In `package.json`, replace every `0.7.3` with `1.0.0` (three occurrences: `version`, the `check` script and the `verify:review` script):
<!-- op:replaceall package.json 0.7.3 1.0.0 -->
```bash
sed -i 's/0\.7\.3/1.0.0/g' package.json && grep -c '1\.0\.0' package.json
```
Expected output: `3`.

- [ ] **Step 4: Run the client suite**

Run: `npm run test:client 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 585`, `# fail 0`. The build line reads `Built immutable ReviveRelay 1.0.0 review artifact at <HEAD>` (not "reproduced from pinned manifest").

- [ ] **Step 5: Commit**
```bash
git add scripts/client-modules.js package.json test/direct-only-build.test.js test/lite-bundle.test.js test/release-build.test.js test/review-package.test.js test/test-command.test.js test/review-artifact-verifier.test.js
git commit -m "build: bundle the Lite engine and version the client 1.0.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 8: The 1.0 entry point in MAIN

MAIN keeps the whole 0.7 panel (every screen and flow), but:

- **Boot:** `init()` initializes storage, starts the Lite boot (`startLite()`), drains diagnostics once if enabled, and checks for updates once (the update manager already throttles to 12 h). No panel is created at boot.
- **Pill → panel:** the pill's click toggles the panel (`handlePillActivate`); the panel is created lazily on first open and opens on the tab the pill points at (`reviver-*` → Reviver, `reviver-pro` → Pro, `requester-setup` with a session → Settings → Torn API key, otherwise Request). The panel starts closed on every page (`minimized: true`, not persisted).
- **No timers:** the nine `setInterval`s, the sidebar action (`src/sidebar-action.js`), the 0.7.3 PDA launcher and its 2 s watcher, and the PDA resume refresh are removed. While the panel is open, `engine.setSheetOpen(true)` runs the engine's 1 s tick and 5 s reviver cadence; `handlePillRender` refreshes the panel's data (`refreshPanelData`: `restoreSession()` plus a pending invoice) only when the pill's `stateVersion` changes, and otherwise re-renders live sections for transaction countdowns. Live refreshes call `renderLiveState()`, never `renderAll()`, so Settings inputs are not rebuilt under the user's typing.
- **Requests:** the Request tab gets a **Request certified revive** button (the sidebar action used to be the only way to create a request).
- **Sessions:** `clearSession`, `connectIdentity` and account deletion call `resetLiteSession()`; every mutation (`runMutation`) and transaction action calls `refreshPill()` so the leader re-polls at once.
- **Storage:** `reviverelay_state_snapshot_v1` joins `KEYS` (so `platform.storageKeys` and the TornPDA GM→PDA migration cover it); `reviverelay_panel_minimized` leaves `KEYS`.

**Files:**
- Modify: `torn-revive-chat-collector.user.js` (30 edits below, in file order)
- Modify: `scripts/client-modules.js` (full replacement)
- Delete: `src/sidebar-action.js`, `test/sidebar-action.test.js`, `test/sidebar-minimize-gear.test.js`, `test/sidebar-minimize-integration.test.js`, `test/tornpda-bootstrap-launcher.test.js`
- Create: `test/lite-userscript-boot.test.js`
- Modify: `test/direct-only-build.test.js` (full replacement) and the tests in the table below

**Interfaces:**
- Consumes: `globalThis.ReviveRelayLiteBoot.createLiteBoot` (Task 6) with `getToken: () => state.sessionToken`, `getSession: () => ({ signedIn: Boolean(state.sessionToken), tornId: state.identity?.tornId ?? null })`, `onActivate: handlePillActivate`, `onRender: handlePillRender`.
- Produces: MAIN functions `startLite()`, `refreshPill()`, `resetLiteSession()`, `refreshPanelData()`, `setPanelOpen(open)`, `panelTabForPill(view)`, `handlePillActivate()`, `handlePillRender({ snapshot })`, `requestRevive()` (renamed from `requestReviveFromSidebar`).

**MAIN source-regex tests, deliberately:**

| Test (file) | Decision | Why |
| --- | --- | --- |
| `sidebar-action.test.js` (whole file) | Retire | Module deleted; the pill is the entry point (lite-pill-view tests cover mount/launcher fallback). |
| `sidebar-minimize-gear.test.js` (6 tests) | Retire | Slices `installSidebar`/`restorePanelFromMinimized`, which no longer exist; minimize is now "close the panel". |
| `sidebar-minimize-integration.test.js` (3 tests) | Retire | Same: sidebar gear restore and persisted minimize are gone. |
| `tornpda-bootstrap-launcher.test.js` (5 tests) | Retire | The 0.7.3 `RR` launcher and its 2 s watcher are replaced by the pill's launcher fallback; the new smoke test proves boot on the real bundle. |
| `autosync.test.js` "direct runtime polls only…" | Rewrite | Now asserts the panel refresh paths exist and there is no `setInterval(`. |
| `client-hardening.test.js` mutation guard | Rename | `requestReviveFromSidebar` → `requestRevive`. |
| `client-hardening.test.js` eligibility suppression | Rewrite tail | Sliced `startTimers`; now checks `refreshMarketplaceState` still re-reads `/me` before Pro state. |
| `client-privacy.test.js` direct API/sidebar modules | Rewrite | Requires `ReviveRelayLiteBoot`, forbids `ReviveRelaySidebarAction`. |
| `direct-request-ui.test.js` (3 tests) | Rewrite/rename | Sidebar label → "Request certified revive"; function rename. |
| `live-capture.test.js` minimize | Rewrite | Minimize is `state.minimized = !open`. |
| `panel-ui.test.js` minimize persistence | Rewrite | Panel starts closed, opens from the pill, `KEYS.minimized` gone. |
| `panel-ui.test.js` recovery launcher | Rewrite | Asserts the launcher and every `setInterval` are gone. |
| `panel-ui.test.js` certified cards | Rewrite one assertion | Sidebar label → `id="rr-request-revive"`. |
| `bootstrap-controls.test.js` document-idle bootstrap | Rewrite one assertion | Sidebar label → "Request certified revive". |
| `requester-ui.test.js` preset/action, subscription independence | Rewrite/rename | Label and function rename. |
| `requester-ui.test.js` background polling | Rewrite | Slices `refreshPanelData`/`handlePillRender`: live-only renders, no `renderAll`. |
| `requester-ui.test.js` gear restores minimized panel | Rewrite | Goes through `setPanelOpen(true)`. |
| `review-release-smoke.test.js` | Rewrite one assertion | Bundle contains `createLiteBoot`, not `createSidebarController`. |
| `reviver-marketplace-ui.test.js` 1 s clock | Rewrite | The clock is the engine tick in `handlePillRender`, re-rendering only for an active transaction. |
| `update-ui.test.js` 12-hour timer | Rewrite | One check per page load; `UPDATE_CHECK_MS` still 12 h in the update manager. |
| `verification-credential-ui.test.js` request creation | Rename | Function rename. |
| `direct-only-build.test.js` | Replace | Final module inventory, Lite boot global, no sidebar. |

- [ ] **Step 1: Write the failing smoke test against the real built bundle**
<!-- op:file test/lite-userscript-boot.test.js -->
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createFakeDocument, createFakeWindow } = require('./helpers/fake-dom');

const version = require('../package.json').version;
const bundle = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'review', `ReviveRelay-${version}.user.js`), 'utf8');

function stateBody(tornId) {
  return {
    stateVersion: '0123456789abcdef',
    nextPollMs: 60000,
    serverTime: new Date().toISOString(),
    me: { tornId, name: 'Patient', roles: ['requester'], verification: { usable: true, requester: true, reviver: false } },
    pro: { state: 'NONE' },
    activeRequest: null,
    activeTransactions: [],
    recentlyClosed: [],
    revivers: { online: 3 },
    queue: null
  };
}

// Runs the real built userscript against fake GM, DOM and timers (no browser).
function bootUserscript({ values = {}, stateStatus = 200 } = {}) {
  const clock = createFakeTimers();
  const document = createFakeDocument();
  const window = createFakeWindow();
  const requests = [];
  const intervals = [];
  const store = { ...values };
  const context = vm.createContext({
    window,
    document,
    console: { log() {}, warn() {}, error() {} },
    URL,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: (...args) => { intervals.push(args); return 0; },
    clearInterval: () => {},
    GM_getValue: (key, fallback) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback),
    GM_setValue: (key, value) => { store[key] = value; },
    GM_addStyle: () => null,
    GM_notification: () => {},
    GM_xmlhttpRequest: details => {
      requests.push(details);
      const isState = details.url.endsWith('/v1/state');
      const status = isState ? stateStatus : 404;
      const body = isState && status === 200 ? stateBody(1001) : { error: status === 401 ? 'AUTH_REQUIRED' : 'NOT_FOUND' };
      Promise.resolve().then(() => details.onload({ status, responseText: JSON.stringify(body) }));
      return { abort() {} };
    }
  });
  vm.runInContext(bundle, context, { filename: `ReviveRelay-${version}.user.js` });
  return { clock, document, window, requests, intervals, store };
}

const pillHost = document => document.getElementById('reviverelay-lite-root');
const pillLabel = document => pillHost(document).attachedShadow.querySelector('.rr-label').textContent;

test('the built 1.0 userscript boots to the header pill from /v1/state with no setInterval and no panel', async () => {
  const { clock, document, requests, intervals, store } = bootUserscript({
    values: { reviverelay_session_token: 'session-token', reviverelay_public_identity: { tornId: 1001, name: 'Patient' } }
  });
  await clock.advance(0);
  assert.equal(intervals.length, 0);
  const state = requests.filter(request => request.url.endsWith('/v1/state'));
  assert.equal(state.length, 1);
  assert.equal(state[0].url, 'https://reviverelay.voidsmithindustries.com/review/v1/state');
  assert.equal(state[0].headers.Authorization, 'Bearer session-token');
  assert.equal(state[0].headers['X-ReviveRelay-Version'], version);
  assert.equal(pillLabel(document), 'Revive me');
  assert.equal(document.getElementById('rr-panel'), null);
  assert.equal(store.reviverelay_state_snapshot_v1.data.me.tornId, 1001);
  // Only /v1/state and the boot-time update check reach the network.
  assert.deepEqual([...new Set(requests.map(request => new URL(request.url).pathname.split('/').pop()))].sort(), ['ReviveRelay.meta.js', 'state']);
});

test('without a session the built userscript paints "Set up revives" and makes no /v1/state request', async () => {
  const { clock, document, requests } = bootUserscript();
  await clock.advance(120000);
  assert.equal(pillLabel(document), 'Set up revives');
  assert.equal(requests.filter(request => request.url.endsWith('/v1/state')).length, 0);
});

test('an expired session renders "Sign in again" and stops polling', async () => {
  const { clock, document, requests } = bootUserscript({
    stateStatus: 401,
    values: { reviverelay_session_token: 'stale', reviverelay_public_identity: { tornId: 1001, name: 'Patient' } }
  });
  await clock.advance(0);
  assert.equal(pillLabel(document), 'Sign in again');
  await clock.advance(600000);
  assert.equal(requests.filter(request => request.url.endsWith('/v1/state')).length, 1);
});

test('a cached snapshot of another Torn user is never painted', async () => {
  const other = { stateVersion: 'ffffffffffffffff', fetchedAt: Date.now(), data: { ...stateBody(2002), revivers: { online: 9 } } };
  const { clock, document, store } = bootUserscript({
    values: { reviverelay_session_token: 'token', reviverelay_public_identity: { tornId: 1001, name: 'Patient' }, reviverelay_state_snapshot_v1: other }
  });
  await clock.flush();
  assert.equal(pillLabel(document), 'ReviveRelay');
  assert.equal(store.reviverelay_state_snapshot_v1, null);
  await clock.advance(0);
  assert.equal(pillLabel(document), 'Revive me');
});

```
- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && node --test test/lite-userscript-boot.test.js`
Expected: `# fail 4` (`Cannot read properties of null (reading 'attachedShadow')`: MAIN does not start the Lite boot yet, and it calls `setInterval`).

- [ ] **Step 3: Rewrite MAIN as the 1.0 entry point**

Apply each edit in order to `torn-revive-chat-collector.user.js`.
**MAIN edit 1.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
  const API_BASE = 'https://reviverelay.voidsmithindustries.com/review';
  const REQUEST_POLL_MS = 10_000;
  const PRO_POLL_MS = 60_000;
  const QUEUE_POLL_MS = 10_000;
  const INVOICE_POLL_MS = 15_000;
  const SIDEBAR_RECONCILE_MS = 5_000;
  const TELEMETRY_DRAIN_MS = 30_000;
  const REVIVER_ELIGIBILITY_TIMEOUT_MS
```
<!-- op:replace -->
Replace with:
```js
  const API_BASE = 'https://reviverelay.voidsmithindustries.com/review';
  const REVIVER_ELIGIBILITY_TIMEOUT_MS
```
**MAIN edit 2.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    seenRequestIds: 'reviverelay_seen_request_ids',
    minimized: 'reviverelay_panel_minimized',
    panelPosition
```
<!-- op:replace -->
Replace with:
```js
    seenRequestIds: 'reviverelay_seen_request_ids',
    stateSnapshot: 'reviverelay_state_snapshot_v1',
    panelPosition
```
**MAIN edit 3.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    [KEYS.minimized]: false,

```
<!-- op:replace -->
Replace with:
```js
    [KEYS.stateSnapshot]: null,

```
**MAIN edit 4.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
  const SidebarAction = globalThis.ReviveRelaySidebarAction;

  if (!Platform || !Core || !DirectApiClient || !UpdateManager || !TelemetryClient || !RequestPreset || !SidebarAction) {
```
<!-- op:replace -->
Replace with:
```js
  const LiteBoot = globalThis.ReviveRelayLiteBoot;

  if (!Platform || !Core || !DirectApiClient || !UpdateManager || !TelemetryClient || !RequestPreset || !LiteBoot) {
```
**MAIN edit 5.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    submittingRequest: false,
    sidebarController: null,
    settingsOpen: false,
    settingsSection: null,
    minimized: false,
```
<!-- op:replace -->
Replace with:
```js
    submittingRequest: false,
    settingsOpen: false,
    settingsSection: null,
    // The panel starts closed on every page; the header pill opens it.
    minimized: true,
```
**MAIN edit 6.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
  let connectionPill = null;
  let pdaLauncher = null;
  let initPromise = null;
  let pdaReadyHookInstalled = false;
  let pdaLauncherWatchTimer = null;
  let statusMessage = '';
  let statusIsError = false;
  let lastRequestError = null;
  let updateResult = null;
  let requestTimer = null;
  let proTimer = null;
  let queueTimer = null;
  let invoiceTimer = null;
  let sidebarTimer = null;
  let telemetryTimer = null;
  let clockTimer = null;
  let updateTimer = null;

```
<!-- op:replace -->
Replace with:
```js
  let connectionPill = null;
  let initPromise = null;
  let liteBoot = null;
  let latestPillStateVersion = null;
  let panelStateVersion = null;
  let statusMessage = '';
  let statusIsError = false;
  let lastRequestError = null;
  let updateResult = null;

```
**MAIN edit 7.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    } finally {
      mutationFlights.delete(key);
      renderLiveState();
      renderProPanel();
      if (state.settingsOpen) renderSettingsDrawer();
    }
  }
```
<!-- op:replace -->
Replace with:
```js
    } finally {
      mutationFlights.delete(key);
      renderLiveState();
      renderProPanel();
      if (state.settingsOpen) renderSettingsDrawer();
      refreshPill();
    }
  }
```
**MAIN edit 8.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    storage.set(KEYS.sessionToken, '');
    storage.set(KEYS.publicIdentity, null);
    setStatus(message, false);
    refreshSidebarState();
    renderAll();
  }
```
<!-- op:replace -->
Replace with:
```js
    storage.set(KEYS.sessionToken, '');
    storage.set(KEYS.publicIdentity, null);
    setStatus(message, false);
    resetLiteSession();
    renderAll();
  }
```
**MAIN edit 9.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
      storage.set(KEYS.sessionToken, state.sessionToken);
      storage.set(KEYS.publicIdentity, publicIdentity());
      await refreshMarketplaceState({ includePlans: true });
      setStatus(runtimeCompatible() ? 'ReviveRelay connected with your Torn API key.' : runtimeCompatibilityMessage(), !runtimeCompatible());
      refreshSidebarState();
      renderAll();
```
<!-- op:replace -->
Replace with:
```js
      storage.set(KEYS.sessionToken, state.sessionToken);
      storage.set(KEYS.publicIdentity, publicIdentity());
      resetLiteSession();
      await refreshMarketplaceState({ includePlans: true });
      setStatus(runtimeCompatible() ? 'ReviveRelay connected with your Torn API key.' : runtimeCompatibilityMessage(), !runtimeCompatible());
      renderAll();
```
**MAIN edit 10.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
      if (state.activeRequest?.transactionId) await refreshActiveTransaction(state.activeRequest.transactionId);
      else if (state.activeTransaction?.participantRole === 'requester') state.activeTransaction = null;
      refreshSidebarState();
    });
```
<!-- op:replace -->
Replace with:
```js
      if (state.activeRequest?.transactionId) await refreshActiveTransaction(state.activeRequest.transactionId);
      else if (state.activeTransaction?.participantRole === 'requester') state.activeTransaction = null;
    });
```
**MAIN edit 11.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
  async function requestReviveFromSidebar() {
    const validation = RequestPreset.validatePreset(state.preset);
    if (!state.sessionToken || !runtimeCompatible() || !validation.ok || state.submittingRequest || state.activeRequest) return;
    return runMutation('request-create', async () => {
      state.submittingRequest = true;
      lastRequestError = null;
      refreshSidebarState();
      renderAll();
```
<!-- op:replace -->
Replace with:
```js
  async function requestRevive() {
    const validation = RequestPreset.validatePreset(state.preset);
    if (!state.sessionToken || !runtimeCompatible() || !validation.ok || state.submittingRequest || state.activeRequest) return;
    return runMutation('request-create', async () => {
      state.submittingRequest = true;
      lastRequestError = null;
      renderAll();
```
**MAIN edit 12.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
      } finally {
        state.submittingRequest = false;
        refreshSidebarState();
        renderAll();
      }
```
<!-- op:replace -->
Replace with:
```js
      } finally {
        state.submittingRequest = false;
        renderAll();
      }
```
**MAIN edit 13.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
        setStatus('ReviveRelay account data deletion completed. Minimal billing/security evidence may remain only where required for payment-reuse prevention, refunds, disputes, or audit history.');
        refreshSidebarState();
        renderAll();
```
<!-- op:replace -->
Replace with:
```js
        setStatus('ReviveRelay account data deletion completed. Minimal billing/security evidence may remain only where required for payment-reuse prevention, refunds, disputes, or audit history.');
        resetLiteSession();
        renderAll();
```
**MAIN edit 14.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    lastRequestError = null;
    setStatus('Revive Me preset saved.');
    refreshSidebarState();
    renderAll();
```
<!-- op:replace -->
Replace with:
```js
    lastRequestError = null;
    setStatus('Revive Me preset saved.');
    renderAll();
```
**MAIN edit 15.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
      else return;
      await refreshActiveTransaction(id);
      setStatus('Transaction state refreshed.');
      renderAll();
```
<!-- op:replace -->
Replace with:
```js
      else return;
      await refreshActiveTransaction(id);
      setStatus('Transaction state refreshed.');
      refreshPill();
      renderAll();
```
**MAIN edit 16.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
  function sidebarState() {
    return RequestPreset.deriveSidebarState({
      sessionToken: state.sessionToken,
      preset: state.preset,
      submitting: state.submittingRequest,
      activeRequest: state.activeRequest,
      lastError: state.sessionToken && !runtimeCompatible() ? 'RUNTIME_INCOMPATIBLE' : lastRequestError
    });
  }

  function refreshSidebarState() {
    syncPdaLauncher();
    if (!state.sidebarController) return;
    try {
      state.sidebarController.setState(sidebarState());
      state.sidebarController.reconcile();
    } catch (error) {
      captureClientError(error, 'sidebar.reconcile');
    }
  }

  function handleSidebarActivate(currentState) {
    if (currentState === 'READY') {
      requestReviveFromSidebar();
      return;
    }
    if (currentState === 'SETUP_REQUIRED') {
      if (state.sessionToken) openSettingsDrawer('preset');
      else activatePanelTab('request');
    } else activatePanelTab('request');
  }

```
<!-- op:replace -->
Replace with:
```js
  // Ask the pill's leader tab for a fresh /v1/state after something changed server state.
  function refreshPill() {
    if (liteBoot) liteBoot.refresh();
  }

  // Sign-in, sign-out or account deletion: the pill forgets the previous session at once.
  function resetLiteSession() {
    panelStateVersion = null;
    if (liteBoot) liteBoot.resetSession();
  }

  // The open panel refreshes itself only when the pill's /v1/state snapshot changes.
  function refreshPanelData() {
    return runSingleFlightPoll('panel', async () => {
      await restoreSession();
      if (state.currentInvoice?.state === 'PENDING') await refreshCurrentInvoice();
      // Live sections only: never rebuild Settings form controls while someone types in them.
      renderLiveState();
    }).catch(error => handleApiFailure(error, 'panel.refresh'));
  }

  function setPanelOpen(open) {
    if (open && !panel) createPanel();
    state.minimized = !open;
    if (panel) panel.style.display = open ? '' : 'none';
    if (open) applyPanelPosition(state.panelPosition);
    if (liteBoot) liteBoot.setPanelOpen(open);
  }

  function panelTabForPill(view) {
    const sheet = String(view?.sheet || '');
    if (sheet === 'reviver-pro') return 'settings';
    if (sheet.startsWith('reviver-')) return 'reviver';
    return 'request';
  }

  // The header pill is the 1.0 entry point: it toggles the panel on the tab its state points at.
  function handlePillActivate() {
    if (panel && !state.minimized) {
      setPanelOpen(false);
      return;
    }
    const view = liteBoot ? liteBoot.engine.viewModel() : null;
    setPanelOpen(true);
    if (view?.sheet === 'requester-setup' && state.sessionToken) openSettingsDrawer('verification');
    else activatePanelTab(panelTabForPill(view));
    panelStateVersion = latestPillStateVersion;
    refreshPanelData();
    if (storage.get(KEYS.clientDiagnosticsEnabled, false)) state.telemetry.drain().catch(() => {});
  }

  // Runs after every pill render (each poll, and every second while the panel is open).
  function handlePillRender({ snapshot }) {
    latestPillStateVersion = snapshot?.stateVersion || null;
    if (!panel || state.minimized) return;
    if (latestPillStateVersion && latestPillStateVersion !== panelStateVersion) {
      panelStateVersion = latestPillStateVersion;
      refreshPanelData();
    } else if (state.activeTransaction) {
      renderLiveState();
    }
  }

```
**MAIN edit 17.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
      <div class="rr-card-title">Revive Me</div>
      <p>Use Torn's left sidebar action <strong>ReviveRelay → Revive Me!</strong> for the one-click certified request.</p>
      <div class="rr-kv"><span>Saved preset</span><strong>${presetText}</strong></div>
      ${validation.ok ? '' : '<button data-rr-open-settings="preset">Configure Revive Me preset</button>'}
```
<!-- op:replace -->
Replace with:
```js
      <div class="rr-card-title">Revive Me</div>
      <div class="rr-kv"><span>Saved preset</span><strong>${presetText}</strong></div>
      ${validation.ok ? '' : '<button data-rr-open-settings="preset">Configure Revive Me preset</button>'}
      ${validation.ok && !request ? `<button id="rr-request-revive"${disabledAttr('request-create')}>Request certified revive</button>` : ''}
```
**MAIN edit 18.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
        <p>This powers the red <strong>ReviveRelay → Revive Me!</strong> sidebar button.</p>
```
<!-- op:replace -->
Replace with:
```js
        <p>This is the offer sent by <strong>Request certified revive</strong> in the Request tab.</p>
```
**MAIN edit 19.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    state.settingsSection = ['preset', 'verification'].includes(section) ? section : null;
    if (state.minimized) {
      state.minimized = false;
      storage.set(KEYS.minimized, state.minimized);
      if (panel) panel.style.display = '';
      refreshSidebarState();
    }
```
<!-- op:replace -->
Replace with:
```js
    state.settingsSection = ['preset', 'verification'].includes(section) ? section : null;
    if (state.minimized) setPanelOpen(true);
```
**MAIN edit 20.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    if (opening && state.minimized) {
      state.minimized = false;
      storage.set(KEYS.minimized, state.minimized);
      if (panel) panel.style.display = '';
      refreshSidebarState();
    }
```
<!-- op:replace -->
Replace with:
```js
    if (opening && state.minimized) setPanelOpen(true);
```
**MAIN edit 21.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    storage.set(KEYS.panelTab, state.panelTab);
    if (state.minimized) {
      state.minimized = false;
      storage.set(KEYS.minimized, state.minimized);
      if (panel) panel.style.display = state.minimized ? 'none' : '';
      refreshSidebarState();
    }
```
<!-- op:replace -->
Replace with:
```js
    storage.set(KEYS.panelTab, state.panelTab);
    if (state.minimized) setPanelOpen(true);
```
**MAIN edit 22.**
Delete this block (replace it with nothing):
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
  function isRecoveryLauncherContext() {
    if (isTornPdaNow()) return true;
    let coarsePointer = false;
    try { coarsePointer = Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (_) {}
    const viewportWidth = Number(window.innerWidth) || 0;
    return coarsePointer || (viewportWidth > 0 && viewportWidth <= 900);
  }

  function applyRecoveryLauncherCriticalStyle(button) {
    const critical = {
      position: 'fixed',
      zIndex: '2147483646',
      right: '10px',
      bottom: '10px',
      width: '48px',
      height: '48px',
      alignItems: 'center',
      justifyContent: 'center',
      border: '1px solid #e06565',
      borderRadius: '50%',
      background: '#a4161a',
      color: '#fff',
      font: '800 12px/1 Arial,sans-serif',
      letterSpacing: '.05em',
      boxShadow: '0 8px 24px rgba(0,0,0,.5)',
      touchAction: 'manipulation',
      visibility: 'visible',
      opacity: '1',
      pointerEvents: 'auto'
    };
    for (const [name, value] of Object.entries(critical)) button.style.setProperty(name.replace(/[A-Z]/g, match => '-' + match.toLowerCase()), value, 'important');
    button.style.setProperty('right', 'calc(10px + env(safe-area-inset-right,0px))', 'important');
    button.style.setProperty('bottom', 'calc(10px + env(safe-area-inset-bottom,0px))', 'important');
  }

  function restorePanelFromPdaLauncher() {
    if (!panel) {
      start();
      return;
    }
    state.minimized = false;
    storage.set(KEYS.minimized, false);
    panel.style.display = '';
    if (isTornPdaNow()) panel.classList.add('rr-tornpda');
    applyPanelPosition(state.panelPosition);
    refreshSidebarState();
    renderAll();
  }

  function syncPdaLauncher(options = {}) {
    if (!document.body) return null;
    if (!pdaLauncher || !pdaLauncher.isConnected) {
      pdaLauncher = document.getElementById('rr-pda-launcher');
      if (!pdaLauncher) {
        pdaLauncher = document.createElement('button');
        pdaLauncher.id = 'rr-pda-launcher';
        pdaLauncher.type = 'button';
        pdaLauncher.textContent = 'RR';
        pdaLauncher.setAttribute('aria-label', 'Open ReviveRelay');
        pdaLauncher.setAttribute('title', 'Open ReviveRelay');
        pdaLauncher.addEventListener('click', restorePanelFromPdaLauncher);
        document.body.appendChild(pdaLauncher);
      }
    }
    applyRecoveryLauncherCriticalStyle(pdaLauncher);
    const shouldShow = Boolean(options.forceVisible || state.minimized || isRecoveryLauncherContext());
    pdaLauncher.style.setProperty('display', shouldShow ? 'inline-flex' : 'none', 'important');
    pdaLauncher.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    return pdaLauncher;
  }

  function startPdaLauncherWatch() {
    if (pdaLauncherWatchTimer || !isRecoveryLauncherContext()) return;
    pdaLauncherWatchTimer = window.setInterval(() => {
      if (!document.body) return;
      syncPdaLauncher({ forceVisible: true });
    }, 2000);
  }

  function reconcilePdaReadyUi() {
    syncPdaLauncher({ forceVisible: true });
    startPdaLauncherWatch();
    if (!panel || !isTornPdaNow()) return;
    panel.classList.add('rr-tornpda');
    applyPanelPosition(null);
  }

  function installPdaReadinessHook() {
    if (pdaReadyHookInstalled) return;
    pdaReadyHookInstalled = true;
    window.addEventListener?.('flutterInAppWebViewPlatformReady', reconcilePdaReadyUi);
    const readyPromise = globalThis.__PDA_platformReadyPromise;
    if (readyPromise && typeof readyPromise.then === 'function') {
      Promise.resolve(readyPromise).then(reconcilePdaReadyUi).catch(() => {});
    }
  }


```
<!-- op:replace -->
Replace with:
```js

```
**MAIN edit 23.**
Delete this block (replace it with nothing):
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
      #rr-pda-launcher{position:fixed!important;z-index:2147483646!important;right:calc(10px + env(safe-area-inset-right,0px))!important;bottom:calc(10px + env(safe-area-inset-bottom,0px))!important;width:48px!important;height:48px!important;align-items:center!important;justify-content:center!important;border:1px solid #e06565!important;border-radius:50%!important;background:#a4161a!important;color:#fff!important;font:800 12px/1 Arial,sans-serif!important;letter-spacing:.05em!important;box-shadow:0 8px 24px rgba(0,0,0,.5)!important;touch-action:manipulation!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important}

```
<!-- op:replace -->
Replace with:
```js

```
**MAIN edit 24.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    applyPanelPosition(state.panelPosition);
    syncPdaLauncher();

    panel.addEventListener('click', event => {
```
<!-- op:replace -->
Replace with:
```js
    applyPanelPosition(state.panelPosition);

    panel.addEventListener('click', event => {
```
**MAIN edit 25.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
      if (target.id === 'rr-cancel-request') return cancelActiveRequest();
```
<!-- op:replace -->
Replace with:
```js
      if (target.id === 'rr-request-revive') return requestRevive();
      if (target.id === 'rr-cancel-request') return cancelActiveRequest();
```
**MAIN edit 26.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
      if (target.id === 'rr-minimize') {
        state.minimized = !state.minimized;
        storage.set(KEYS.minimized, state.minimized);
        panel.style.display = state.minimized ? 'none' : '';
        applyPanelPosition(state.panelPosition);
        refreshSidebarState();
      }
```
<!-- op:replace -->
Replace with:
```js
      if (target.id === 'rr-minimize') return setPanelOpen(false);
```
**MAIN edit 27.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    window.addEventListener('resize', () => {
      applyPanelPosition(state.panelPosition);
      persistPanelPosition();
      refreshSidebarState();
    });
```
<!-- op:replace -->
Replace with:
```js
    window.addEventListener('resize', () => {
      applyPanelPosition(state.panelPosition);
      persistPanelPosition();
    });
```
**MAIN edit 28.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
  function restorePanelFromMinimized() {
    if (!state.minimized) return;
    state.minimized = false;
    storage.set(KEYS.minimized, state.minimized);
    if (panel) panel.style.display = '';
    applyPanelPosition(state.panelPosition);
    refreshSidebarState();
  }

  function installSidebar() {
    state.sidebarController = SidebarAction.createSidebarController({
      document,
      window,
      label: 'ReviveRelay → Revive Me!',
      gearLabel: 'Restore ReviveRelay',
      getState: sidebarState,
      onActivate: handleSidebarActivate,
      getMinimized: () => state.minimized,
      onRestore: restorePanelFromMinimized
    });
    state.sidebarController.reconcile();
    window.addEventListener('popstate', () => setTimeout(refreshSidebarState, 150));
    window.addEventListener('hashchange', () => setTimeout(refreshSidebarState, 150));
  }

  function startTimers() {
    requestTimer = setInterval(() => {
      if (!state.sessionToken || !runtimeCompatible()) return;
      refreshActiveRequest().then(renderLiveState).catch(error => handleApiFailure(error, 'poll.request'));
    }, REQUEST_POLL_MS);
    proTimer = setInterval(() => {
      if (!state.sessionToken) return;
      const refresh = runtimeCompatible()
        ? refreshProState({ includePlans: false }).then(() => refreshVerificationCredential()).then(() => refreshReviverEligibility())
        : refreshMe();
      Promise.resolve(refresh).then(renderLiveState).catch(error => handleApiFailure(error, 'poll.pro'));
    }, PRO_POLL_MS);
    queueTimer = setInterval(() => {
      if (!state.sessionToken || !hasReviverSubscriptionAccess()) return;
      refreshReviverQueue().then(renderLiveState).catch(error => handleApiFailure(error, 'poll.queue'));
    }, QUEUE_POLL_MS);
    invoiceTimer = setInterval(() => {
      if (!runtimeCompatible() || state.minimized || document.visibilityState !== 'visible' || state.currentInvoice?.state !== 'PENDING') return;
      refreshCurrentInvoice().then(renderLiveState).catch(error => handleApiFailure(error, 'poll.invoice'));
    }, INVOICE_POLL_MS);
    sidebarTimer = setInterval(refreshSidebarState, SIDEBAR_RECONCILE_MS);
    telemetryTimer = setInterval(() => {
      if (!storage.get(KEYS.clientDiagnosticsEnabled, false)) return;
      state.telemetry.drain().catch(() => {});
    }, TELEMETRY_DRAIN_MS);
    clockTimer = setInterval(() => {
      if (!state.minimized && state.activeTransaction) renderLiveState();
    }, 1000);
    updateTimer = setInterval(() => {
      checkUpdates(false).catch(error => captureClientError(error, 'update.scheduled'));
    }, UpdateManager.UPDATE_CHECK_MS);
  }

```
<!-- op:replace -->
Replace with:
```js
  // ReviveRelay 1.0: one engine (scheduler, tab leadership, /v1/state) drives the header pill.
  // The panel below has no timers of its own; it refreshes while open when the pill's state changes.
  function startLite() {
    liteBoot = LiteBoot.createLiteBoot({
      platform,
      window,
      document,
      baseUrl: API_BASE,
      clientVersion: VERSION,
      releaseChannel: UPDATE_CHANNEL,
      getToken: () => state.sessionToken,
      getSession: () => ({ signedIn: Boolean(state.sessionToken), tornId: state.identity?.tornId ?? null }),
      onActivate: handlePillActivate,
      onRender: handlePillRender
    });
    liteBoot.start();
  }

```
**MAIN edit 29.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
    state.preset = storage.get(KEYS.requestPreset, null) || null;
    state.minimized = Boolean(storage.get(KEYS.minimized, false));

```
<!-- op:replace -->
Replace with:
```js
    state.preset = storage.get(KEYS.requestPreset, null) || null;

```
**MAIN edit 30.**
<!-- op:find torn-revive-chat-collector.user.js -->
Find:
```js
  let resumeRefreshInFlight = null;
  function refreshAfterResume() {
    if (!isTornPdaNow() || resumeRefreshInFlight) return resumeRefreshInFlight;
    resumeRefreshInFlight = Promise.resolve()
      .then(async () => {
        refreshSidebarState();
        if (!state.sessionToken) return;
        await refreshMarketplaceState({ includePlans: false });
        renderAll();
      })
      .catch(error => handleApiFailure(error, 'runtime.resume', 'ReviveRelay could not refresh after returning to Torn.'))
      .finally(() => { resumeRefreshInFlight = null; });
    return resumeRefreshInFlight;
  }

  async function init() {
    await platform.initialize();
    hydratePersistentState();
    createPanel();
    if (isTornPdaNow() && storage.mode() !== 'pda') {
      setStatus('TornPDA durable storage is unavailable. ReviveRelay is using compatibility storage for this session.', true);
    }
    installSidebar();
    installGlobalErrorHooks();
    platform.onResume(refreshAfterResume);
    startTimers();
    refreshSidebarState();
    await restoreSession();
    renderAll();
    checkUpdates(false).catch(error => captureClientError(error, 'update.initial'));
  }

  function start() {
    installPdaReadinessHook();
    syncPdaLauncher({ forceVisible: isRecoveryLauncherContext() });
    startPdaLauncherWatch();
    if (initPromise) return initPromise;
    initPromise = init().catch(error => {
      console.error('[ReviveRelay] Initialization failed.', error);
      syncPdaLauncher({ forceVisible: true });
      if (pdaLauncher) pdaLauncher.setAttribute('title', 'ReviveRelay failed to initialize. Tap to retry.');
      if (panel) setStatus('ReviveRelay could not finish initialization. Tap RR or reload Torn to retry.', true);
    }).finally(() => { initPromise = null; });
    return initPromise;
  }

```
<!-- op:replace -->
Replace with:
```js
  async function init() {
    await platform.initialize();
    hydratePersistentState();
    if (isTornPdaNow() && storage.mode() !== 'pda') {
      setStatus('TornPDA durable storage is unavailable. ReviveRelay is using compatibility storage for this session.', true);
    }
    installGlobalErrorHooks();
    startLite();
    if (storage.get(KEYS.clientDiagnosticsEnabled, false)) state.telemetry.drain().catch(() => {});
    // Update checks run once per page load; the update manager throttles them to every 12 h.
    checkUpdates(false).catch(error => captureClientError(error, 'update.initial'));
  }

  function start() {
    if (initPromise || liteBoot) return initPromise;
    initPromise = init().catch(error => {
      console.error('[ReviveRelay] Initialization failed.', error);
    }).finally(() => { initPromise = null; });
    return initPromise;
  }

```
Then check that nothing of the old runtime is left:

```bash
grep -nE "setInterval|refreshSidebarState|syncPdaLauncher|KEYS\.minimized|SidebarAction|requestReviveFromSidebar|startTimers" torn-revive-chat-collector.user.js; node --check torn-revive-chat-collector.user.js && echo ok
```
Expected output: `ok` only.

- [ ] **Step 4: Drop the sidebar action from the bundle**

Replace the whole of `scripts/client-modules.js` with:
<!-- op:file scripts/client-modules.js -->
```js
'use strict';

// ReviveRelay 1.0 Lite engine, in load order. pill-state → scheduler → snapshot-cache →
// tab-leader → state-client → icons → tokens → pill-view → engine → boot.
const LITE_ENGINE_MODULES = Object.freeze([
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js',
  'src/lite/boot.js'
]);

// Bundle order: direct-api-client and versioning load before the Lite state client.
const DIRECT_SUPPORT_MODULES = Object.freeze([
  'src/platform.js',
  'src/core.js',
  'src/direct-api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  ...LITE_ENGINE_MODULES
]);

module.exports = { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES };

```
```bash
git rm src/sidebar-action.js test/sidebar-action.test.js test/sidebar-minimize-gear.test.js test/sidebar-minimize-integration.test.js test/tornpda-bootstrap-launcher.test.js
```
<!-- op:delete src/sidebar-action.js -->
<!-- op:delete test/sidebar-action.test.js -->
<!-- op:delete test/sidebar-minimize-gear.test.js -->
<!-- op:delete test/sidebar-minimize-integration.test.js -->
<!-- op:delete test/tornpda-bootstrap-launcher.test.js -->
- [ ] **Step 5: Retire and rewrite the MAIN source-regex tests (table above)**

Replace the whole of `test/direct-only-build.test.js` with:
<!-- op:file test/direct-only-build.test.js -->
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES } = require('../scripts/client-modules');

const REQUIRED = [
  'src/platform.js',
  'src/core.js',
  'src/direct-api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js',
  'src/lite/boot.js'
];

const FORBIDDEN = [
  'src/api-client.js',
  'src/chat-dom.js',
  'src/public-channels.js',
  'src/client-chat-policy.js',
  'src/revive-classifier.js',
  'src/candidate-pipeline.js',
  'src/sidebar-action.js'
];

function bundledMarker(relativePath) {
  return `/* ReviveRelay bundled module: ${relativePath} */`;
}

test('canonical direct module inventory is exact and immutable', () => {
  assert.deepEqual([...DIRECT_SUPPORT_MODULES], REQUIRED);
  assert.equal(Object.isFrozen(DIRECT_SUPPORT_MODULES), true);
  assert.deepEqual([...LITE_ENGINE_MODULES], REQUIRED.filter(modulePath => modulePath.startsWith('src/lite/')));
});

test('the Lite state client loads after the direct API client and versioning it depends on', () => {
  const index = modulePath => DIRECT_SUPPORT_MODULES.indexOf(modulePath);
  assert.ok(index('src/direct-api-client.js') < index('src/lite/state-client.js'));
  assert.ok(index('src/versioning.js') < index('src/lite/state-client.js'));
  assert.ok(index('src/lite/engine.js') < index('src/lite/boot.js'));
});

test('main bootstrap consumes the exact core and Lite boot globals', () => {
  const coreSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'core.js'), 'utf8');
  const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

  assert.match(coreSource, /root\.TornReviveCore\s*=\s*api/);
  assert.match(mainSource, /const Core = globalThis\.TornReviveCore;/);
  assert.match(mainSource, /const LiteBoot = globalThis\.ReviveRelayLiteBoot;/);
  assert.doesNotMatch(mainSource, /TornReviveChatCollectorCore|ReviveRelaySidebarAction/);
});

test('current review bundle contains direct support exactly once and zero legacy chat/candidate/sidebar modules', () => {
  const version = require('../package.json').version;
  const filename = `review/ReviveRelay-${version}.user.js`;
  const built = fs.readFileSync(path.resolve(__dirname, '..', 'dist', filename), 'utf8');
  for (const modulePath of REQUIRED) {
    assert.equal(built.split(bundledMarker(modulePath)).length - 1, 1, `${filename}: ${modulePath}`);
  }
  for (const modulePath of FORBIDDEN) {
    assert.equal(built.includes(bundledMarker(modulePath)), false, `${filename}: ${modulePath}`);
  }
  assert.doesNotMatch(built, /\/v1\/candidates|Shared public chat requests|Live Capture|Rescan public chats/);
  assert.doesNotMatch(built, /ReviveRelayApiClient|ReviveRelayProClient|createProClient|submitCandidate|drainCandidateOutbox|createOutboxEntry/);
  assert.doesNotMatch(built, /createSidebarController|ReviveRelay → Revive Me!/);
  assert.match(built, /ReviveRelayDirectApiClient/);
  assert.match(built, /ReviveRelayLiteBoot/);
  assert.match(built, /Request certified revive/);
  assert.match(built, /const UPDATE_CHANNEL = 'review'/);
});

test('ReviveRelay 1.0 is versioned 1.0.0', () => {
  assert.equal(require('../package.json').version, '1.0.0');
});

```
Rename the request function in four test files:
```bash
sed -i 's/requestReviveFromSidebar/requestRevive/g' test/client-hardening.test.js test/direct-request-ui.test.js test/requester-ui.test.js test/verification-credential-ui.test.js
```
<!-- op:replaceall test/client-hardening.test.js requestReviveFromSidebar requestRevive -->
<!-- op:replaceall test/direct-request-ui.test.js requestReviveFromSidebar requestRevive -->
<!-- op:replaceall test/requester-ui.test.js requestReviveFromSidebar requestRevive -->
<!-- op:replaceall test/verification-credential-ui.test.js requestReviveFromSidebar requestRevive -->
Then apply these test edits:
<!-- op:find test/autosync.test.js -->
Find in `test/autosync.test.js`:
```js
test('direct runtime polls only product state, Pro state, queue, invoice, sidebar and diagnostics', () => {
  for (const token of [
    'refreshActiveRequest()','refreshProState({ includePlans: false })',
    'refreshReviverQueue()','refreshCurrentInvoice()','refreshSidebarState',
    'state.telemetry.drain()'
  ]) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /postJson\(|markSynced\(|handlePublicMessage\(/);
});
```
<!-- op:replace -->
Replace with:
```js
test('1.0 runtime has no timers of its own: the Lite engine polls, the open panel refreshes on state changes', () => {
  for (const token of [
    'refreshActiveRequest()','refreshProState({ includePlans',
    'refreshReviverQueue()','refreshCurrentInvoice()','liteBoot.refresh()',
    'state.telemetry.drain()','function refreshPanelData()'
  ]) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.doesNotMatch(source, /postJson\(|markSynced\(|handlePublicMessage\(/);
});
```
<!-- op:find test/client-hardening.test.js -->
Find in `test/client-hardening.test.js`:
```js
  const timers=functionSlice('startTimers','init');
  assert.match(timers,/runtimeCompatible\(\)\s*\?\s*refreshProState[\s\S]*?:\s*refreshMe\(\)/,
    'entitlement refresh remains available for runtime reactivation');
```
<!-- op:replace -->
Replace with:
```js
  const marketplace=functionSlice('refreshMarketplaceState','requestRevive');
  assert.match(marketplace,/await refreshMe\(\);\s*if \(!runtimeCompatible\(\)\) return;\s*await refreshProState/,
    'entitlement refresh remains available for runtime reactivation');
```
<!-- op:find test/client-privacy.test.js -->
Find in `test/client-privacy.test.js`:
```js
test('production source uses direct API/sidebar modules without wildcard network permission', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');
  assert.match(source, /ReviveRelayDirectApiClient/);
  assert.doesNotMatch(source, /ReviveRelayApiClient/);
  assert.match(source, /ReviveRelayRequestPreset/);
  assert.match(source, /ReviveRelaySidebarAction/);
```
<!-- op:replace -->
Replace with:
```js
test('production source uses direct API and Lite modules without wildcard network permission', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');
  assert.match(source, /ReviveRelayDirectApiClient/);
  assert.doesNotMatch(source, /ReviveRelayApiClient/);
  assert.match(source, /ReviveRelayRequestPreset/);
  assert.match(source, /ReviveRelayLiteBoot/);
  assert.doesNotMatch(source, /ReviveRelaySidebarAction/);
```
<!-- op:find test/direct-request-ui.test.js -->
Find in `test/direct-request-ui.test.js`:
```js
test('main runtime is direct-only and exposes the exact Torn sidebar action',()=>{
  for(const required of [
    'ReviveRelay → Revive Me!',
```
<!-- op:replace -->
Replace with:
```js
test('main runtime is direct-only and exposes the panel request action',()=>{
  for(const required of [
    'Request certified revive',
```
<!-- op:find test/direct-request-ui.test.js -->
Find in `test/direct-request-ui.test.js`:
```js
test('sidebar one-click request validates the saved preset and posts only to ReviveRelay request API',()=>{
```
<!-- op:replace -->
Replace with:
```js
test('panel one-click request validates the saved preset and posts only to ReviveRelay request API',()=>{
```
<!-- op:find test/live-capture.test.js -->
Find in `test/live-capture.test.js`:
```js
  assert.match(source, /state\.minimized = !state\.minimized/);
```
<!-- op:replace -->
Replace with:
```js
  assert.match(source, /state\.minimized = !open/);
```
<!-- op:find test/panel-ui.test.js -->
Find in `test/panel-ui.test.js`:
```js
test('minimize state remains independent, persists across reloads, and hides the entire floating panel', () => {
  assert.match(source, /state\.minimized = Boolean\(storage\.get\(KEYS\.minimized, false\)\)/);
  assert.match(source, /storage\.set\(KEYS\.minimized, state\.minimized\)/);
  assert.match(source, /panel\.style\.display = state\.minimized/);
  assert.doesNotMatch(source, /body\.style\.display = state\.minimized/);
});
```
<!-- op:replace -->
Replace with:
```js
test('the panel starts closed on every page, opens from the pill and hides the entire floating panel', () => {
  assert.match(source, /minimized: true,/);
  assert.match(source, /state\.minimized = !open;/);
  assert.match(source, /panel\.style\.display = open \? '' : 'none'/);
  assert.match(source, /onActivate: handlePillActivate/);
  assert.doesNotMatch(source, /KEYS\.minimized/);
  assert.doesNotMatch(source, /body\.style\.display = state\.minimized/);
});
```
<!-- op:find test/panel-ui.test.js -->
Find in `test/panel-ui.test.js`:
```js
test('TornPDA/mobile recovery launcher is independent of minimized state and one-time runtime detection', () => {
  assert.match(source, /function isTornPdaNow\(\)/);
  assert.match(source, /Platform\.detectRuntime\(globalThis\)/);
  assert.match(source, /function isRecoveryLauncherContext\(\)/);
  assert.match(source, /pointer: coarse/);
  assert.match(source, /viewportWidth <= 900/);
  assert.match(source, /id = 'rr-pda-launcher'/);
  assert.match(source, /document\.body\.appendChild\(pdaLauncher\)/);
  assert.match(source, /options\.forceVisible \|\| state\.minimized \|\| isRecoveryLauncherContext\(\)/);
  assert.doesNotMatch(source, /function syncPdaLauncher\([^)]*\) \{\s*if \(!platform\.runtime\.isTornPda/);
  assert.match(source, /z-index:2147483646!important/);
  assert.match(source, /env\(safe-area-inset-right,0px\)/);
  assert.match(source, /env\(safe-area-inset-bottom,0px\)/);
});
```
<!-- op:replace -->
Replace with:
```js
test('the 0.7.3 recovery launcher is gone: the pill and its launcher fallback are the only entry point', () => {
  assert.match(source, /function isTornPdaNow\(\)/);
  assert.match(source, /Platform\.detectRuntime\(globalThis\)/);
  assert.doesNotMatch(source, /rr-pda-launcher|function syncPdaLauncher|function isRecoveryLauncherContext/);
  assert.doesNotMatch(source, /setInterval\(/);
});
```
<!-- op:find test/requester-ui.test.js -->
Find in `test/requester-ui.test.js`:
```js
test('free requester configures Cash/Xanax preset and uses exact sidebar action', () => {
  assert.match(source, /ReviveRelay → Revive Me!/);
```
<!-- op:replace -->
Replace with:
```js
test('free requester configures Cash/Xanax preset and uses the panel request action', () => {
  assert.match(source, /Request certified revive/);
```
<!-- op:find test/requester-ui.test.js -->
Find in `test/requester-ui.test.js`:
```js
test('background polling updates live state without rebuilding Settings form controls', () => {
  assert.match(source, /function renderLiveState\(\)/);
  assert.match(source, /id=[\"']rr-invoice-status[\"'][^>]*>\$\{renderInvoice\(\)\}<\/div>/);
  const timers = source.match(/function startTimers\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*async function init/)?.[1] || '';
  assert.ok(timers.length > 0);
  assert.match(timers, /refreshActiveRequest\(\)\.then\(renderLiveState\)/);
  assert.match(timers, /refreshProState[\s\S]*?then\(renderLiveState\)/);
  assert.match(timers, /refreshReviverQueue\(\)\.then\(renderLiveState\)/);
  assert.match(timers, /refreshCurrentInvoice\(\)\.then\(renderLiveState\)/);
  assert.doesNotMatch(timers, /then\(renderAll\)/);
  assert.doesNotMatch(timers, /\) renderAll\(\)/);
});
```
<!-- op:replace -->
Replace with:
```js
test('state-driven panel refresh updates live state without rebuilding Settings form controls', () => {
  assert.match(source, /function renderLiveState\(\)/);
  assert.match(source, /id=[\"']rr-invoice-status[\"'][^>]*>\$\{renderInvoice\(\)\}<\/div>/);
  const refresh = source.match(/function refreshPanelData\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
  const onRender = source.match(/function handlePillRender\(\{ snapshot \}\)\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(refresh.length > 0);
  assert.ok(onRender.length > 0);
  assert.match(refresh, /await restoreSession\(\)/);
  assert.match(refresh, /refreshCurrentInvoice\(\)/);
  assert.match(refresh, /renderLiveState\(\)/);
  assert.match(onRender, /refreshPanelData\(\)/);
  assert.match(onRender, /renderLiveState\(\)/);
  for (const body of [refresh, onRender]) assert.doesNotMatch(body, /renderAll\(\)|renderSettingsDrawer\(\)/);
});
```
<!-- op:find test/requester-ui.test.js -->
Find in `test/requester-ui.test.js`:
```js
test('opening Settings from the header gear restores the entire minimized panel before showing the drawer', () => {
  const toggle = source.match(/function toggleSettingsDrawer\(\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
  assert.ok(toggle.length > 0);
  assert.match(toggle, /state\.minimized/);
  assert.match(toggle, /storage\.set\(KEYS\.minimized/);
  assert.match(toggle, /panel\.style\.display/);
  assert.doesNotMatch(toggle, /body\.style\.display/);
});
```
<!-- op:replace -->
Replace with:
```js
test('opening Settings from the header gear restores the entire minimized panel before showing the drawer', () => {
  const toggle = source.match(/function toggleSettingsDrawer\(\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
  const open = source.match(/function setPanelOpen\(open\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
  assert.ok(toggle.length > 0);
  assert.match(toggle, /if \(opening && state\.minimized\) setPanelOpen\(true\)/);
  assert.match(open, /panel\.style\.display/);
  assert.doesNotMatch(toggle, /body\.style\.display/);
});
```
<!-- op:find test/review-release-smoke.test.js -->
Find in `test/review-release-smoke.test.js`:
```js
 assert.match(text,/createSidebarController/);
```
<!-- op:replace -->
Replace with:
```js
 assert.match(text,/createLiteBoot/);
 assert.doesNotMatch(text,/createSidebarController/);
```
<!-- op:find test/reviver-marketplace-ui.test.js -->
Find in `test/reviver-marketplace-ui.test.js`:
```js
test('queue controls are not destroyed by the one-second transaction clock', () => {
  const start = source.indexOf('clockTimer = setInterval(() => {');
  const end = source.indexOf('}, 1000);', start);
  const clock = start >= 0 && end > start ? source.slice(start, end) : '';
  assert.ok(clock.length > 0);
  assert.match(clock, /state\.activeTransaction/);
  assert.doesNotMatch(clock, /state\.reviverQueue\.length/);
});
```
<!-- op:replace -->
Replace with:
```js
test('queue controls are not destroyed by the one-second transaction clock', () => {
  // The engine's 1 s tick (while the panel is open) re-renders only for an active transaction.
  const clock = source.match(/function handlePillRender\(\{ snapshot \}\)\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(clock.length > 0);
  assert.match(clock, /else if \(state\.activeTransaction\) \{\s*renderLiveState\(\);/);
  assert.doesNotMatch(clock, /state\.reviverQueue\.length/);
});
```
<!-- op:find test/update-ui.test.js -->
Find in `test/update-ui.test.js`:
```js
test('userscript schedules a persisted 12-hour update check while Torn stays open', () => {
  const source=fs.readFileSync('torn-revive-chat-collector.user.js','utf8');
  assert.match(source,/let updateTimer = null;/);
  assert.match(source,/updateTimer = setInterval\(\(\) => \{[\s\S]*?checkUpdates\(false\)[\s\S]*?\}, UpdateManager\.UPDATE_CHECK_MS\);/);
  assert.match(source,/checkUpdates\(false\)\.catch\(error => captureClientError\(error, 'update\.initial'\)\)/);
});
```
<!-- op:replace -->
Replace with:
```js
test('userscript checks for updates once per page load, throttled to 12 hours by the update manager', () => {
  const source=fs.readFileSync('torn-revive-chat-collector.user.js','utf8');
  assert.doesNotMatch(source,/updateTimer|setInterval\(/);
  assert.match(source,/checkUpdates\(false\)\.catch\(error => captureClientError\(error, 'update\.initial'\)\)/);
  assert.equal(require('../src/update-manager').UPDATE_CHECK_MS,43_200_000);
});
```
<!-- op:find test/bootstrap-controls.test.js -->
Find in `test/bootstrap-controls.test.js`:
```js
  assert.match(source, /@run-at\s+document-idle/);
  assert.match(source, /ReviveRelay → Revive Me!/);
```
<!-- op:replace -->
Replace with:
```js
  assert.match(source, /@run-at\s+document-idle/);
  assert.match(source, /Request certified revive/);
```
<!-- op:find test/panel-ui.test.js -->
Find in `test/panel-ui.test.js`:
```js
  assert.doesNotMatch(source, /id=["']rr-request-form["']/);
  assert.match(source, /ReviveRelay → Revive Me!/);
```
<!-- op:replace -->
Replace with:
```js
  assert.doesNotMatch(source, /id=["']rr-request-form["']/);
  assert.match(source, /id=["']rr-request-revive["']/);
```
- [ ] **Step 6: Run the client suite**

Run: `npm run test:client 2>&1 | grep -E '^# (pass|fail)|^not ok'`
Expected: `# pass 560`, `# fail 0` (585 − 25 retired tests).

- [ ] **Step 7: Commit**
```bash
git add -A torn-revive-chat-collector.user.js scripts/client-modules.js src test
git commit -m "feat: ReviveRelay 1.0 entry point (Lite boot, pill opens the panel, no intervals)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 9: Size gate on the real built bundle

Measured on the dry run of this plan (bytes, 1 KB = 1000 B):

| Part | Bytes |
| --- | --- |
| Whole 1.0.0 bundle | 229,922 (0.7.3: 172,402) |
| Legacy panel = MAIN IIFE 95,545 + `core.js`, `update-manager.js`, `telemetry-client.js`, `request-preset.js` blocks 25,339 | 120,884 |
| Lite core = header + `platform.js` 15,378 + `direct-api-client.js` 11,877 + `versioning.js` 1,026 + `src/lite/*` 79,837 | 109,038 |

Reductions already taken (measured): sidebar action −15.2 KB; MAIN intervals, launcher, sidebar wiring and resume refresh −6.6 KB. Rejected: build-time comment stripping (only ~4.8 KB, and it would break byte-identical bundling and pinned-dependency verification). The whole bundle cannot reach 110 KB while the owner's staged decision keeps the 0.7 panel (121 KB on its own). So the gate enforces the spec budget on the Lite core and a ratchet ceiling on the whole bundle; Plan 3b deletes the panel and must move the 110 KB gate onto the whole file. The Lite core has under 1 KB of headroom: 3b's sheets need room made first (see the comment in the test).

**Files:**
- Modify: `scripts/client-modules.js` (full replacement: adds `LEGACY_PANEL_MODULES`)
- Modify: `test/direct-only-build.test.js` (full replacement)
- Create: `test/bundle-size.test.js`

**Interfaces:**
- Produces: `LEGACY_PANEL_MODULES = ['src/core.js', 'src/update-manager.js', 'src/telemetry-client.js', 'src/request-preset.js']` exported from `scripts/client-modules.js`.

- [ ] **Step 1: Write the failing tests**
<!-- op:file test/bundle-size.test.js -->
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECT_SUPPORT_MODULES, LEGACY_PANEL_MODULES } = require('../scripts/client-modules');

// Spec "Performance budgets": bundled userscript ≤ 110 KB unminified (1 KB = 1000 bytes, as in
// the spec's "172 KB" for the 172,402-byte 0.7.3 build). Plan 3a ships the legacy 0.7 panel
// beside the Lite engine (owner decision "Staged: core first"), so the 110 KB budget gates the
// Lite core: the whole bundle minus the legacy panel (MAIN's IIFE and LEGACY_PANEL_MODULES).
// The whole bundle is held to a ratchet ceiling until Plan 3b deletes the panel and moves the
// 110 KB budget onto the whole file.
const LITE_CORE_BUDGET_BYTES = 110000;
const WHOLE_BUNDLE_CEILING_BYTES = 232000;

const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const artifact = fs.readFileSync(path.join(root, 'dist', 'review', `ReviveRelay-${version}.user.js`));
const text = artifact.toString('utf8');

function bundledBlockBytes(relativePath) {
  const start = text.indexOf(`/* ReviveRelay bundled module: ${relativePath} */`);
  const endMarker = `/* ReviveRelay end bundled module: ${relativePath} */`;
  const end = text.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, relativePath);
  return Buffer.byteLength(text.slice(start, end + endMarker.length));
}

function mainBodyBytes() {
  const lastEnd = `/* ReviveRelay end bundled module: ${DIRECT_SUPPORT_MODULES[DIRECT_SUPPORT_MODULES.length - 1]} */`;
  const index = text.indexOf(lastEnd);
  assert.ok(index > 0);
  return Buffer.byteLength(text.slice(index + lastEnd.length));
}

function report() {
  const whole = artifact.length;
  const legacyPanel = mainBodyBytes() + LEGACY_PANEL_MODULES.reduce((sum, modulePath) => sum + bundledBlockBytes(modulePath), 0);
  return { whole, legacyPanel, liteCore: whole - legacyPanel };
}

test('the Lite core of the real built bundle fits the 110 KB unminified budget', () => {
  const sizes = report();
  assert.ok(sizes.liteCore <= LITE_CORE_BUDGET_BYTES, `Lite core ${sizes.liteCore} bytes > ${LITE_CORE_BUDGET_BYTES} (${JSON.stringify(sizes)})`);
});

test('the whole 1.0 bundle stays under the Plan 3a ratchet ceiling', () => {
  const sizes = report();
  assert.ok(sizes.whole <= WHOLE_BUNDLE_CEILING_BYTES, `bundle ${sizes.whole} bytes > ${WHOLE_BUNDLE_CEILING_BYTES} (${JSON.stringify(sizes)})`);
});

test('the bundle is unminified: bundled modules keep their source bytes and MAIN keeps its line structure', () => {
  for (const modulePath of DIRECT_SUPPORT_MODULES) {
    const source = fs.readFileSync(path.join(root, modulePath), 'utf8');
    assert.ok(text.includes(source), modulePath);
  }
  const longest = Math.max(...text.split('\n').map(line => line.length));
  assert.ok(longest < 4000, `longest line ${longest}`);
});

```
Replace the whole of `test/direct-only-build.test.js` with:
<!-- op:file test/direct-only-build.test.js -->
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES, LEGACY_PANEL_MODULES } = require('../scripts/client-modules');

const REQUIRED = [
  'src/platform.js',
  'src/core.js',
  'src/direct-api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js',
  'src/lite/boot.js'
];

const FORBIDDEN = [
  'src/api-client.js',
  'src/chat-dom.js',
  'src/public-channels.js',
  'src/client-chat-policy.js',
  'src/revive-classifier.js',
  'src/candidate-pipeline.js',
  'src/sidebar-action.js'
];

function bundledMarker(relativePath) {
  return `/* ReviveRelay bundled module: ${relativePath} */`;
}

test('canonical direct module inventory is exact and immutable', () => {
  assert.deepEqual([...DIRECT_SUPPORT_MODULES], REQUIRED);
  assert.equal(Object.isFrozen(DIRECT_SUPPORT_MODULES), true);
  assert.deepEqual([...LITE_ENGINE_MODULES], REQUIRED.filter(modulePath => modulePath.startsWith('src/lite/')));
  assert.deepEqual([...LEGACY_PANEL_MODULES], ['src/core.js', 'src/update-manager.js', 'src/telemetry-client.js', 'src/request-preset.js']);
  for (const modulePath of LEGACY_PANEL_MODULES) assert.ok(DIRECT_SUPPORT_MODULES.includes(modulePath), modulePath);
});

test('the Lite state client loads after the direct API client and versioning it depends on', () => {
  const index = modulePath => DIRECT_SUPPORT_MODULES.indexOf(modulePath);
  assert.ok(index('src/direct-api-client.js') < index('src/lite/state-client.js'));
  assert.ok(index('src/versioning.js') < index('src/lite/state-client.js'));
  assert.ok(index('src/lite/engine.js') < index('src/lite/boot.js'));
});

test('main bootstrap consumes the exact core and Lite boot globals', () => {
  const coreSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'core.js'), 'utf8');
  const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

  assert.match(coreSource, /root\.TornReviveCore\s*=\s*api/);
  assert.match(mainSource, /const Core = globalThis\.TornReviveCore;/);
  assert.match(mainSource, /const LiteBoot = globalThis\.ReviveRelayLiteBoot;/);
  assert.doesNotMatch(mainSource, /TornReviveChatCollectorCore|ReviveRelaySidebarAction/);
});

test('current review bundle contains direct support exactly once and zero legacy chat/candidate/sidebar modules', () => {
  const version = require('../package.json').version;
  const filename = `review/ReviveRelay-${version}.user.js`;
  const built = fs.readFileSync(path.resolve(__dirname, '..', 'dist', filename), 'utf8');
  for (const modulePath of REQUIRED) {
    assert.equal(built.split(bundledMarker(modulePath)).length - 1, 1, `${filename}: ${modulePath}`);
  }
  for (const modulePath of FORBIDDEN) {
    assert.equal(built.includes(bundledMarker(modulePath)), false, `${filename}: ${modulePath}`);
  }
  assert.doesNotMatch(built, /\/v1\/candidates|Shared public chat requests|Live Capture|Rescan public chats/);
  assert.doesNotMatch(built, /ReviveRelayApiClient|ReviveRelayProClient|createProClient|submitCandidate|drainCandidateOutbox|createOutboxEntry/);
  assert.doesNotMatch(built, /createSidebarController|ReviveRelay → Revive Me!/);
  assert.match(built, /ReviveRelayDirectApiClient/);
  assert.match(built, /ReviveRelayLiteBoot/);
  assert.match(built, /Request certified revive/);
  assert.match(built, /const UPDATE_CHANNEL = 'review'/);
});

test('ReviveRelay 1.0 is versioned 1.0.0', () => {
  assert.equal(require('../package.json').version, '1.0.0');
});

```
- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build && node --test test/bundle-size.test.js test/direct-only-build.test.js`
Expected: FAIL (`LEGACY_PANEL_MODULES` is `undefined`: `TypeError: LEGACY_PANEL_MODULES.reduce is not a function` / `is not iterable`).

- [ ] **Step 3: Declare the legacy panel modules**

Replace the whole of `scripts/client-modules.js` with:
<!-- op:file scripts/client-modules.js -->
```js
'use strict';

// ReviveRelay 1.0 Lite engine, in load order. pill-state → scheduler → snapshot-cache →
// tab-leader → state-client → icons → tokens → pill-view → engine → boot.
const LITE_ENGINE_MODULES = Object.freeze([
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js',
  'src/lite/boot.js'
]);

// Support modules used only by the legacy 0.7 panel (settings, updates, diagnostics, preset).
// Plan 3b replaces the panel; until then they are measured apart from the Lite core budget.
const LEGACY_PANEL_MODULES = Object.freeze([
  'src/core.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js'
]);

// Bundle order: direct-api-client and versioning load before the Lite state client.
const DIRECT_SUPPORT_MODULES = Object.freeze([
  'src/platform.js',
  'src/core.js',
  'src/direct-api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  ...LITE_ENGINE_MODULES
]);

module.exports = { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES, LEGACY_PANEL_MODULES };

```
- [ ] **Step 4: Run the gate and the suite**

Run: `node --test test/bundle-size.test.js test/direct-only-build.test.js`
Expected: `# pass 8`, `# fail 0`.

Print the measured sizes (they must match the table above unless code changed):

```bash
node -e "const fs=require('fs');const m=require('./scripts/client-modules');const t=fs.readFileSync('dist/review/ReviveRelay-1.0.0.user.js','utf8');const b=p=>{const s=t.indexOf('/* ReviveRelay bundled module: '+p+' */');const e='/* ReviveRelay end bundled module: '+p+' */';return Buffer.byteLength(t.slice(s,t.indexOf(e,s)+e.length));};const last='/* ReviveRelay end bundled module: '+m.DIRECT_SUPPORT_MODULES.at(-1)+' */';const main=Buffer.byteLength(t.slice(t.indexOf(last)+last.length));const whole=Buffer.byteLength(t);const legacy=main+m.LEGACY_PANEL_MODULES.reduce((a,p)=>a+b(p),0);console.log({whole,legacy,liteCore:whole-legacy})"
```
Expected: `{ whole: 229922, legacy: 120884, liteCore: 109038 }`.

Run: `npm run test:client 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 563`, `# fail 0`.

- [ ] **Step 5: Commit**
```bash
git add scripts/client-modules.js test/bundle-size.test.js test/direct-only-build.test.js
git commit -m "test: gate the Lite core at 110 KB and ratchet the whole 1.0 bundle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 10: Changelog and the re-pinned 1.0.0 review manifest

The release scripts expect `docs/review/BUILD-MANIFEST.json` to pin the current version: `scripts/build.js` reproduces a pinned build from `artifactSourceCommit` + `buildTimestamp`, and `scripts/verify-review-artifact.js` checks version, artifact path, SHA-256, size, URLs and provenance. Pin last: any later change to bundled source or MAIN invalidates the SHA-256 and needs a re-pin.

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `test/review-package.test.js` (new guard test)
- Modify: `docs/review/BUILD-MANIFEST.json` (generated)

**Interfaces:** none.

- [ ] **Step 1: Write the failing guard test**

Append to `test/review-package.test.js`:
<!-- op:append test/review-package.test.js -->
```js

test('the pinned build manifest pins the current package version',()=>{
  const manifest=JSON.parse(read('docs/review/BUILD-MANIFEST.json'));
  assert.equal(manifest.version,pkg.version,'re-pin docs/review/BUILD-MANIFEST.json after every version bump');
  assert.equal(manifest.artifact,`dist/review/ReviveRelay-${pkg.version}.user.js`);
});

```
Run: `node --test test/review-package.test.js`
Expected: `# pass 5`, `# fail 1` (`'0.7.3' !== '1.0.0'`).

- [ ] **Step 2: Add the changelog entry**
<!-- op:find CHANGELOG.md -->
Find in `CHANGELOG.md`:
```markdown
# Changelog

```
<!-- op:replace -->
Replace with:
```markdown
# Changelog

## 1.0.0 - Lite engine and header pill (review)

### Changed

- ReviveRelay now lives in one pill in Torn's header (launcher position when the header slot is missing). It shows where your revive is: Revive me · n online, Waiting, Pay <reviver>, <reviver> is reviving, Revived, Refunded, Needs attention, and for revivers Queue · n or the transaction that needs them.
- One scheduler per tab replaces the nine 0.7 timers. Only one tab per browser polls the new `/v1/state` endpoint; hidden tabs make no requests. Polling adapts: 60 s idle, 20 s for revivers, 5 s with an open request or transaction, with back-off when offline.
- The last known state paints instantly from cache (marked as syncing) and is never shown for a different Torn account.
- An expired session shows "Sign in again" and stops polling until you reconnect.
- The existing panel (requests, reviver queue, Torn API key, Reviver Pro, invoices, settings, diagnostics, account deletion) opens from the pill and no longer polls on its own. The Request tab has a **Request certified revive** button; the left-sidebar "ReviveRelay → Revive Me!" action and the 0.7.3 `RR` launcher are removed.

### Server

- `/v1/state` adds `recentlyClosed` (outcomes for 30 s, reportable failures for 1 hour) and `serverTime`.

### Release status

1.0.0 is a Beta/Review candidate on the review channel. Stable remains 0.4.4; 0.7.3 remains the rollback.

```
- [ ] **Step 3: Commit the source that the manifest will pin**
```bash
git add CHANGELOG.md test/review-package.test.js
git commit -m "docs: ReviveRelay 1.0.0 changelog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
- [ ] **Step 4: Build from that commit and write the manifest**

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
Expected: the build prints `Built immutable ReviveRelay 1.0.0 review artifact at <HEAD>`; the manifest shows `version: '1.0.0'`, `artifactSourceCommit` = `git rev-parse HEAD`, `sizeBytes: 229922`.

- [ ] **Step 5: Commit the manifest and verify the pinned reproduction**
```bash
git add docs/review/BUILD-MANIFEST.json
git commit -m "release: pin the ReviveRelay 1.0.0 review artifact" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Run: `npm run build && node scripts/verify-review-artifact.js && npm run audit:review`
Expected: `Built immutable ReviveRelay 1.0.0 review artifact at <pinned commit> (reproduced from pinned manifest)`, then `"ok": true` with `"sizeBytes": 229922`, then the audit's `"ok": true` with `"findings": []`.

- [ ] **Step 6: Run everything**

Run: `npm run test:client 2>&1 | grep -E '^# (pass|fail)'` and `(cd server && npm test 2>&1 | grep -E '^# (pass|fail)')`
Expected: client `# pass 564`, `# fail 0`; server `# pass 407`, `# fail 0`.

Run: `node --check dist/review/ReviveRelay-1.0.0.user.js && echo ok`
Expected: `ok`.

---

## Real-browser checks before review users (not automatable here; record results in the PR)

These come from the Plan 2 review; fakes cannot prove them. Do them on the review channel build from Task 10.

1. Pill mounts in Torn's header (closed shadow DOM, `HEADER_SLOT_SELECTORS`) on desktop light and dark, and falls back to the launcher position when the slot is missing; it re-places after SPA navigation.
2. Three tabs: exactly one sends `/v1/state` (DevTools network); closing or hiding it hands over within 5 s (Web Locks); BroadcastChannel delivers snapshots under Tampermonkey and Violentmonkey.
3. Request → pay → revived through the panel: the pill shows Waiting → Pay … → … is reviving → Revived for 5 s → Revive me.
4. TornPDA (Android): pill visible, panel opens, storage survives app restart (`reviverelay_state_snapshot_v1` migrated), no duplicate polling across PDA tabs.
5. Sign out / delete account / connect a different Torn account in one tab: no tab paints the previous account's state.

## Self-review notes

- Spec coverage: server `recentlyClosed`/`REPORTABLE_*` (Tasks 2–3); outcomes and 5 s fade from real data with clock skew (Tasks 4–5); 1.0.0 version and bundle load order (Task 7); real transport, GM/PDA storage incl. snapshot key and PDA migration, `isTornPda`, stable tab id, `pagehide`/BFCache/SPA re-placement and theme (Tasks 6, 8); nine intervals removed, update check on boot, pill opens the panel, panel no longer polls (Task 8); sessions/auth (Tasks 5, 8); size gate (Task 9); regex tests retired/rewritten (Task 8 table); manifest re-pin (Task 10). Deferred to 3b: sheets, badges UI and their GM-persisted LRU, notifications (leader-only, deduped) and sound, whole-bundle 110 KB.
- Names used across tasks: `listRecentlyClosedTransactionIdsForUser`, `RECENTLY_CLOSED_WINDOW_MS`, `SESSION_STATES`, `clockSkewMs`, `getSession`, `onRender`, `relayout`, `resetSession`, `createLiteBoot`, `RELAYOUT_DELAYS_MS`, `setPanelOpen`, `LEGACY_PANEL_MODULES`.
