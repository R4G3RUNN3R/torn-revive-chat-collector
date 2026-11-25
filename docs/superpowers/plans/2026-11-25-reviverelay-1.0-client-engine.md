# ReviveRelay 1.0 Client Engine Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ReviveRelay 1.0 "Lite" client engine as small, tested userscript modules: the pill state mapping, one scheduler per tab, tab leadership, the snapshot cache, the `/v1/state` client, the shadow-root header pill, and an engine that composes them with idempotent `start()`/`stop()`.

**Architecture:** Nine new UMD modules under `src/lite/`, each setting one `ReviveRelayLite…` global (same template as `src/direct-api-client.js`), each with its own `node:test` file that `require`s it directly. DOM-touching modules take an injected `document`/`window`; tests use small fakes in `test/helpers/` (no jsdom). The current entry point `torn-revive-chat-collector.user.js` (MAIN) is not modified and does not load the new modules; Plan 3 replaces MAIN with the 1.0 entry point and bundles them.

**Tech Stack:** Plain ES2020 userscript modules (UMD, no module system, no runtime `require`), Node 20 `node:test`, zero npm dependencies at the repository root.

**Plan series:** Plan 1 (server state, PR #17, branch `feat/reviverelay-1.0-server-state`) is the API contract. This is Plan 2. Plan 3 (client features: requester sheet, reviver queue, inline badges, notifications, settings/Pro, the 1.0 entry point replacing MAIN, the version bump, the performance harness and the release) builds on the engine delivered here.

**Branch:** a new branch `feat/reviverelay-1.0-client-engine` cut from `feat/reviverelay-1.0-server-state`, so `server/src/routes/state.js` and `server/src/routes/player-badge.js` are present while you work.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-25-reviverelay-1.0-lite-redesign-design.md` (sections "Experience design", "Engine architecture", "Performance budgets", "Decisions").
- The server is the source of truth: "unknown, pending, transport failure and stale cache are rendered as such, never as authoritative success or failure". The client never manufactures success.
- Single-actor invariant: "For one browser profile, at most one tab polls the server and at most one tab fires a given notification. Other tabs render shared state."
- Poll cadence (spec "One scheduler" table): tab hidden → none, zero work; visible idle (no request, not a reviver) → 60 s; requester with active request → 5 s, clock/UI tick 1 s "only while sheet or timer visible"; reviver with sheet open → 5 s, tick 1 s; reviver with sheet closed → 20 s; server `nextPollMs` → "honour it (bounded 3–120 s)"; transport failure → "exponential back-off 5 → 120 s with jitter".
- One timer per tab: "All recurring work goes through `core/scheduler.js`, one timer per tab" (in this plan: `src/lite/scheduler.js`).
- Tab leadership: Web Locks (`navigator.locks.request('rr-leader', ...)`) where available, otherwise a `BroadcastChannel` heartbeat election; snapshots broadcast on `BroadcastChannel('rr-state')`; "Leadership moves to a visible tab when the leader is hidden; if no tab is visible, nobody polls"; "TornPDA runs a single WebView, so it is always leader"; "closing or hiding the leader hands over within 5 s".
- Snapshot cache: GM storage key `reviverelay_state_snapshot_v1` (the spec's `rr:snapshot:v1`, renamed to the existing `reviverelay_*` key convention) holding `{stateVersion, fetchedAt, data}`; "entries older than 10 minutes render as stale, older than 24 hours are discarded"; "Cache never overrides a newer `stateVersion`" (implemented as: never replace a snapshot with an older `fetchedAt`, because `stateVersion` is a hash and has no order).
- Player badges: "cached per player for 10 minutes … (bounded at 200 entries, LRU)". This plan implements the in-memory LRU only.
- `/v1/state` contract (Plan 1): body `{ stateVersion, nextPollMs, me {tornId,name,roles,verification}, pro, activeRequest, activeTransactions[], revivers {online}, queue {count}|null }`; `ETag: "<stateVersion>"`; `304` with no body on a matching `If-None-Match`. The transport exposes no response headers, so the client builds `If-None-Match` from the last body's `stateVersion`.
- Requests use the same headers as `src/direct-api-client.js`: `Accept: application/json`, `X-ReviveRelay-Version`, `X-ReviveRelay-Channel`, `Authorization: Bearer <token>`; errors go through its `mapHttpError`/`DirectApiClientError`.
- Visual tokens: accent "ReviveRelay red `#a4161a`"; "Red is the brand only: error and 'needs attention' states use orange plus an alert icon"; dark mode uses "a lightened red tuned for contrast"; status tones `neutral | waiting | action | progress | success | attention`; motion "120–250 ms opacity/transform transitions only … everything respects `prefers-reduced-motion`"; "a bundled set of about 16 inline SVG icons (heartbeat, clock, plane, user-check, check, alert, refund, settings, close, chevron, bell, bolt, shield, cash, pill, external), 16/20 px, `currentColor`"; theme "detected from Torn's body class, falling back to `prefers-color-scheme`".
- Rendering: "One shadow root per page holds all ReviveRelay UI"; "No `innerHTML` with server or player data; text goes through `textContent`". This plan uses no `innerHTML` at all (icons are built with `createElementNS` from static path data), which also keeps `npm run audit:review` clean.
- Performance budgets (acceptance gates): bundled userscript ≤ 110 KB unminified; boot to pill painted from cache ≤ 50 ms desktop, ≤ 150 ms mid-range Android in TornPDA; no main-thread long task > 50 ms; hidden tab 0 network requests, 0 timers firing; visible idle tab ≤ 1 request per minute per browser profile; active request ≤ 12 requests per minute per browser profile; collapsed UI DOM ≤ 30 nodes; duplicate notifications across tabs 0.
- Module rules: every new file is a UMD IIFE setting exactly ONE global prefixed `ReviveRelayLite`, `'use strict'` inside, no top-level leakage, no runtime `require` in the bundle (resolve siblings lazily from `globalThis`, falling back to `require` only under Node, as `direct-api-client.js` does for `versioning`). Do not create `src/core/` (`src/core.js` exists and owns `TornReviveCore`). Do not reuse legacy globals (`ReviveRelayApiClient`, `ReviveRelayProClient`, `createProClient`, `submitCandidate`).
- No new npm dependencies (no jsdom). No `eval`, `new Function`, `fetch`, `localStorage`, `@require`.
- MAIN (`torn-revive-chat-collector.user.js`) is not modified. The pinned 0.7.3 review artifact (`docs/review/BUILD-MANIFEST.json`) must stay byte-identical: the new modules are listed in a separate `LITE_ENGINE_MODULES` inventory and are NOT added to `DIRECT_SUPPORT_MODULES` in this plan (see Task 9 for why).
- Every existing test keeps passing. Client tests run from the repository root: one file with `node --test test/<file>`, the whole client suite with `npm run build && node --test test`. The root has no dependencies to install.
- Code style: two-space indent, single quotes, semicolons, CommonJS tests with `node:test` and `node:assert/strict`.
- Commit after every task. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Setup (once, before Task 1)

```bash
git fetch origin
git switch -c feat/reviverelay-1.0-client-engine origin/feat/reviverelay-1.0-server-state
npm run build && node --test test
```

Expected: the build prints `Built immutable ReviveRelay 0.7.3 review artifact at e661af8a… (reproduced from pinned manifest)` and the suite ends with `# pass 316` / `# fail 0`.

Record the server baseline as well (the server suite is not touched by this plan; it needs PostgreSQL):

```bash
(cd server && npm install)
docker run -d --rm --name rr-plan2-testdb -e POSTGRES_PASSWORD=test -p 127.0.0.1:55441:5432 postgres:16-alpine
export TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55441/postgres
(cd server && npm test) 2>&1 | grep -E '^# (tests|pass|fail)'
```

Expected on 2026-11-25: `# tests 401`, `# pass 399`, `# fail 2`. The two failures are the `admin-pro` route tests (`manual revoke exposes REVOKED Pro state…`, `full refund preserves paid invoice/evidence…`), whose fixture dates are in the past; they fail before this plan starts. Write the numbers down; Task 9 compares against them.

## File Structure

| File | Responsibility |
| --- | --- |
| Create `src/lite/pill-state.js` | Pure `derivePill(snapshot, freshness, now)` → pill view model (requester table, reviver mapping, idle pills, freshness overrides) |
| Create `src/lite/scheduler.js` | One-timer-per-tab job scheduler, cadence table (`pollDelayMs`), `nextPollMs` bounds, exponential back-off with jitter |
| Create `src/lite/snapshot-cache.js` | `reviverelay_state_snapshot_v1` read/write with 10 min stale / 24 h discard and no older-overwrites-newer |
| Create `src/lite/tab-leader.js` | Single-actor leadership (Web Locks, BroadcastChannel heartbeat fallback, solo on TornPDA) and the `rr-state` broadcast |
| Create `src/lite/state-client.js` | `GET /v1/state` with `If-None-Match`, 304 handling, error mapping; `getPlayerBadge` with a 200-entry, 10-minute LRU |
| Create `src/lite/icons.js` | The 16 bundled icons as static path data, as SVG strings and as DOM nodes |
| Create `src/lite/tokens.js` | Design tokens CSS (light/dark, tones, motion) as a string constant |
| Create `src/lite/pill-view.js` | One closed shadow-root host, header-slot mount with launcher fallback, patch-only `update(viewModel)`, `destroy()` |
| Create `src/lite/engine.js` | `createLiteEngine(...)`: cache paint → leadership → leader polls and broadcasts → followers render; idempotent `start()/stop()` |
| Modify `scripts/client-modules.js` | Export `LITE_ENGINE_MODULES` (not bundled yet) |
| Create `test/helpers/fake-timers.js` | Deterministic clock and `setTimeout` |
| Create `test/helpers/fake-tabs.js` | In-memory `BroadcastChannel` hub, Web Locks manager, `AbortController` |
| Create `test/helpers/fake-dom.js` | Minimal DOM: elements, shadow roots, text, attributes, classList, dataset, events, simple `querySelector` |
| Create `test/lite-*.test.js` | One test file per module plus `test/lite-bundle.test.js` for the inventory and a no-`require` bundle smoke test |

Note: `node --test test` also loads the three files in `test/helpers/`; each is reported as one passing (empty) test file. The suite totals below include them.

---

### Task 1: Pill state mapping (`src/lite/pill-state.js`)

**Files:**
- Create: `src/lite/pill-state.js`
- Test: `test/lite-pill-state.test.js`

**Interfaces:**
- Consumes: the Plan 1 `/v1/state` body. Transactions carry `id`, `state`, `participantRole` (`'requester' | 'reviver'`), `createdAt`, `updatedAt`, `closedAt`, `paymentDeadline`, `reviveDeadline`, `retryResponseDeadline`, `refundDeadline`, `requester {tornId,name}`, `reviver {tornId,name}` (`server/src/db/transactions.js#getTransactionForUser`).
- Produces (global `ReviveRelayLitePillState`):
  - `derivePill(snapshot: object|null, freshness: 'live'|'syncing'|'offline', now: number) → Readonly<ViewModel>` where `ViewModel = { role: 'requester'|'reviver'|'none', state: string|null, transactionId: string|null, label: string, detail: string, text: string, tone: Tone, icon: IconName, sheet: string, timer: {kind:'countdown'|'elapsed', at:number}|null, refreshAt: number|null, syncing: boolean, offline: boolean }`. `text` is `label` or `` `${label} · ${detail}` ``.
  - `TONES = ['neutral','waiting','action','progress','success','attention']`, `FRESHNESS = ['live','syncing','offline']`, `TRANSACTION_STATES` (all 16), `COMPLETED_FADE_MS = 5000`, `formatDuration(ms) → 'm:ss' | 'h:mm:ss'`, `nearestDeadlineMs(tx) → number|null`.

Mapping decisions this task locks in (from the spec tables):
- Priority: an open requester-side transaction drives the pill, then `activeRequest`, then reviver-side transactions (nearest deadline first, closed states skipped), then the idle pill.
- Requester idle: `Revive me · n online` (n hidden at 0 or unknown); no usable requester credential → `Set up revives` (the spec's "warning" maps to tone `attention`, orange).
- Reviver idle (role `reviver`): `Queue · n` only when `queue` is non-null; else `Pro expired` (Pro `EXPIRED`/`REVOKED`) or `Reviver setup`.
- `COMPLETED` shows `Revived` and fades back to idle 5 s after `closedAt` (`refreshAt` tells the engine when to re-render).
- Freshness: `syncing` keeps the label, sets `syncing: true`; `offline` shows `Offline · retrying`; neither ever shows `success` or `attention` (those become `neutral`).

- [ ] **Step 1: Write the failing test**

`test/lite-pill-state.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TONES,
  FRESHNESS,
  TRANSACTION_STATES,
  derivePill,
  formatDuration
} = require('../src/lite/pill-state');

const NOW = Date.parse('2026-11-25T12:00:00.000Z');
const iso = offsetMs => new Date(NOW + offsetMs).toISOString();

function me(overrides = {}) {
  return {
    tornId: 1001,
    name: 'Patient',
    roles: ['requester'],
    verification: { usable: true, requester: true, reviver: false },
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    stateVersion: '0123456789abcdef',
    nextPollMs: 60000,
    me: me(),
    pro: { state: 'NONE', trialEligible: true, trialStartedAt: null, validUntil: null },
    activeRequest: null,
    activeTransactions: [],
    revivers: { online: 3 },
    queue: null,
    ...overrides
  };
}

function transaction(state, participantRole, overrides = {}) {
  return {
    id: `tx-${participantRole}-${state}`,
    state,
    participantRole,
    createdAt: iso(-120000),
    updatedAt: iso(-1000),
    closedAt: null,
    paymentDeadline: iso(90000),
    reviveDeadline: null,
    retryResponseDeadline: null,
    refundDeadline: null,
    requester: { tornId: 1001, name: 'Patient' },
    reviver: { tornId: 2002, name: 'Medic' },
    ...overrides
  };
}

// Expected live (authoritative) pill per state and role. null = this transaction does
// not drive the pill, so the idle pill ("Revive me · 3 online") shows instead.
const EXPECTED = {
  requester: {
    AVAILABLE: { label: 'Waiting', detail: '2:00', tone: 'waiting' },
    WAITING_FOR_PAYMENT: { label: 'Pay Medic', detail: '1:30 left', tone: 'action' },
    PAYMENT_RECONCILING: { label: 'Checking payment', detail: '', tone: 'waiting' },
    WAITING_FOR_REVIVE: { label: 'Medic is reviving', detail: '', tone: 'progress' },
    COMPLETED: { label: 'Revived', detail: '', tone: 'success' },
    FAILED_ATTEMPT_CHOICE: { label: 'Revive failed · choose', detail: '', tone: 'action' },
    RETRY_OFFERED: { label: 'Retry requested', detail: '', tone: 'waiting' },
    REFUND_REQUIRED: { label: 'Refund in progress', detail: '', tone: 'waiting' },
    REFUND_RECONCILING: { label: 'Refund in progress', detail: '', tone: 'waiting' },
    REFUNDED: { label: 'Refunded', detail: '', tone: 'success' },
    CANCELLED_BY_REQUESTER: null,
    PAYMENT_EXPIRED: null,
    CLOSED_REQUESTER_EXIT: null,
    CLOSED_NATURAL_EXPIRY: null,
    REPORTABLE_NO_ATTEMPT: { label: 'Needs attention', detail: '', tone: 'attention' },
    REPORTABLE_MISSING_REFUND: { label: 'Needs attention', detail: '', tone: 'attention' }
  },
  reviver: {
    AVAILABLE: null,
    WAITING_FOR_PAYMENT: { label: 'Awaiting payment', detail: '1:30 left', tone: 'waiting' },
    PAYMENT_RECONCILING: { label: 'Checking payment', detail: '', tone: 'waiting' },
    WAITING_FOR_REVIVE: { label: 'Revive Patient now', detail: '1:30 left', tone: 'action' },
    COMPLETED: { label: 'Revive complete', detail: '', tone: 'success' },
    FAILED_ATTEMPT_CHOICE: { label: 'Requester deciding', detail: '', tone: 'waiting' },
    RETRY_OFFERED: { label: 'Retry? Accept or decline', detail: '1:30 left', tone: 'action' },
    REFUND_REQUIRED: { label: 'Refund owed to Patient', detail: '1:30 left', tone: 'action' },
    REFUND_RECONCILING: { label: 'Checking refund', detail: '', tone: 'waiting' },
    REFUNDED: { label: 'Refund verified', detail: '', tone: 'success' },
    CANCELLED_BY_REQUESTER: null,
    PAYMENT_EXPIRED: null,
    CLOSED_REQUESTER_EXIT: null,
    CLOSED_NATURAL_EXPIRY: null,
    REPORTABLE_NO_ATTEMPT: { label: 'Needs attention', detail: '', tone: 'attention' },
    REPORTABLE_MISSING_REFUND: { label: 'Needs attention', detail: '', tone: 'attention' }
  }
};

const IDLE = { label: 'Revive me', detail: '3 online', tone: 'neutral' };

function deadlinesFor(state) {
  // Each state carries the one deadline the server sets for it, 90 s ahead.
  if (state === 'WAITING_FOR_REVIVE') return { paymentDeadline: null, reviveDeadline: iso(90000) };
  if (state === 'RETRY_OFFERED') return { paymentDeadline: null, retryResponseDeadline: iso(90000) };
  if (state === 'REFUND_REQUIRED') return { paymentDeadline: null, refundDeadline: iso(90000) };
  return {};
}

test('the state table covers all 16 server transaction states for both roles', () => {
  assert.equal(TRANSACTION_STATES.length, 16);
  for (const role of ['requester', 'reviver']) {
    assert.deepEqual(Object.keys(EXPECTED[role]).sort(), [...TRANSACTION_STATES].sort());
  }
});

for (const role of ['requester', 'reviver']) {
  for (const state of TRANSACTION_STATES) {
    for (const freshness of FRESHNESS) {
      test(`pill: ${role} × ${state} × ${freshness}`, () => {
        const snap = snapshot({
          me: role === 'reviver' ? me({ verification: { usable: true, requester: true, reviver: true } }) : me(),
          activeTransactions: [transaction(state, role, deadlinesFor(state))]
        });
        const view = derivePill(snap, freshness, NOW);
        const expected = EXPECTED[role][state] || IDLE;

        assert.ok(TONES.includes(view.tone), `tone ${view.tone}`);
        assert.equal(typeof view.text, 'string');
        assert.ok(view.text.length > 0);
        assert.equal(view.syncing, freshness === 'syncing');
        assert.equal(view.offline, freshness === 'offline');

        if (freshness === 'offline') {
          assert.equal(view.text, 'Offline · retrying');
          assert.equal(view.tone === 'success' || view.tone === 'attention', false);
          assert.equal(view.timer, null);
          return;
        }

        assert.equal(view.label, expected.label);
        assert.equal(view.detail, expected.detail);
        if (freshness === 'live') {
          assert.equal(view.tone, expected.tone);
        } else {
          const tone = expected.tone === 'success' || expected.tone === 'attention' ? 'neutral' : expected.tone;
          assert.equal(view.tone, tone);
        }
        if (EXPECTED[role][state]) {
          assert.equal(view.role, role);
          assert.equal(view.state, state);
          assert.equal(view.transactionId, `tx-${role}-${state}`);
        } else {
          assert.equal(view.state, null);
        }
      });
    }
  }
}

test('requester without an open transaction follows activeRequest (AVAILABLE counts up from createdAt)', () => {
  const view = derivePill(snapshot({
    activeRequest: { id: 'req-1', state: 'AVAILABLE', paymentMethod: 'cash', offerAmount: 1000000, createdAt: iso(-65000), transactionId: null }
  }), 'live', NOW);
  assert.equal(view.text, 'Waiting · 1:05');
  assert.equal(view.tone, 'waiting');
  assert.deepEqual(view.timer, { kind: 'elapsed', at: NOW - 65000 });
});

test('idle requester: "Revive me · n online", and n is hidden at 0 or unknown', () => {
  assert.equal(derivePill(snapshot(), 'live', NOW).text, 'Revive me · 3 online');
  assert.equal(derivePill(snapshot({ revivers: { online: 0 } }), 'live', NOW).text, 'Revive me');
  assert.equal(derivePill(snapshot({ revivers: { online: null } }), 'live', NOW).text, 'Revive me');
  assert.equal(derivePill(snapshot({ revivers: { online: 0 } }), 'live', NOW).sheet, 'request');
});

test('idle requester without a usable requester credential gets "Set up revives"', () => {
  for (const verification of [null, { usable: false, requester: true, reviver: false }, { usable: true, requester: false, reviver: false }]) {
    const view = derivePill(snapshot({ me: me({ verification }) }), 'live', NOW);
    assert.equal(view.text, 'Set up revives');
    assert.equal(view.tone, 'attention');
    assert.equal(view.sheet, 'requester-setup');
  }
});

test('idle reviver shows the queue count only when queue is non-null', () => {
  const reviver = me({ roles: ['requester', 'reviver'], verification: { usable: true, requester: true, reviver: true } });
  assert.equal(derivePill(snapshot({ me: reviver, queue: { count: 4 } }), 'live', NOW).text, 'Queue · 4');
  assert.equal(derivePill(snapshot({ me: reviver, queue: { count: 0 } }), 'live', NOW).text, 'Queue · 0');
  assert.equal(derivePill(snapshot({ me: reviver, queue: null }), 'live', NOW).text, 'Reviver setup');
  const expired = derivePill(snapshot({ me: reviver, queue: null, pro: { state: 'EXPIRED' } }), 'live', NOW);
  assert.equal(expired.text, 'Pro expired');
  assert.equal(expired.sheet, 'reviver-pro');
});

test('reviver holding several transactions: the nearest deadline drives the pill', () => {
  const view = derivePill(snapshot({
    me: me({ roles: ['reviver'] }),
    queue: { count: 9 },
    activeTransactions: [
      transaction('WAITING_FOR_PAYMENT', 'reviver', { id: 'late', paymentDeadline: iso(240000) }),
      transaction('WAITING_FOR_REVIVE', 'reviver', { id: 'soon', paymentDeadline: null, reviveDeadline: iso(30000) }),
      transaction('REFUND_RECONCILING', 'reviver', { id: 'none', paymentDeadline: null })
    ]
  }), 'live', NOW);
  assert.equal(view.transactionId, 'soon');
  assert.equal(view.text, 'Revive Patient now · 0:30 left');
});

test('a closed reviver transaction never hides the next open one', () => {
  const view = derivePill(snapshot({
    me: me({ roles: ['reviver'] }),
    activeTransactions: [
      transaction('PAYMENT_EXPIRED', 'reviver', { id: 'closed', paymentDeadline: iso(1000) }),
      transaction('WAITING_FOR_PAYMENT', 'reviver', { id: 'open', paymentDeadline: iso(61000) })
    ]
  }), 'live', NOW);
  assert.equal(view.transactionId, 'open');
  assert.equal(view.text, 'Awaiting payment · 1:01 left');
});

test('requester-side transactions take priority over reviver-side ones', () => {
  const view = derivePill(snapshot({
    me: me({ roles: ['requester', 'reviver'] }),
    activeTransactions: [
      transaction('WAITING_FOR_REVIVE', 'reviver', { id: 'as-reviver', paymentDeadline: null, reviveDeadline: iso(10000) }),
      transaction('WAITING_FOR_PAYMENT', 'requester', { id: 'as-requester', paymentDeadline: iso(80000) })
    ]
  }), 'live', NOW);
  assert.equal(view.transactionId, 'as-requester');
  assert.equal(view.role, 'requester');
});

test('COMPLETED fades back to idle 5 s after closing', () => {
  const recent = transaction('COMPLETED', 'requester', { closedAt: iso(-4000) });
  const old = transaction('COMPLETED', 'requester', { closedAt: iso(-5000) });
  const recentView = derivePill(snapshot({ activeTransactions: [recent] }), 'live', NOW);
  assert.equal(recentView.text, 'Revived');
  assert.equal(recentView.refreshAt, NOW + 1000);
  assert.equal(derivePill(snapshot({ activeTransactions: [old] }), 'live', NOW).text, 'Revive me · 3 online');
});

test('countdowns clamp at 0:00 and long durations show hours', () => {
  const view = derivePill(snapshot({ activeTransactions: [transaction('WAITING_FOR_PAYMENT', 'requester', { paymentDeadline: iso(-5000) })] }), 'live', NOW);
  assert.equal(view.detail, '0:00 left');
  assert.equal(formatDuration(3723000), '1:02:03');
  assert.equal(formatDuration(59999), '0:59');
});

test('no snapshot yet: neutral placeholder while syncing, "Offline · retrying" on failure', () => {
  const syncing = derivePill(null, 'syncing', NOW);
  assert.equal(syncing.text, 'ReviveRelay');
  assert.equal(syncing.syncing, true);
  assert.equal(syncing.sheet, 'loading');
  assert.equal(derivePill(null, 'offline', NOW).text, 'Offline · retrying');
});

test('unknown freshness is treated as syncing (never authoritative)', () => {
  const view = derivePill(snapshot({ activeTransactions: [transaction('REFUNDED', 'requester')] }), 'bogus', NOW);
  assert.equal(view.syncing, true);
  assert.equal(view.tone, 'neutral');
});

test('view models are frozen', () => {
  assert.equal(Object.isFrozen(derivePill(snapshot(), 'live', NOW)), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lite-pill-state.test.js`
Expected: FAIL with `Cannot find module '../src/lite/pill-state'`.

- [ ] **Step 3: Write the implementation**

`src/lite/pill-state.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLitePillState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TONES = Object.freeze(['neutral', 'waiting', 'action', 'progress', 'success', 'attention']);
  const FRESHNESS = Object.freeze(['live', 'syncing', 'offline']);
  const NON_AUTHORITATIVE_TONES = new Set(['success', 'attention']);
  const COMPLETED_FADE_MS = 5000;

  const TRANSACTION_STATES = Object.freeze([
    'AVAILABLE',
    'WAITING_FOR_PAYMENT',
    'PAYMENT_RECONCILING',
    'WAITING_FOR_REVIVE',
    'COMPLETED',
    'FAILED_ATTEMPT_CHOICE',
    'RETRY_OFFERED',
    'REFUND_REQUIRED',
    'REFUND_RECONCILING',
    'REFUNDED',
    'CANCELLED_BY_REQUESTER',
    'PAYMENT_EXPIRED',
    'CLOSED_REQUESTER_EXIT',
    'CLOSED_NATURAL_EXPIRY',
    'REPORTABLE_NO_ATTEMPT',
    'REPORTABLE_MISSING_REFUND'
  ]);

  const DEADLINE_FIELDS = Object.freeze(['paymentDeadline', 'reviveDeadline', 'retryResponseDeadline', 'refundDeadline']);

  function toMs(value) {
    if (value == null || value === '') return null;
    const ms = typeof value === 'number' ? value : new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const ss = String(seconds).padStart(2, '0');
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
    return `${minutes}:${ss}`;
  }

  function nearestDeadlineMs(transaction) {
    let nearest = null;
    for (const field of DEADLINE_FIELDS) {
      const ms = toMs(transaction && transaction[field]);
      if (ms !== null && (nearest === null || ms < nearest)) nearest = ms;
    }
    return nearest;
  }

  function personName(person, fallback) {
    const name = person && typeof person.name === 'string' ? person.name.trim() : '';
    return name || fallback;
  }

  function countdown(deadline) {
    const at = toMs(deadline);
    return at === null ? null : { kind: 'countdown', at };
  }

  function elapsed(since) {
    const at = toMs(since);
    return at === null ? null : { kind: 'elapsed', at };
  }

  function requesterMapping(state, source, now) {
    const reviver = personName(source && source.reviver, 'reviver');
    switch (state) {
      case 'AVAILABLE':
        return { label: 'Waiting', tone: 'waiting', icon: 'clock', sheet: 'request-waiting', timer: elapsed(source && source.createdAt) };
      case 'WAITING_FOR_PAYMENT':
        return { label: `Pay ${reviver}`, tone: 'action', icon: 'cash', sheet: 'request-pay', timer: countdown(source && source.paymentDeadline) };
      case 'PAYMENT_RECONCILING':
        return { label: 'Checking payment', tone: 'waiting', icon: 'clock', sheet: 'request-payment-check', timer: null };
      case 'WAITING_FOR_REVIVE':
        return { label: `${reviver} is reviving`, tone: 'progress', icon: 'heartbeat', sheet: 'request-reviving', timer: null };
      case 'COMPLETED': {
        const closedAt = toMs(source && (source.closedAt || source.updatedAt));
        if (closedAt !== null && now - closedAt >= COMPLETED_FADE_MS) return null;
        return { label: 'Revived', tone: 'success', icon: 'check', sheet: 'request-summary', timer: null, refreshAt: closedAt === null ? null : closedAt + COMPLETED_FADE_MS };
      }
      case 'FAILED_ATTEMPT_CHOICE':
        return { label: 'Revive failed · choose', tone: 'action', icon: 'alert', sheet: 'request-failed-choice', timer: null };
      case 'RETRY_OFFERED':
        return { label: 'Retry requested', tone: 'waiting', icon: 'clock', sheet: 'request-retry', timer: null };
      case 'REFUND_REQUIRED':
      case 'REFUND_RECONCILING':
        return { label: 'Refund in progress', tone: 'waiting', icon: 'refund', sheet: 'request-refund', timer: null };
      case 'REFUNDED':
        return { label: 'Refunded', tone: 'success', icon: 'check', sheet: 'request-summary', timer: null };
      case 'REPORTABLE_NO_ATTEMPT':
      case 'REPORTABLE_MISSING_REFUND':
        return { label: 'Needs attention', tone: 'attention', icon: 'alert', sheet: 'request-report', timer: null };
      default:
        return null;
    }
  }

  function reviverMapping(state, transaction, now) {
    const requester = personName(transaction && transaction.requester, 'requester');
    switch (state) {
      case 'WAITING_FOR_PAYMENT':
        return { label: 'Awaiting payment', tone: 'waiting', icon: 'cash', sheet: 'reviver-awaiting-payment', timer: countdown(transaction.paymentDeadline) };
      case 'PAYMENT_RECONCILING':
        return { label: 'Checking payment', tone: 'waiting', icon: 'clock', sheet: 'reviver-payment-check', timer: null };
      case 'WAITING_FOR_REVIVE':
        return { label: `Revive ${requester} now`, tone: 'action', icon: 'bolt', sheet: 'reviver-revive-now', timer: countdown(transaction.reviveDeadline) };
      case 'FAILED_ATTEMPT_CHOICE':
        return { label: 'Requester deciding', tone: 'waiting', icon: 'clock', sheet: 'reviver-failed-choice', timer: null };
      case 'RETRY_OFFERED':
        return { label: 'Retry? Accept or decline', tone: 'action', icon: 'heartbeat', sheet: 'reviver-retry', timer: countdown(transaction.retryResponseDeadline) };
      case 'REFUND_REQUIRED':
        return { label: `Refund owed to ${requester}`, tone: 'action', icon: 'refund', sheet: 'reviver-refund', timer: countdown(transaction.refundDeadline) };
      case 'REFUND_RECONCILING':
        return { label: 'Checking refund', tone: 'waiting', icon: 'refund', sheet: 'reviver-refund', timer: null };
      case 'COMPLETED': {
        const closedAt = toMs(transaction.closedAt || transaction.updatedAt);
        if (closedAt !== null && now - closedAt >= COMPLETED_FADE_MS) return null;
        return { label: 'Revive complete', tone: 'success', icon: 'check', sheet: 'reviver-summary', timer: null, refreshAt: closedAt === null ? null : closedAt + COMPLETED_FADE_MS };
      }
      case 'REFUNDED':
        return { label: 'Refund verified', tone: 'success', icon: 'check', sheet: 'reviver-summary', timer: null };
      case 'REPORTABLE_NO_ATTEMPT':
      case 'REPORTABLE_MISSING_REFUND':
        return { label: 'Needs attention', tone: 'attention', icon: 'alert', sheet: 'reviver-report', timer: null };
      default:
        return null;
    }
  }

  function sortedByDeadline(transactions) {
    return transactions
      .map((transaction, index) => ({ transaction, index, deadline: nearestDeadlineMs(transaction) }))
      .sort((a, b) => {
        if (a.deadline !== b.deadline) {
          if (a.deadline === null) return 1;
          if (b.deadline === null) return -1;
          return a.deadline - b.deadline;
        }
        return a.index - b.index;
      })
      .map(entry => entry.transaction);
  }

  function firstMapped(transactions, role, now) {
    const mapper = role === 'requester' ? requesterMapping : reviverMapping;
    for (const transaction of sortedByDeadline(transactions.filter(tx => tx && tx.participantRole === role))) {
      const mapped = mapper(transaction.state, transaction, now);
      if (mapped) return { mapped, transaction };
    }
    return null;
  }

  function hasRole(me, role) {
    return Boolean(me && Array.isArray(me.roles) && me.roles.includes(role));
  }

  function idleMapping(snapshot) {
    const me = snapshot.me || {};
    if (hasRole(me, 'reviver')) {
      if (snapshot.queue && Number.isFinite(Number(snapshot.queue.count))) {
        return { role: 'reviver', label: 'Queue', detail: String(Math.max(0, Math.floor(Number(snapshot.queue.count)))), tone: 'neutral', icon: 'heartbeat', sheet: 'reviver-queue' };
      }
      const proState = snapshot.pro && snapshot.pro.state;
      if (proState === 'EXPIRED' || proState === 'REVOKED') {
        return { role: 'reviver', label: 'Pro expired', detail: '', tone: 'attention', icon: 'shield', sheet: 'reviver-pro' };
      }
      return { role: 'reviver', label: 'Reviver setup', detail: '', tone: 'neutral', icon: 'settings', sheet: 'reviver-setup' };
    }
    const verification = me.verification;
    if (!verification || !verification.usable || !verification.requester) {
      return { role: 'requester', label: 'Set up revives', detail: '', tone: 'attention', icon: 'shield', sheet: 'requester-setup' };
    }
    const online = snapshot.revivers && Number.isFinite(Number(snapshot.revivers.online)) ? Math.max(0, Math.floor(Number(snapshot.revivers.online))) : 0;
    return { role: 'requester', label: 'Revive me', detail: online > 0 ? `${online} online` : '', tone: 'neutral', icon: 'heartbeat', sheet: 'request' };
  }

  function timerDetail(timer, now) {
    if (!timer) return '';
    if (timer.kind === 'countdown') return `${formatDuration(timer.at - now)} left`;
    return formatDuration(now - timer.at);
  }

  function baseView(snapshot, now) {
    if (!snapshot || typeof snapshot !== 'object') {
      return { role: 'none', state: null, transactionId: null, label: 'ReviveRelay', detail: '', tone: 'neutral', icon: 'pill', sheet: 'loading', timer: null, refreshAt: null };
    }
    const transactions = Array.isArray(snapshot.activeTransactions) ? snapshot.activeTransactions : [];
    const requester = firstMapped(transactions, 'requester', now);
    if (requester) return fromMapped('requester', requester.mapped, requester.transaction.state, requester.transaction.id, now);

    const request = snapshot.activeRequest;
    if (request && typeof request === 'object') {
      const mapped = requesterMapping(request.state, request, now);
      if (mapped) return fromMapped('requester', mapped, request.state, request.transactionId || null, now);
    }

    const reviver = firstMapped(transactions, 'reviver', now);
    if (reviver) return fromMapped('reviver', reviver.mapped, reviver.transaction.state, reviver.transaction.id, now);

    const idle = idleMapping(snapshot);
    return { ...idle, state: null, transactionId: null, timer: null, refreshAt: null };
  }

  function fromMapped(role, mapped, state, transactionId, now) {
    return {
      role,
      state,
      transactionId: transactionId == null ? null : String(transactionId),
      label: mapped.label,
      detail: timerDetail(mapped.timer, now),
      tone: mapped.tone,
      icon: mapped.icon,
      sheet: mapped.sheet,
      timer: mapped.timer,
      refreshAt: mapped.refreshAt == null ? null : mapped.refreshAt
    };
  }

  function derivePill(snapshot, freshness, now) {
    const mode = FRESHNESS.includes(freshness) ? freshness : 'syncing';
    const at = Number.isFinite(Number(now)) ? Number(now) : 0;
    const view = baseView(snapshot, at);
    view.syncing = mode === 'syncing';
    view.offline = mode === 'offline';
    if (mode !== 'live' && NON_AUTHORITATIVE_TONES.has(view.tone)) view.tone = 'neutral';
    if (mode === 'offline') {
      view.label = 'Offline';
      view.detail = 'retrying';
      view.icon = 'alert';
      view.timer = null;
      view.refreshAt = null;
    }
    view.text = view.detail ? `${view.label} · ${view.detail}` : view.label;
    return Object.freeze(view);
  }

  return Object.freeze({
    TONES,
    FRESHNESS,
    TRANSACTION_STATES,
    COMPLETED_FADE_MS,
    derivePill,
    formatDuration,
    nearestDeadlineMs
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/lite-pill-state.test.js`
Expected: `# tests 109`, `# pass 109`, `# fail 0` (96 state × role × freshness cases plus 13 focused tests).

- [ ] **Step 5: Commit**

```bash
git add src/lite/pill-state.js test/lite-pill-state.test.js
git commit -m "feat(lite): add table-driven header pill state mapping" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One scheduler per tab (`src/lite/scheduler.js`)

**Files:**
- Create: `src/lite/scheduler.js`
- Create: `test/helpers/fake-timers.js`
- Test: `test/lite-scheduler.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (global `ReviveRelayLiteScheduler`):
  - `createScheduler({ setTimeout, clearTimeout, now, random?, isHidden? }) → Scheduler` with
    - `addJob(name: string, { delay(ctx) → number|null, run(ctx) → void|Promise, runNow?: boolean })` — `ctx = { now, hidden, failures, lastRunAt }`; `null` delay means "not scheduled". The next due time is measured from the job's last run (or from when it was added).
    - `reschedule(name?)`, `trigger(name)` (run now, clears back-off), `removeJob(name)`, `onVisibilityChange()`, `start()`, `stop()`, `clear()` (stop and forget all jobs), `pendingTimers() → 0|1`, `dueAt(name)`, `failures(name)`.
    - A throwing/rejecting `run` increments `failures` and schedules the job after `backoffMs(failures)`; a success resets it. A job never overlaps itself.
  - `pollDelayMs({ hidden, nextPollMs, hasActive, isReviver, sheetOpen }) → number|null` (the cadence table; server value bounded 3–120 s wins, except that an open reviver sheet keeps 5 s unless the server asked for more than the normal 20 s reviver cadence).
  - `clampPollMs(value) → number|null`, `backoffMs(failures, random) → number` (5000 · 2^(n−1), ±20 % jitter, clamped to 5000–120000).
  - Constants `POLL_BOUNDS_MS {min:3000,max:120000}`, `BACKOFF_MS {min:5000,max:120000}`, `CADENCE_MS {IDLE:60000, ACTIVE:5000, REVIVER_SHEET_OPEN:5000, REVIVER:20000, TICK:1000}`.
- Test helper `test/helpers/fake-timers.js`: `createFakeTimers(startMs?) → { now(), setTimeout, clearTimeout, advance(ms): Promise, flush(): Promise, pending(), nextDelay() }`. `advance` flushes pending microtasks first, then fires due timers in order, flushing promises after each.

- [ ] **Step 1: Write the test helper and the failing test**

`test/helpers/fake-timers.js`:

```js
'use strict';

// Deterministic clock + setTimeout for ReviveRelay Lite tests. Only what the modules use.
function createFakeTimers(startMs = Date.parse('2026-11-25T12:00:00.000Z')) {
  let current = startMs;
  let nextId = 1;
  const timers = new Map();

  function setTimeout(callback, delay = 0) {
    const id = nextId++;
    timers.set(id, { callback, at: current + Math.max(0, Number(delay) || 0) });
    return id;
  }

  function clearTimeout(id) {
    timers.delete(id);
  }

  async function flush() {
    for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve));
  }

  async function advance(ms) {
    const target = current + ms;
    await flush();
    for (;;) {
      let nextTimer = null;
      for (const [id, timer] of timers) {
        if (timer.at <= target && (nextTimer === null || timer.at < nextTimer.at || (timer.at === nextTimer.at && id < nextTimer.id))) {
          nextTimer = { id, ...timer };
        }
      }
      if (!nextTimer) break;
      current = Math.max(current, nextTimer.at);
      timers.delete(nextTimer.id);
      nextTimer.callback();
      await flush();
    }
    current = target;
    await flush();
  }

  return {
    now: () => current,
    setTimeout,
    clearTimeout,
    advance,
    flush,
    pending: () => timers.size,
    nextDelay: () => {
      let min = null;
      for (const timer of timers.values()) if (min === null || timer.at < min) min = timer.at;
      return min === null ? null : min - current;
    }
  };
}

module.exports = { createFakeTimers };
```

`test/lite-scheduler.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  POLL_BOUNDS_MS,
  BACKOFF_MS,
  clampPollMs,
  backoffMs,
  pollDelayMs,
  createScheduler
} = require('../src/lite/scheduler');
const { createFakeTimers } = require('./helpers/fake-timers');

function setup({ hidden = false, random = () => 0.5 } = {}) {
  const clock = createFakeTimers();
  const page = { hidden };
  const scheduler = createScheduler({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    random,
    isHidden: () => page.hidden
  });
  return { clock, page, scheduler };
}

test('poll bounds and back-off constants match the spec', () => {
  assert.deepEqual(POLL_BOUNDS_MS, { min: 3000, max: 120000 });
  assert.deepEqual(BACKOFF_MS, { min: 5000, max: 120000 });
});

test('clampPollMs honours server nextPollMs within 3–120 s', () => {
  assert.equal(clampPollMs(5000), 5000);
  assert.equal(clampPollMs(1), 3000);
  assert.equal(clampPollMs(999999), 120000);
  assert.equal(clampPollMs(null), null);
  assert.equal(clampPollMs('nope'), null);
});

test('backoffMs grows 5 → 120 s and jitters ±20 %', () => {
  const mid = () => 0.5;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(n => backoffMs(n, mid)), [5000, 10000, 20000, 40000, 80000, 120000, 120000]);
  assert.equal(backoffMs(3, () => 0), 16000);
  assert.equal(backoffMs(3, () => 1), 24000);
  assert.equal(backoffMs(1, () => 0), 5000);
  assert.equal(backoffMs(9, () => 1), 120000);
});

test('pollDelayMs follows the cadence table', () => {
  assert.equal(pollDelayMs({ hidden: true }), null);
  assert.equal(pollDelayMs({}), 60000);
  assert.equal(pollDelayMs({ hasActive: true }), 5000);
  assert.equal(pollDelayMs({ isReviver: true }), 20000);
  assert.equal(pollDelayMs({ isReviver: true, sheetOpen: true }), 5000);
  assert.equal(pollDelayMs({ nextPollMs: 45000 }), 45000);
  assert.equal(pollDelayMs({ nextPollMs: 500 }), 3000);
  assert.equal(pollDelayMs({ nextPollMs: 900000, hasActive: true }), 120000);
  assert.equal(pollDelayMs({ isReviver: true, sheetOpen: true, nextPollMs: 20000 }), 5000);
  assert.equal(pollDelayMs({ isReviver: true, sheetOpen: true, nextPollMs: 90000 }), 90000);
});

test('one timer per tab: only the earliest due job is armed', async () => {
  const { clock, scheduler } = setup();
  const runs = [];
  scheduler.addJob('slow', { delay: () => 60000, run: () => { runs.push('slow'); } });
  scheduler.addJob('fast', { delay: () => 1000, run: () => { runs.push('fast'); } });
  scheduler.start();
  assert.equal(clock.pending(), 1);
  assert.equal(clock.nextDelay(), 1000);
  await clock.advance(3000);
  assert.deepEqual(runs, ['fast', 'fast', 'fast']);
  assert.equal(clock.pending(), 1);
  await clock.advance(57000);
  assert.equal(runs.filter(name => name === 'slow').length, 1);
  assert.equal(clock.pending(), 1);
});

test('a job whose delay is null holds no timer until rescheduled', async () => {
  const { clock, scheduler } = setup();
  const state = { delay: null };
  let runs = 0;
  scheduler.addJob('tick', { delay: () => state.delay, run: () => { runs += 1; } });
  scheduler.start();
  assert.equal(clock.pending(), 0);
  state.delay = 1000;
  scheduler.reschedule('tick');
  assert.equal(clock.pending(), 1);
  await clock.advance(1000);
  assert.equal(runs, 1);
});

test('runNow and trigger run a job immediately', async () => {
  const { clock, scheduler } = setup();
  let runs = 0;
  scheduler.addJob('poll', { delay: () => 60000, run: () => { runs += 1; }, runNow: true });
  scheduler.start();
  await clock.advance(0);
  assert.equal(runs, 1);
  scheduler.trigger('poll');
  await clock.advance(0);
  assert.equal(runs, 2);
  assert.equal(clock.nextDelay(), 60000);
});

test('zero timers while hidden; visible again re-arms and catches up', async () => {
  const { clock, page, scheduler } = setup();
  let runs = 0;
  scheduler.addJob('poll', { delay: () => 60000, run: () => { runs += 1; } });
  scheduler.start();
  await clock.advance(30000);
  page.hidden = true;
  scheduler.onVisibilityChange();
  assert.equal(clock.pending(), 0);
  await clock.advance(10 * 60000);
  assert.equal(runs, 0);
  page.hidden = false;
  scheduler.onVisibilityChange();
  assert.equal(clock.pending(), 1);
  assert.equal(clock.nextDelay(), 0);
  await clock.advance(0);
  assert.equal(runs, 1);
});

test('starting while hidden arms nothing', () => {
  const { clock, scheduler } = setup({ hidden: true });
  scheduler.addJob('poll', { delay: () => 1000, run: () => {}, runNow: true });
  scheduler.start();
  assert.equal(clock.pending(), 0);
});

test('failures back off exponentially with jitter and reset after a success', async () => {
  const { clock, scheduler } = setup();
  const outcome = { fail: true };
  let runs = 0;
  scheduler.addJob('poll', {
    delay: () => 60000,
    runNow: true,
    run: () => { runs += 1; if (outcome.fail) throw new Error('down'); }
  });
  scheduler.start();
  await clock.advance(0);
  assert.equal(scheduler.failures('poll'), 1);
  assert.equal(clock.nextDelay(), 5000);
  await clock.advance(5000);
  assert.equal(clock.nextDelay(), 10000);
  await clock.advance(10000);
  assert.equal(clock.nextDelay(), 20000);
  outcome.fail = false;
  await clock.advance(20000);
  assert.equal(runs, 4);
  assert.equal(scheduler.failures('poll'), 0);
  assert.equal(clock.nextDelay(), 60000);
});

test('rescheduling uses the last run as the base so a shorter cadence fires at once', async () => {
  const { clock, scheduler } = setup();
  const cadence = { ms: 60000 };
  let runs = 0;
  scheduler.addJob('poll', { delay: () => cadence.ms, run: () => { runs += 1; }, runNow: true });
  scheduler.start();
  await clock.advance(0);
  await clock.advance(10000);
  cadence.ms = 5000;
  scheduler.reschedule('poll');
  assert.equal(clock.nextDelay(), 0);
  await clock.advance(0);
  assert.equal(runs, 2);
});

test('a job never overlaps itself and the delay function sees the context', async () => {
  const { clock, scheduler } = setup();
  const seen = [];
  let release;
  scheduler.addJob('poll', {
    delay: ctx => { seen.push(ctx); return 1000; },
    runNow: true,
    run: () => new Promise(resolve => { release = resolve; })
  });
  scheduler.start();
  await clock.advance(0);
  scheduler.trigger('poll');
  await clock.advance(5000);
  assert.equal(clock.pending(), 0);
  release();
  await clock.flush();
  assert.equal(clock.pending(), 1);
  const last = seen[seen.length - 1];
  assert.equal(last.hidden, false);
  assert.equal(last.failures, 0);
  assert.equal(typeof last.now, 'number');
});

test('stop clears the timer; start is idempotent; clear forgets jobs', async () => {
  const { clock, scheduler } = setup();
  let runs = 0;
  scheduler.addJob('poll', { delay: () => 1000, run: () => { runs += 1; } });
  scheduler.start();
  scheduler.start();
  assert.equal(clock.pending(), 1);
  scheduler.stop();
  scheduler.stop();
  assert.equal(clock.pending(), 0);
  await clock.advance(5000);
  assert.equal(runs, 0);
  scheduler.start();
  assert.equal(clock.pending(), 1);
  scheduler.clear();
  assert.equal(clock.pending(), 0);
  assert.throws(() => scheduler.addJob('poll', { delay: 1, run: () => {} }), /delay and run are required/);
});

test('duplicate job names are rejected', () => {
  const { scheduler } = setup();
  scheduler.addJob('poll', { delay: () => null, run: () => {} });
  assert.throws(() => scheduler.addJob('poll', { delay: () => null, run: () => {} }), /already registered/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lite-scheduler.test.js`
Expected: FAIL with `Cannot find module '../src/lite/scheduler'`.

- [ ] **Step 3: Write the implementation**

`src/lite/scheduler.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteScheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const POLL_BOUNDS_MS = Object.freeze({ min: 3000, max: 120000 });
  const BACKOFF_MS = Object.freeze({ min: 5000, max: 120000 });
  const CADENCE_MS = Object.freeze({ IDLE: 60000, ACTIVE: 5000, REVIVER_SHEET_OPEN: 5000, REVIVER: 20000, TICK: 1000 });
  const JITTER_RATIO = 0.2;

  function clampPollMs(value) {
    const ms = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(ms)) return null;
    return Math.min(POLL_BOUNDS_MS.max, Math.max(POLL_BOUNDS_MS.min, Math.round(ms)));
  }

  function backoffMs(failures, random = Math.random) {
    const count = Math.max(1, Math.floor(Number(failures) || 1));
    const base = Math.min(BACKOFF_MS.max, BACKOFF_MS.min * Math.pow(2, count - 1));
    const factor = 1 - JITTER_RATIO + 2 * JITTER_RATIO * Number(random());
    return Math.min(BACKOFF_MS.max, Math.max(BACKOFF_MS.min, Math.round(base * factor)));
  }

  // Leader poll cadence for one context (spec "One scheduler" table).
  function pollDelayMs({ hidden = false, nextPollMs = null, hasActive = false, isReviver = false, sheetOpen = false } = {}) {
    if (hidden) return null;
    let table = CADENCE_MS.IDLE;
    if (hasActive) table = CADENCE_MS.ACTIVE;
    else if (isReviver && sheetOpen) table = CADENCE_MS.REVIVER_SHEET_OPEN;
    else if (isReviver) table = CADENCE_MS.REVIVER;
    const server = clampPollMs(nextPollMs);
    if (server === null) return table;
    // The server may always slow polling down. An open reviver sheet keeps its 5 s cadence
    // unless the server asked for more than the normal reviver cadence.
    if (isReviver && sheetOpen && !hasActive && server <= CADENCE_MS.REVIVER) return Math.min(server, CADENCE_MS.REVIVER_SHEET_OPEN);
    return server;
  }

  function createScheduler({ setTimeout: setTimer, clearTimeout: clearTimer, now, random = Math.random, isHidden = () => false } = {}) {
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') throw new Error('timer functions are required');
    if (typeof now !== 'function') throw new Error('now is required');

    const jobs = new Map();
    let timer = null;
    let started = false;

    function context(job) {
      return Object.freeze({ now: now(), hidden: Boolean(isHidden()), failures: job.failures, lastRunAt: job.lastRunAt });
    }

    function computeDueAt(job) {
      const base = job.lastRunAt === null ? job.addedAt : job.lastRunAt;
      if (job.failures > 0) return base + job.backoff;
      const delay = job.delay(context(job));
      if (delay === null || delay === undefined || !Number.isFinite(Number(delay))) return null;
      return base + Math.max(0, Number(delay));
    }

    function disarm() {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    }

    function arm() {
      disarm();
      if (!started || isHidden()) return;
      let earliest = null;
      for (const job of jobs.values()) {
        if (job.running || job.dueAt === null) continue;
        if (earliest === null || job.dueAt < earliest) earliest = job.dueAt;
      }
      if (earliest === null) return;
      timer = setTimer(fire, Math.max(0, earliest - now()));
    }

    function fire() {
      timer = null;
      if (!started || isHidden()) return;
      const at = now();
      for (const job of jobs.values()) {
        if (!job.running && job.dueAt !== null && job.dueAt <= at) runJob(job);
      }
      arm();
    }

    function runJob(job) {
      job.running = true;
      job.dueAt = null;
      const generation = job.generation;
      Promise.resolve()
        .then(() => job.run(context(job)))
        .then(() => {
          job.failures = 0;
          job.backoff = 0;
        }, () => {
          job.failures += 1;
          job.backoff = backoffMs(job.failures, random);
        })
        .then(() => {
          if (jobs.get(job.name) !== job || job.generation !== generation) return;
          job.running = false;
          job.lastRunAt = now();
          if (!isHidden()) job.dueAt = computeDueAt(job);
          arm();
        });
    }

    function addJob(name, { delay, run, runNow = false } = {}) {
      if (typeof delay !== 'function' || typeof run !== 'function') throw new Error('delay and run are required');
      if (jobs.has(name)) throw new Error(`job already registered: ${name}`);
      const job = { name, delay, run, dueAt: null, addedAt: now(), lastRunAt: null, failures: 0, backoff: 0, running: false, generation: 0 };
      jobs.set(name, job);
      if (!isHidden()) job.dueAt = runNow ? now() : computeDueAt(job);
      arm();
    }

    function removeJob(name) {
      const job = jobs.get(name);
      if (!job) return;
      job.generation += 1;
      jobs.delete(name);
      arm();
    }

    function reschedule(name) {
      const targets = name === undefined ? [...jobs.values()] : [jobs.get(name)].filter(Boolean);
      for (const job of targets) {
        if (job.running) continue;
        job.dueAt = isHidden() ? null : computeDueAt(job);
      }
      arm();
    }

    function trigger(name) {
      const job = jobs.get(name);
      if (!job || job.running) return;
      job.failures = 0;
      job.backoff = 0;
      job.dueAt = isHidden() ? null : now();
      arm();
    }

    function onVisibilityChange() {
      if (isHidden()) {
        for (const job of jobs.values()) if (!job.running) job.dueAt = null;
        disarm();
        return;
      }
      reschedule();
    }

    function start() {
      if (started) return;
      started = true;
      if (!isHidden()) {
        for (const job of jobs.values()) {
          if (!job.running && job.dueAt === null) job.dueAt = computeDueAt(job);
        }
      }
      arm();
    }

    function stop() {
      started = false;
      disarm();
    }

    function clear() {
      stop();
      for (const job of jobs.values()) job.generation += 1;
      jobs.clear();
    }

    return Object.freeze({
      addJob,
      removeJob,
      reschedule,
      trigger,
      onVisibilityChange,
      start,
      stop,
      clear,
      pendingTimers: () => (timer === null ? 0 : 1),
      dueAt: name => (jobs.has(name) ? jobs.get(name).dueAt : null),
      failures: name => (jobs.has(name) ? jobs.get(name).failures : 0)
    });
  }

  return Object.freeze({
    POLL_BOUNDS_MS,
    BACKOFF_MS,
    CADENCE_MS,
    clampPollMs,
    backoffMs,
    pollDelayMs,
    createScheduler
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/lite-scheduler.test.js`
Expected: `# tests 14`, `# pass 14`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lite/scheduler.js test/lite-scheduler.test.js test/helpers/fake-timers.js
git commit -m "feat(lite): add one-timer-per-tab scheduler with cadence table and back-off" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Snapshot cache (`src/lite/snapshot-cache.js`)

**Files:**
- Create: `src/lite/snapshot-cache.js`
- Test: `test/lite-snapshot-cache.test.js`

**Interfaces:**
- Consumes: an injected storage `{ get(key, fallback), set(key, value) }` (the shape of `platform.storage` from `src/platform.js`; values are stored as objects, like the other `reviverelay_*` keys).
- Produces (global `ReviveRelayLiteSnapshotCache`):
  - `createSnapshotCache({ storage, now?, key? }) → { read(), write(snapshot, fetchedAt?) → boolean, clear() }`.
  - `read() → null | Readonly<{ snapshot, stateVersion: string|null, fetchedAt: number, stale: boolean }>`; older than 24 h → cleared and `null`; older than 10 min → `stale: true`.
  - `write` stores `{ stateVersion, fetchedAt, data }` and returns `false` (without writing) when the stored entry has a newer `fetchedAt`. Storage errors never throw.
  - Constants `SNAPSHOT_KEY = 'reviverelay_state_snapshot_v1'`, `STALE_AFTER_MS = 600000`, `DISCARD_AFTER_MS = 86400000`.

- [ ] **Step 1: Write the failing test**

`test/lite-snapshot-cache.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SNAPSHOT_KEY,
  STALE_AFTER_MS,
  DISCARD_AFTER_MS,
  createSnapshotCache
} = require('../src/lite/snapshot-cache');

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    get: (key, fallback) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback),
    set: (key, value) => { values[key] = value; }
  };
}

const T0 = Date.parse('2026-11-25T12:00:00.000Z');
const snap = version => ({ stateVersion: version, nextPollMs: 60000, me: { tornId: 1 }, activeTransactions: [] });

test('key and ages match the spec', () => {
  assert.equal(SNAPSHOT_KEY, 'reviverelay_state_snapshot_v1');
  assert.equal(STALE_AFTER_MS, 600000);
  assert.equal(DISCARD_AFTER_MS, 86400000);
});

test('write then read round-trips the snapshot with its fetchedAt', () => {
  const storage = memoryStorage();
  let now = T0;
  const cache = createSnapshotCache({ storage, now: () => now });
  assert.equal(cache.read(), null);
  assert.equal(cache.write(snap('aaaaaaaaaaaaaaaa'), T0), true);
  assert.deepEqual(storage.values[SNAPSHOT_KEY], { stateVersion: 'aaaaaaaaaaaaaaaa', fetchedAt: T0, data: snap('aaaaaaaaaaaaaaaa') });
  now = T0 + 1000;
  const entry = cache.read();
  assert.equal(entry.stateVersion, 'aaaaaaaaaaaaaaaa');
  assert.equal(entry.fetchedAt, T0);
  assert.equal(entry.stale, false);
  assert.deepEqual(entry.snapshot, snap('aaaaaaaaaaaaaaaa'));
});

test('stale after 10 minutes, discarded after 24 hours', () => {
  const storage = memoryStorage();
  let now = T0;
  const cache = createSnapshotCache({ storage, now: () => now });
  cache.write(snap('aaaaaaaaaaaaaaaa'), T0);
  now = T0 + STALE_AFTER_MS;
  assert.equal(cache.read().stale, false);
  now = T0 + STALE_AFTER_MS + 1;
  assert.equal(cache.read().stale, true);
  now = T0 + DISCARD_AFTER_MS + 1;
  assert.equal(cache.read(), null);
  assert.equal(storage.values[SNAPSHOT_KEY], null);
});

test('never replaces a snapshot with an older fetchedAt', () => {
  const storage = memoryStorage();
  const cache = createSnapshotCache({ storage, now: () => T0 });
  assert.equal(cache.write(snap('bbbbbbbbbbbbbbbb'), T0), true);
  assert.equal(cache.write(snap('aaaaaaaaaaaaaaaa'), T0 - 1), false);
  assert.equal(cache.read().stateVersion, 'bbbbbbbbbbbbbbbb');
  assert.equal(cache.write(snap('cccccccccccccccc'), T0), true);
  assert.equal(cache.read().stateVersion, 'cccccccccccccccc');
});

test('corrupt or foreign values read as empty and are overwritten', () => {
  for (const bad of ['text', 42, [], { fetchedAt: 'x', data: {} }, { fetchedAt: T0, data: null }]) {
    const storage = memoryStorage({ [SNAPSHOT_KEY]: bad });
    const cache = createSnapshotCache({ storage, now: () => T0 });
    assert.equal(cache.read(), null);
    assert.equal(cache.write(snap('aaaaaaaaaaaaaaaa'), T0), true);
  }
});

test('storage failures never throw', () => {
  const storage = { get: () => { throw new Error('boom'); }, set: () => { throw new Error('boom'); } };
  const cache = createSnapshotCache({ storage, now: () => T0 });
  assert.equal(cache.read(), null);
  assert.equal(cache.write(snap('aaaaaaaaaaaaaaaa'), T0), false);
  assert.doesNotThrow(() => cache.clear());
});

test('rejects invalid input', () => {
  assert.throws(() => createSnapshotCache({}), /storage/);
  const cache = createSnapshotCache({ storage: memoryStorage(), now: () => T0 });
  assert.equal(cache.write(null, T0), false);
  assert.equal(cache.write(snap('aaaaaaaaaaaaaaaa'), Number.NaN), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lite-snapshot-cache.test.js`
Expected: FAIL with `Cannot find module '../src/lite/snapshot-cache'`.

- [ ] **Step 3: Write the implementation**

`src/lite/snapshot-cache.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteSnapshotCache = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SNAPSHOT_KEY = 'reviverelay_state_snapshot_v1';
  const STALE_AFTER_MS = 10 * 60 * 1000;
  const DISCARD_AFTER_MS = 24 * 60 * 60 * 1000;

  function validEntry(entry) {
    return Boolean(entry && typeof entry === 'object' && !Array.isArray(entry) &&
      Number.isFinite(entry.fetchedAt) &&
      entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data));
  }

  function createSnapshotCache({ storage, now = () => Date.now(), key = SNAPSHOT_KEY } = {}) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      throw new Error('storage with get/set is required');
    }

    function readEntry() {
      let entry;
      try { entry = storage.get(key, null); } catch (_) { return null; }
      return validEntry(entry) ? entry : null;
    }

    function read() {
      const entry = readEntry();
      if (!entry) return null;
      const age = Math.max(0, now() - entry.fetchedAt);
      if (age > DISCARD_AFTER_MS) {
        clear();
        return null;
      }
      return Object.freeze({
        snapshot: entry.data,
        stateVersion: typeof entry.stateVersion === 'string' ? entry.stateVersion : null,
        fetchedAt: entry.fetchedAt,
        stale: age > STALE_AFTER_MS
      });
    }

    function write(snapshot, fetchedAt = now()) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
      const at = Number(fetchedAt);
      if (!Number.isFinite(at)) return false;
      const existing = readEntry();
      if (existing && existing.fetchedAt > at) return false;
      try {
        storage.set(key, {
          stateVersion: typeof snapshot.stateVersion === 'string' ? snapshot.stateVersion : null,
          fetchedAt: at,
          data: snapshot
        });
      } catch (_) {
        return false;
      }
      return true;
    }

    function clear() {
      try { storage.set(key, null); } catch (_) { /* storage unavailable: nothing to clear */ }
    }

    return Object.freeze({ read, write, clear });
  }

  return Object.freeze({ SNAPSHOT_KEY, STALE_AFTER_MS, DISCARD_AFTER_MS, createSnapshotCache });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/lite-snapshot-cache.test.js`
Expected: `# tests 7`, `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lite/snapshot-cache.js test/lite-snapshot-cache.test.js
git commit -m "feat(lite): add state snapshot cache with stale and discard ages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tab leadership (`src/lite/tab-leader.js`)

**Files:**
- Create: `src/lite/tab-leader.js`
- Create: `test/helpers/fake-tabs.js`
- Test: `test/lite-tab-leader.test.js`

**Interfaces:**
- Consumes: injected factories only (no globals): `locks` (a `navigator.locks`-like object with `request(name, options, callback)`), `createChannel(name)` (returns a `BroadcastChannel`-like object with `postMessage`, `addEventListener('message')`, `removeEventListener`, `close`), `createAbortController()`, `isHidden()`, `setTimeout`, `clearTimeout`.
- Produces (global `ReviveRelayLiteTabLeader`):
  - `createTabLeader({ tabId, locks, createChannel, createAbortController, isHidden, setTimeout, clearTimeout, heartbeatMs?, leaderTimeoutMs?, electionMs?, onChange(isLeader), onSnapshot(payload) }) → { start(), stop(), onVisibilityChange(), broadcast(payload) → boolean, isLeader(), mode() → 'solo'|'locks'|'heartbeat', tabId() }`.
  - Modes: no channel factory (or it throws) → `solo`, always leader (TornPDA). Channel + `locks.request` → `locks`: visible tabs queue on lock `rr-leader`, hidden non-leaders abort their request, a hidden leader releases when a visible tab sends `claim`. Channel without locks → `heartbeat`: `hello`/`heartbeat`/`leader-hidden`/`claim`/`resign` messages on channel `rr-leader`, lowest `tabId` wins a tie, a visible follower re-elects after `leaderTimeoutMs` without heartbeats. Hidden tabs hold zero timers in every mode.
  - `broadcast(payload)` posts `{ type: 'state', payload, from }` on channel `rr-state` (leader only); followers get `onSnapshot(payload)`.
  - `stop()` releases the lock (or posts `resign`), clears timers and closes both channels without calling `onChange`.
  - Constants `LOCK_NAME = 'rr-leader'`, `LEADER_CHANNEL = 'rr-leader'`, `STATE_CHANNEL = 'rr-state'`, `DEFAULTS = { heartbeatMs: 2000, leaderTimeoutMs: 4000, electionMs: 500 }` (crash hand-off 4.5 s ≤ 5 s).
- Test helper `test/helpers/fake-tabs.js`: `createChannelHub() → { createChannel(name), log, openCount() }` (asynchronous delivery to every other open channel with the same name), `createLockManager() → { request, queued(name), held(name) }` (FIFO exclusive locks honouring `signal`), `createAbortController()`.

- [ ] **Step 1: Write the test helper and the failing test**

`test/helpers/fake-tabs.js`:

```js
'use strict';

// In-memory BroadcastChannel hub and Web Locks manager shared by several fake "tabs".
function createChannelHub() {
  const channels = new Set();
  const log = [];

  function createChannel(name) {
    const listeners = new Set();
    const channel = {
      name,
      closed: false,
      postMessage(data) {
        if (channel.closed) throw new Error('InvalidStateError');
        const copy = JSON.parse(JSON.stringify(data));
        log.push({ name, data: copy });
        for (const other of channels) {
          if (other === channel || other.closed || other.name !== name) continue;
          queueMicrotask(() => {
            if (!other.closed) for (const listener of [...other.listeners]) listener({ data: copy });
          });
        }
      },
      addEventListener(type, listener) { if (type === 'message') listeners.add(listener); },
      removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener); },
      close() { channel.closed = true; channels.delete(channel); },
      listeners
    };
    channels.add(channel);
    return channel;
  }

  return { createChannel, log, openCount: () => channels.size };
}

function createAbortController() {
  const listeners = new Set();
  const signal = {
    aborted: false,
    addEventListener(type, listener) { if (type === 'abort') listeners.add(listener); },
    removeEventListener(type, listener) { listeners.delete(listener); }
  };
  return {
    signal,
    abort() {
      if (signal.aborted) return;
      signal.aborted = true;
      for (const listener of [...listeners]) listener();
    }
  };
}

function createLockManager() {
  const queues = new Map();

  function grantNext(name) {
    const queue = queues.get(name) || [];
    const state = queues.get(`${name}:held`);
    if (state || queue.length === 0) return;
    const entry = queue.shift();
    queues.set(`${name}:held`, entry);
    Promise.resolve()
      .then(() => entry.callback({ name, mode: 'exclusive' }))
      .then(value => {
        queues.set(`${name}:held`, null);
        entry.resolve(value);
        grantNext(name);
      }, error => {
        queues.set(`${name}:held`, null);
        entry.reject(error);
        grantNext(name);
      });
  }

  function request(name, options, callback) {
    return new Promise((resolve, reject) => {
      if (!queues.has(name)) queues.set(name, []);
      const entry = { callback, resolve, reject };
      const signal = options && options.signal;
      if (signal) {
        if (signal.aborted) return reject(new Error('AbortError'));
        signal.addEventListener('abort', () => {
          const queue = queues.get(name);
          const index = queue.indexOf(entry);
          if (index >= 0) {
            queue.splice(index, 1);
            reject(new Error('AbortError'));
          }
        });
      }
      queues.get(name).push(entry);
      grantNext(name);
    });
  }

  return {
    request,
    queued: name => (queues.get(name) || []).length,
    held: name => Boolean(queues.get(`${name}:held`))
  };
}

module.exports = { createChannelHub, createLockManager, createAbortController };
```

`test/lite-tab-leader.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTabLeader, DEFAULTS, LOCK_NAME } = require('../src/lite/tab-leader');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createChannelHub, createLockManager, createAbortController } = require('./helpers/fake-tabs');

function makeTab({ id, clock, hub = null, locks = null, hidden = false }) {
  const page = { hidden };
  const changes = [];
  const snapshots = [];
  const channels = [];
  const leader = createTabLeader({
    tabId: id,
    locks,
    createChannel: hub ? name => { const channel = hub.createChannel(name); channels.push(channel); return channel; } : null,
    createAbortController,
    isHidden: () => page.hidden,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onChange: value => changes.push(value),
    onSnapshot: payload => snapshots.push(payload)
  });
  return {
    leader,
    page,
    changes,
    snapshots,
    setHidden(value) {
      page.hidden = value;
      leader.onVisibilityChange();
    },
    crash() {
      // The tab disappears without resigning: its channels die, nothing more is sent.
      channels.forEach(channel => channel.close());
    }
  };
}

const leaders = tabs => tabs.filter(tab => tab.leader.isLeader()).map(tab => tab.leader.tabId());

test('handoff budget: crash detection plus election stays within 5 s', () => {
  assert.ok(DEFAULTS.leaderTimeoutMs + DEFAULTS.electionMs <= 5000);
  assert.equal(LOCK_NAME, 'rr-leader');
});

test('no BroadcastChannel (TornPDA single WebView): always leader, broadcast is a no-op', async () => {
  const clock = createFakeTimers();
  const tab = makeTab({ id: 'pda', clock });
  tab.leader.start();
  assert.equal(tab.leader.mode(), 'solo');
  assert.equal(tab.leader.isLeader(), true);
  assert.deepEqual(tab.changes, [true]);
  tab.setHidden(true);
  assert.equal(tab.leader.isLeader(), true);
  assert.equal(tab.leader.broadcast({ x: 1 }), false);
  assert.equal(clock.pending(), 0);
});

test('a channel factory that throws falls back to solo leadership', () => {
  const clock = createFakeTimers();
  const leader = createTabLeader({ tabId: 'x', createChannel: () => { throw new Error('nope'); }, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  leader.start();
  assert.equal(leader.mode(), 'solo');
  assert.equal(leader.isLeader(), true);
});

test('Web Locks: exactly one of three visible tabs leads; followers receive rr-state', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  const tabs = ['a', 'b', 'c'].map(id => makeTab({ id, clock, hub, locks }));
  tabs.forEach(tab => tab.leader.start());
  await clock.flush();
  assert.equal(tabs[0].leader.mode(), 'locks');
  assert.deepEqual(leaders(tabs), ['a']);
  assert.equal(tabs[0].leader.broadcast({ stateVersion: '1' }), true);
  assert.equal(tabs[1].leader.broadcast({ stateVersion: 'x' }), false);
  await clock.flush();
  assert.deepEqual(tabs[1].snapshots, [{ stateVersion: '1' }]);
  assert.deepEqual(tabs[2].snapshots, [{ stateVersion: '1' }]);
  assert.deepEqual(tabs[0].snapshots, []);
  assert.equal(clock.pending(), 0);
});

test('Web Locks: a hidden leader hands off to a visible tab', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  const a = makeTab({ id: 'a', clock, hub, locks });
  const b = makeTab({ id: 'b', clock, hub, locks });
  a.leader.start();
  await clock.flush();
  b.leader.start();
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['a']);
  a.setHidden(true);
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['b']);
  assert.deepEqual(a.changes, [true, false]);
});

test('Web Locks: with every tab hidden the leader keeps the lock and hidden followers withdraw', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  const a = makeTab({ id: 'a', clock, hub, locks });
  const b = makeTab({ id: 'b', clock, hub, locks });
  a.leader.start();
  b.leader.start();
  await clock.flush();
  b.setHidden(true);
  await clock.flush();
  assert.equal(locks.queued(LOCK_NAME), 0);
  a.setHidden(true);
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['a']);
  b.setHidden(false);
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['b']);
});

test('Web Locks: a tab opened hidden does not queue; stopping the leader promotes the next visible tab', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  const a = makeTab({ id: 'a', clock, hub, locks });
  const hiddenTab = makeTab({ id: 'h', clock, hub, locks, hidden: true });
  const c = makeTab({ id: 'c', clock, hub, locks });
  a.leader.start();
  hiddenTab.leader.start();
  c.leader.start();
  await clock.flush();
  assert.equal(locks.queued(LOCK_NAME), 1);
  a.leader.stop();
  await clock.flush();
  assert.deepEqual(leaders([a, hiddenTab, c]), ['c']);
  assert.equal(hub.openCount(), 4);
});

test('heartbeat election: exactly one leader among three visible tabs started together', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const tabs = ['c', 'a', 'b'].map(id => makeTab({ id, clock, hub }));
  tabs.forEach(tab => tab.leader.start());
  assert.equal(tabs[0].leader.mode(), 'heartbeat');
  await clock.advance(DEFAULTS.electionMs);
  await clock.advance(DEFAULTS.heartbeatMs * 2);
  assert.equal(leaders(tabs).length, 1);
  const first = leaders(tabs)[0];
  await clock.advance(30000);
  assert.deepEqual(leaders(tabs), [first]);
});

test('heartbeat election: when two leaders meet, the lower tab id wins', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const b = makeTab({ id: 'b', clock, hub });
  b.leader.start();
  await clock.advance(DEFAULTS.electionMs);
  assert.equal(b.leader.isLeader(), true);
  const rival = hub.createChannel('rr-leader');
  rival.postMessage({ type: 'heartbeat', hidden: false, from: 'z' });
  await clock.flush();
  assert.equal(b.leader.isLeader(), true);
  rival.postMessage({ type: 'heartbeat', hidden: false, from: 'a' });
  await clock.flush();
  assert.equal(b.leader.isLeader(), false);
  rival.close();
});

test('heartbeat election: a late tab follows the existing leader', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const b = makeTab({ id: 'b', clock, hub });
  b.leader.start();
  await clock.advance(DEFAULTS.electionMs);
  assert.equal(b.leader.isLeader(), true);
  const a = makeTab({ id: 'a', clock, hub });
  a.leader.start();
  await clock.advance(DEFAULTS.electionMs + 10);
  assert.deepEqual(leaders([a, b]), ['b']);
});

test('heartbeat election: hiding the leader hands off to a visible tab', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  const b = makeTab({ id: 'b', clock, hub });
  a.leader.start();
  await clock.advance(DEFAULTS.electionMs);
  b.leader.start();
  await clock.advance(DEFAULTS.electionMs + 10);
  assert.deepEqual(leaders([a, b]), ['a']);
  a.setHidden(true);
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['b']);
  assert.equal(a.changes.at(-1), false);
});

test('heartbeat election: closing the leader re-elects within 5 s; a crashed leader is replaced within 5 s', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  const b = makeTab({ id: 'b', clock, hub });
  const c = makeTab({ id: 'c', clock, hub });
  a.leader.start();
  await clock.advance(DEFAULTS.electionMs);
  b.leader.start();
  c.leader.start();
  await clock.advance(DEFAULTS.electionMs + 10);
  a.leader.stop();
  await clock.advance(5000);
  assert.deepEqual(leaders([b, c]), ['b']);

  b.crash();
  await clock.advance(5000);
  assert.deepEqual(leaders([c]), ['c']);
});

test('heartbeat election: hidden tabs hold zero timers', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  const b = makeTab({ id: 'b', clock, hub });
  a.leader.start();
  b.leader.start();
  await clock.advance(DEFAULTS.electionMs + 10);
  a.setHidden(true);
  b.setHidden(true);
  await clock.flush();
  assert.equal(clock.pending(), 0);
  await clock.advance(60000);
  assert.equal(clock.pending(), 0);
  assert.equal(leaders([a, b]).length, 1);
});

test('heartbeat election: a tab becoming visible claims from a hidden leader', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  const b = makeTab({ id: 'b', clock, hub, hidden: true });
  a.leader.start();
  await clock.advance(DEFAULTS.electionMs);
  b.leader.start();
  a.setHidden(true);
  await clock.flush();
  assert.deepEqual(leaders([a, b]), ['a']);
  b.setHidden(false);
  await clock.advance(DEFAULTS.electionMs + 10);
  assert.deepEqual(leaders([a, b]), ['b']);
});

test('start and stop are idempotent and stop closes channels and timers', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const a = makeTab({ id: 'a', clock, hub });
  a.leader.start();
  a.leader.start();
  assert.equal(hub.openCount(), 2);
  await clock.advance(DEFAULTS.electionMs);
  a.leader.stop();
  a.leader.stop();
  assert.equal(hub.openCount(), 0);
  assert.equal(clock.pending(), 0);
  assert.equal(a.leader.isLeader(), false);
  a.leader.start();
  assert.equal(hub.openCount(), 2);
  a.leader.stop();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lite-tab-leader.test.js`
Expected: FAIL with `Cannot find module '../src/lite/tab-leader'`.

- [ ] **Step 3: Write the implementation**

`src/lite/tab-leader.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteTabLeader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LOCK_NAME = 'rr-leader';
  const LEADER_CHANNEL = 'rr-leader';
  const STATE_CHANNEL = 'rr-state';
  const DEFAULTS = Object.freeze({ heartbeatMs: 2000, leaderTimeoutMs: 4000, electionMs: 500 });

  function defaultTabId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function createTabLeader({
    tabId = defaultTabId(),
    locks = null,
    createChannel = null,
    createAbortController = typeof AbortController === 'function' ? () => new AbortController() : null,
    isHidden = () => false,
    setTimeout: setTimer = null,
    clearTimeout: clearTimer = null,
    heartbeatMs = DEFAULTS.heartbeatMs,
    leaderTimeoutMs = DEFAULTS.leaderTimeoutMs,
    electionMs = DEFAULTS.electionMs,
    onChange = () => {},
    onSnapshot = () => {}
  } = {}) {
    const id = String(tabId);
    let mode = 'solo';
    let started = false;
    let leader = false;
    let control = null;
    let stateChannel = null;

    // Web Locks mode
    let pending = null;
    let releaseLock = null;

    // Heartbeat mode
    let knownLeader = null;
    let leaderHidden = false;
    let heartbeatTimer = null;
    let watchdogTimer = null;
    let electionTimer = null;

    function setLeader(value) {
      if (leader === value) return;
      leader = value;
      try { onChange(value); } catch (_) { /* listener errors never break election */ }
    }

    function post(channel, message) {
      if (!channel) return;
      try { channel.postMessage({ ...message, from: id }); } catch (_) { /* channel closed */ }
    }

    function openChannels() {
      if (typeof createChannel !== 'function') return false;
      try {
        control = createChannel(LEADER_CHANNEL);
        stateChannel = createChannel(STATE_CHANNEL);
      } catch (_) {
        closeChannels();
        return false;
      }
      if (!control || !stateChannel) {
        closeChannels();
        return false;
      }
      control.addEventListener('message', onControlMessage);
      stateChannel.addEventListener('message', onStateMessage);
      return true;
    }

    function closeChannels() {
      for (const channel of [control, stateChannel]) {
        if (!channel) continue;
        try {
          channel.removeEventListener('message', onControlMessage);
          channel.removeEventListener('message', onStateMessage);
          channel.close();
        } catch (_) { /* already closed */ }
      }
      control = null;
      stateChannel = null;
    }

    function onStateMessage(event) {
      const message = event && event.data;
      if (!message || message.type !== 'state' || message.from === id || leader) return;
      try { onSnapshot(message.payload); } catch (_) { /* renderer errors stay local */ }
    }

    function onControlMessage(event) {
      const message = event && event.data;
      if (!message || typeof message.type !== 'string' || message.from === id || !started) return;
      if (mode === 'locks') onLocksMessage(message);
      else if (mode === 'heartbeat') onHeartbeatMessage(message);
    }

    // ---- Web Locks -------------------------------------------------------

    function requestLock() {
      if (leader || pending || !started) return;
      const token = {};
      const controller = typeof createAbortController === 'function' ? createAbortController() : null;
      pending = { token, controller };
      const options = controller ? { signal: controller.signal } : {};
      let request;
      try {
        request = locks.request(LOCK_NAME, options, () => {
          if (pending && pending.token === token) pending = null;
          if (!started) return undefined;
          return new Promise(resolve => {
            releaseLock = resolve;
            setLeader(true);
            if (isHidden()) post(control, { type: 'leader-hidden' });
          });
        });
      } catch (_) {
        pending = null;
        return;
      }
      Promise.resolve(request).catch(() => {}).then(() => {
        if (pending && pending.token === token) pending = null;
      });
    }

    function abortPending() {
      if (!pending) return;
      const { controller } = pending;
      pending = null;
      if (controller) {
        try { controller.abort(); } catch (_) { /* already settled */ }
      }
    }

    function releaseLeadership() {
      if (!releaseLock) return;
      const release = releaseLock;
      releaseLock = null;
      setLeader(false);
      release();
    }

    function onLocksMessage(message) {
      if (message.type === 'claim' && leader && isHidden()) releaseLeadership();
      if (message.type === 'leader-hidden' && !leader && !isHidden()) {
        requestLock();
        post(control, { type: 'claim' });
      }
    }

    function locksVisibility() {
      if (isHidden()) {
        if (leader) post(control, { type: 'leader-hidden' });
        else abortPending();
        return;
      }
      if (!leader) {
        requestLock();
        post(control, { type: 'claim' });
      }
    }

    // ---- BroadcastChannel heartbeat election -----------------------------

    function cancel(handle) {
      if (handle !== null) clearTimer(handle);
      return null;
    }

    function clearHeartbeatTimers() {
      heartbeatTimer = cancel(heartbeatTimer);
      watchdogTimer = cancel(watchdogTimer);
      electionTimer = cancel(electionTimer);
    }

    function scheduleHeartbeat() {
      heartbeatTimer = cancel(heartbeatTimer);
      if (!leader || isHidden() || !started) return;
      heartbeatTimer = setTimer(() => {
        heartbeatTimer = null;
        if (!leader || isHidden() || !started) return;
        post(control, { type: 'heartbeat', hidden: false });
        scheduleHeartbeat();
      }, heartbeatMs);
    }

    function armWatchdog() {
      watchdogTimer = cancel(watchdogTimer);
      if (leader || isHidden() || !started || leaderHidden) return;
      watchdogTimer = setTimer(() => {
        watchdogTimer = null;
        startElection();
      }, leaderTimeoutMs);
    }

    function startElection() {
      if (leader || isHidden() || !started || electionTimer !== null) return;
      knownLeader = null;
      leaderHidden = false;
      post(control, { type: 'hello' });
      electionTimer = setTimer(() => {
        electionTimer = null;
        if (!leader && knownLeader === null && !isHidden() && started) becomeLeader();
        else armWatchdog();
      }, electionMs);
    }

    function becomeLeader() {
      watchdogTimer = cancel(watchdogTimer);
      electionTimer = cancel(electionTimer);
      knownLeader = id;
      leaderHidden = false;
      setLeader(true);
      post(control, { type: 'heartbeat', hidden: isHidden() });
      scheduleHeartbeat();
    }

    function stepDown(newLeader, newLeaderHidden) {
      heartbeatTimer = cancel(heartbeatTimer);
      knownLeader = newLeader;
      leaderHidden = Boolean(newLeaderHidden);
      setLeader(false);
      armWatchdog();
    }

    function followLeader(from, hidden) {
      electionTimer = cancel(electionTimer);
      knownLeader = from;
      leaderHidden = Boolean(hidden);
      if (leaderHidden && !isHidden()) {
        watchdogTimer = cancel(watchdogTimer);
        post(control, { type: 'claim', to: from });
        return;
      }
      armWatchdog();
    }

    function onHeartbeatMessage(message) {
      switch (message.type) {
        case 'hello':
          if (leader) post(control, { type: 'heartbeat', hidden: isHidden() });
          break;
        case 'heartbeat':
        case 'leader-hidden': {
          const hidden = message.type === 'leader-hidden' || Boolean(message.hidden);
          if (leader) {
            if (String(message.from) < id) stepDown(message.from, hidden);
            else post(control, { type: 'heartbeat', hidden: isHidden() });
            break;
          }
          followLeader(message.from, hidden);
          break;
        }
        case 'claim':
          if (message.to && message.to !== id) break;
          if (leader && isHidden()) {
            post(control, { type: 'resign', to: message.from });
            stepDown(message.from, false);
          }
          break;
        case 'resign':
          if (message.to === id) {
            if (!isHidden()) becomeLeader();
            break;
          }
          if (leader) break;
          if (message.to) {
            knownLeader = message.to;
            leaderHidden = false;
            armWatchdog();
          } else {
            knownLeader = null;
            leaderHidden = false;
            watchdogTimer = cancel(watchdogTimer);
            startElection();
          }
          break;
        default:
          break;
      }
    }

    function heartbeatVisibility() {
      if (isHidden()) {
        watchdogTimer = cancel(watchdogTimer);
        electionTimer = cancel(electionTimer);
        if (leader) {
          heartbeatTimer = cancel(heartbeatTimer);
          post(control, { type: 'leader-hidden' });
        }
        return;
      }
      if (leader) {
        post(control, { type: 'heartbeat', hidden: false });
        scheduleHeartbeat();
      } else if (knownLeader === null) {
        startElection();
      } else if (leaderHidden) {
        post(control, { type: 'claim', to: knownLeader });
      } else {
        armWatchdog();
      }
    }

    // ---- public ------------------------------------------------------------

    function start() {
      if (started) return;
      started = true;
      if (!openChannels()) {
        mode = 'solo';
        setLeader(true);
        return;
      }
      if (locks && typeof locks.request === 'function') {
        mode = 'locks';
        if (!isHidden()) {
          requestLock();
          post(control, { type: 'claim' });
        }
        return;
      }
      if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') throw new Error('timer functions are required for heartbeat election');
      mode = 'heartbeat';
      if (!isHidden()) startElection();
    }

    function stop() {
      if (!started) return;
      if (mode === 'heartbeat') {
        if (leader) post(control, { type: 'resign', to: null });
        clearHeartbeatTimers();
        knownLeader = null;
        leaderHidden = false;
      }
      started = false;
      if (mode === 'locks') {
        abortPending();
        if (releaseLock) {
          const release = releaseLock;
          releaseLock = null;
          release();
        }
      }
      leader = false;
      closeChannels();
    }

    function onVisibilityChange() {
      if (!started) return;
      if (mode === 'locks') locksVisibility();
      else if (mode === 'heartbeat') heartbeatVisibility();
    }

    function broadcast(payload) {
      if (!started || !leader || !stateChannel) return false;
      post(stateChannel, { type: 'state', payload });
      return true;
    }

    return Object.freeze({
      start,
      stop,
      onVisibilityChange,
      broadcast,
      isLeader: () => leader,
      mode: () => mode,
      tabId: () => id
    });
  }

  return Object.freeze({ LOCK_NAME, LEADER_CHANNEL, STATE_CHANNEL, DEFAULTS, createTabLeader });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/lite-tab-leader.test.js`
Expected: `# tests 15`, `# pass 15`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lite/tab-leader.js test/lite-tab-leader.test.js test/helpers/fake-tabs.js
git commit -m "feat(lite): add single-actor tab leadership with rr-state broadcast" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: State client (`src/lite/state-client.js`)

**Files:**
- Create: `src/lite/state-client.js`
- Test: `test/lite-state-client.test.js`

**Interfaces:**
- Consumes: `platform.request({ method, url, headers }) → Promise<{ status, responseText, body }>` (`src/platform.js`; resolves for every HTTP status, rejects on network failure); `ReviveRelayDirectApiClient.mapHttpError(status, body)` and `DirectApiClientError` (`src/direct-api-client.js`), resolved lazily from `globalThis` or, under Node, `require('../direct-api-client')`.
- Produces (global `ReviveRelayLiteStateClient`):
  - `createStateClient({ baseUrl, request, getToken?, clientVersion?, releaseChannel?, now? }) → { getState(), getPlayerBadge(tornId), lastStateVersion(), reset(), badgeCacheSize() }`. `baseUrl` is the channel base, e.g. `https://reviverelay.voidsmithindustries.com/review`, so the request goes to `/review/v1/state`.
  - `getState() → Promise<Readonly<{ notModified: true, stateVersion } | { notModified: false, snapshot }>>`; sends `If-None-Match: "<lastStateVersion>"` once a 200 body has been seen; a 200 without a 16-hex `stateVersion`, or a 304 with nothing sent, rejects with `INVALID_STATE_RESPONSE`; other statuses reject via `mapHttpError`; transport failures reject with retryable `NETWORK_ERROR`.
  - `getPlayerBadge(tornId) → Promise<Readonly<{ tornId: number, requesterVerified: boolean, reviverVerified: boolean }>>` from `GET /v1/players/:tornId/badge`, cached 10 minutes in a 200-entry in-memory LRU; invalid ids reject with `INVALID_TORN_ID` without a request.
  - Constants `STATE_PATH = '/v1/state'`, `BADGE_CACHE = { ttlMs: 600000, maxEntries: 200 }`.

- [ ] **Step 1: Write the failing test**

`test/lite-state-client.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { STATE_PATH, BADGE_CACHE, createStateClient } = require('../src/lite/state-client');
const { DirectApiClientError } = require('../src/direct-api-client');

const BASE = 'https://reviverelay.voidsmithindustries.com/review';
const VERSION_A = '0123456789abcdef';
const VERSION_B = 'fedcba9876543210';

function stateBody(stateVersion = VERSION_A) {
  return {
    stateVersion,
    nextPollMs: 60000,
    me: { tornId: 1001, name: 'Patient', roles: ['requester'], verification: null },
    pro: { state: 'NONE' },
    activeRequest: null,
    activeTransactions: [],
    revivers: { online: 2 },
    queue: null
  };
}

function transport(responses) {
  const calls = [];
  const request = async input => {
    calls.push(input);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(input) : next;
  };
  return { calls, request };
}

function client(responses, options = {}) {
  const t = transport(responses);
  const api = createStateClient({
    baseUrl: `${BASE}/`,
    request: t.request,
    getToken: () => 'session-token',
    clientVersion: '1.0.0',
    releaseChannel: 'review',
    ...options
  });
  return { api, calls: t.calls };
}

test('GET /review/v1/state with the direct client headers and no If-None-Match on the first call', async () => {
  const { api, calls } = client([{ status: 200, body: stateBody(), responseText: '' }]);
  const result = await api.getState();
  assert.equal(STATE_PATH, '/v1/state');
  assert.deepEqual(calls, [{
    method: 'GET',
    url: `${BASE}/v1/state`,
    headers: {
      Accept: 'application/json',
      'X-ReviveRelay-Version': '1.0.0',
      'X-ReviveRelay-Channel': 'review',
      Authorization: 'Bearer session-token'
    }
  }]);
  assert.equal(result.notModified, false);
  assert.equal(result.snapshot.stateVersion, VERSION_A);
  assert.equal(api.lastStateVersion(), VERSION_A);
});

test('sends If-None-Match from the last stateVersion; 304 → notModified', async () => {
  const { api, calls } = client([
    { status: 200, body: stateBody(VERSION_A) },
    { status: 304, body: {}, responseText: '' },
    { status: 200, responseText: JSON.stringify(stateBody(VERSION_B)) }
  ]);
  await api.getState();
  const second = await api.getState();
  assert.equal(calls[1].headers['If-None-Match'], `"${VERSION_A}"`);
  assert.deepEqual(second, { notModified: true, stateVersion: VERSION_A });
  const third = await api.getState();
  assert.equal(calls[2].headers['If-None-Match'], `"${VERSION_A}"`);
  assert.equal(third.snapshot.stateVersion, VERSION_B);
  assert.equal(api.lastStateVersion(), VERSION_B);
});

test('no token → no Authorization header', async () => {
  const { api, calls } = client([{ status: 200, body: stateBody() }], { getToken: () => '' });
  await api.getState();
  assert.equal('Authorization' in calls[0].headers, false);
});

test('HTTP errors map through mapHttpError; transport errors become retryable NETWORK_ERROR', async () => {
  const { api } = client([
    { status: 401, body: { error: 'AUTH_REQUIRED' } },
    { status: 429, body: {} },
    { status: 503, body: {} },
    new Error('socket hang up'),
    new DirectApiClientError('NETWORK_ERROR', { retryable: true })
  ]);
  await assert.rejects(api.getState(), error => error instanceof DirectApiClientError && error.code === 'AUTH_REQUIRED' && error.status === 401 && !error.retryable);
  await assert.rejects(api.getState(), error => error.code === 'RATE_LIMITED' && error.retryable);
  await assert.rejects(api.getState(), error => error.code === 'SERVER_UNAVAILABLE' && error.retryable);
  await assert.rejects(api.getState(), error => error instanceof DirectApiClientError && error.code === 'NETWORK_ERROR' && error.retryable);
  await assert.rejects(api.getState(), error => error.code === 'NETWORK_ERROR');
  assert.equal(api.lastStateVersion(), null);
});

test('a malformed 200 or an unexpected 304 is rejected and never moves the version', async () => {
  const { api } = client([
    { status: 304, body: {} },
    { status: 200, body: { stateVersion: 'not-hex' } },
    { status: 200, body: stateBody(VERSION_A) },
    { status: 200, body: [] }
  ]);
  await assert.rejects(api.getState(), error => error.code === 'INVALID_STATE_RESPONSE');
  await assert.rejects(api.getState(), error => error.code === 'INVALID_STATE_RESPONSE');
  await api.getState();
  await assert.rejects(api.getState(), error => error.code === 'INVALID_STATE_RESPONSE');
  assert.equal(api.lastStateVersion(), VERSION_A);
});

test('getPlayerBadge fetches once and serves from cache for 10 minutes', async () => {
  let now = 0;
  const { api, calls } = client([
    { status: 200, body: { tornId: 42, requesterVerified: true, reviverVerified: 'yes' } },
    { status: 200, body: { tornId: 42, requesterVerified: false, reviverVerified: true } }
  ], { now: () => now });
  const first = await api.getPlayerBadge(42);
  assert.deepEqual(first, { tornId: 42, requesterVerified: true, reviverVerified: false });
  assert.equal(calls[0].url, `${BASE}/v1/players/42/badge`);
  now = BADGE_CACHE.ttlMs - 1;
  assert.equal(await api.getPlayerBadge('42'), first);
  assert.equal(calls.length, 1);
  now = BADGE_CACHE.ttlMs;
  const refreshed = await api.getPlayerBadge(42);
  assert.equal(calls.length, 2);
  assert.equal(refreshed.reviverVerified, true);
});

test('badge cache is an LRU bounded at 200 entries', async () => {
  assert.deepEqual(BADGE_CACHE, { ttlMs: 600000, maxEntries: 200 });
  const responder = input => ({ status: 200, body: { requesterVerified: true, reviverVerified: false, url: input.url } });
  const { api: lru, calls: lruCalls } = client(Array.from({ length: 203 }, () => responder), { now: () => 0 });
  for (let id = 1; id <= 200; id += 1) await lru.getPlayerBadge(id);
  assert.equal(lru.badgeCacheSize(), 200);
  await lru.getPlayerBadge(1);
  assert.equal(lruCalls.length, 200);
  await lru.getPlayerBadge(201);
  assert.equal(lru.badgeCacheSize(), 200);
  await lru.getPlayerBadge(1);
  assert.equal(lruCalls.length, 201);
  await lru.getPlayerBadge(2);
  assert.equal(lruCalls.length, 202);
});

test('getPlayerBadge rejects invalid ids without a request and maps HTTP errors', async () => {
  const { api, calls } = client([{ status: 429, body: {} }]);
  for (const bad of [0, '-1', 'abc', '0123', null, '1234567890123']) {
    await assert.rejects(api.getPlayerBadge(bad), error => error.code === 'INVALID_TORN_ID');
  }
  assert.equal(calls.length, 0);
  await assert.rejects(api.getPlayerBadge(7), error => error.code === 'RATE_LIMITED');
  assert.equal(api.badgeCacheSize(), 0);
});

test('reset forgets the version and the badge cache', async () => {
  const { api, calls } = client([{ status: 200, body: stateBody() }, { status: 200, body: stateBody() }]);
  await api.getState();
  api.reset();
  await api.getState();
  assert.equal('If-None-Match' in calls[1].headers, false);
});

test('constructor validation', () => {
  assert.throws(() => createStateClient({ baseUrl: 'ftp://x', request: () => {} }), /baseUrl/);
  assert.throws(() => createStateClient({ baseUrl: BASE }), /request transport/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lite-state-client.test.js`
Expected: FAIL with `Cannot find module '../src/lite/state-client'`.

- [ ] **Step 3: Write the implementation**

`src/lite/state-client.js`:

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
  const BADGE_CACHE = Object.freeze({ ttlMs: 10 * 60 * 1000, maxEntries: 200 });

  function directApi() {
    if (typeof globalThis !== 'undefined' &&
        globalThis.ReviveRelayDirectApiClient &&
        typeof globalThis.ReviveRelayDirectApiClient.mapHttpError === 'function') {
      return globalThis.ReviveRelayDirectApiClient;
    }
    if (typeof require === 'function') return require('../direct-api-client');
    throw new Error('ReviveRelay direct API client unavailable');
  }

  function clientError(code, options) {
    const { DirectApiClientError } = directApi();
    return new DirectApiClientError(code, options);
  }

  function parseBody(response) {
    if (response && response.body && typeof response.body === 'object') return response.body;
    const raw = response && typeof response.responseText === 'string' ? response.responseText : '';
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }

  function createStateClient({ baseUrl, request, getToken = () => '', clientVersion = '', releaseChannel = '', now = () => Date.now() } = {}) {
    const base = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('A valid ReviveRelay baseUrl is required');
    if (typeof request !== 'function') throw new Error('request transport is required');

    let lastStateVersion = null;
    const badges = new Map();

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
      const body = parseBody(response);
      if (status < 200 || status >= 300) throw directApi().mapHttpError(status, body);
      if (!body || typeof body !== 'object' || Array.isArray(body) || !STATE_VERSION_PATTERN.test(String(body.stateVersion || ''))) {
        throw clientError('INVALID_STATE_RESPONSE', { status, retryable: true });
      }
      lastStateVersion = body.stateVersion;
      return Object.freeze({ notModified: false, snapshot: body });
    }

    function rememberBadge(key, badge) {
      badges.delete(key);
      badges.set(key, { badge, expiresAt: now() + BADGE_CACHE.ttlMs });
      while (badges.size > BADGE_CACHE.maxEntries) badges.delete(badges.keys().next().value);
    }

    async function getPlayerBadge(tornId) {
      const key = String(tornId == null ? '' : tornId).trim();
      if (!TORN_ID_PATTERN.test(key)) throw clientError('INVALID_TORN_ID');
      const cached = badges.get(key);
      if (cached && cached.expiresAt > now()) {
        badges.delete(key);
        badges.set(key, cached);
        return cached.badge;
      }
      if (cached) badges.delete(key);
      const response = await send(`/v1/players/${key}/badge`);
      const status = Number(response && response.status) || 0;
      const body = parseBody(response);
      if (status < 200 || status >= 300) throw directApi().mapHttpError(status, body);
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
        badges.clear();
      },
      badgeCacheSize: () => badges.size
    });
  }

  return Object.freeze({ STATE_PATH, BADGE_CACHE, createStateClient });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/lite-state-client.test.js`
Expected: `# tests 10`, `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lite/state-client.js test/lite-state-client.test.js
git commit -m "feat(lite): add /v1/state client with ETag revalidation and badge LRU" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Icons and design tokens (`src/lite/icons.js`, `src/lite/tokens.js`)

**Files:**
- Create: `src/lite/icons.js`
- Create: `src/lite/tokens.js`
- Create: `test/helpers/fake-dom.js`
- Test: `test/lite-icons-tokens.test.js`

**Interfaces:**
- Consumes: an injected `document` with `createElementNS`.
- Produces:
  - Global `ReviveRelayLiteIcons`: `ICON_NAMES` (the 16 spec icons), `ICON_PATHS` (frozen static path data on a 24 × 24 grid), `SIZES = [16, 20]`, `SVG_NS`, `iconMarkup(name, size?) → string` (static trusted SVG string, `stroke="currentColor"`), `createIcon(document, name, size?) → SVGElement` (built with `createElementNS`, no HTML parsing). Unknown names fall back to `pill`, unknown sizes to 16.
  - Global `ReviveRelayLiteTokens`: `ACCENT = '#a4161a'`, `ACCENT_DARK = '#e5484d'`, `LIGHT`, `DARK` (token maps: surfaces, text, border, `tone-*` for all six tones, elevation), `MOTION = { fast: '120ms', slow: '250ms' }`, `TOKENS_CSS` (`:host` custom properties, `:host([data-theme="dark"])` overrides, reduced-motion zeroing via media query and `:host([data-motion="reduce"])`).
- Test helper `test/helpers/fake-dom.js`: `createFakeDocument()` (with `body`, `head`, `mutations` counter, `visibilityState`, `setVisibility(state)` firing `visibilitychange`, `listenerCount(type)`), `createFakeWindow({ media?, BroadcastChannel?, locks? })` (with `matchMedia`, `navigator`, `dispatch(type)`, `listenerCount(type)`), `countNodes(root)` (elements and text nodes, including shadow roots), `FakeElement`. Elements support `appendChild/append/insertBefore/removeChild/remove`, `textContent`, `setAttribute/getAttribute/hasAttribute/removeAttribute`, `classList`, `dataset`, `style.setProperty`, `attachShadow({mode})` (closed roots are reachable only through the returned object and `attachedShadow`), events with `click()`, a settable `rect` for `getBoundingClientRect()`, and `querySelector(All)` for one simple selector: `#id`, `.class`, `tag`, `[attr]`, `[attr="value"]` (anything else matches nothing).

- [ ] **Step 1: Write the test helper and the failing test**

`test/helpers/fake-dom.js`:

```js
'use strict';

// A deliberately tiny DOM for ReviveRelay Lite tests (no jsdom). It supports only what
// src/lite/* uses: createElement(NS), attachShadow, append/remove, textContent,
// attributes, classList, dataset, style, events, getBoundingClientRect and
// querySelector for one simple selector (#id, .class, tag, [attr], [attr="value"]).

class FakeNode {
  constructor(ownerDocument, nodeType) {
    this.ownerDocument = ownerDocument;
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
  }

  get isConnected() {
    let node = this;
    while (node) {
      if (node === this.ownerDocument) return true;
      node = node.parentNode || node.host || null;
    }
    return false;
  }

  get children() {
    return this.childNodes.filter(node => node.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    this.ownerDocument.mutations += 1;
    return child;
  }

  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node);
    }
  }

  insertBefore(child, reference) {
    if (!reference) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.childNodes.indexOf(reference);
    if (index < 0) throw new Error('NotFoundError');
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
    this.ownerDocument.mutations += 1;
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error('NotFoundError');
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    this.ownerDocument.mutations += 1;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  contains(node) {
    while (node) {
      if (node === this) return true;
      node = node.parentNode;
    }
    return false;
  }

  get textContent() {
    if (this.nodeType === 3) return this.data;
    return this.childNodes.map(node => node.textContent).join('');
  }

  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    const text = String(value == null ? '' : value);
    if (text) {
      const node = this.ownerDocument.createTextNode(text);
      node.parentNode = this;
      this.childNodes.push(node);
    }
    this.ownerDocument.mutations += 1;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const match = compileSelector(selector);
    const found = [];
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1 && match && match(child)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
}

class FakeText extends FakeNode {
  constructor(ownerDocument, data) {
    super(ownerDocument, 3);
    this.data = String(data);
  }
}

function compileSelector(selector) {
  const text = String(selector).trim();
  let m;
  if ((m = /^#([\w-]+)$/.exec(text))) return el => el.getAttribute('id') === m[1];
  if ((m = /^\.([\w-]+)$/.exec(text))) return el => el.classList.contains(m[1]);
  if ((m = /^\[([\w-]+)\]$/.exec(text))) return el => el.hasAttribute(m[1]);
  if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(text))) return el => el.getAttribute(m[1]) === m[2];
  if ((m = /^([a-zA-Z][\w-]*)$/.exec(text))) return el => el.localName === m[1].toLowerCase();
  return null;
}

class FakeElement extends FakeNode {
  constructor(ownerDocument, tagName, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    super(ownerDocument, 1);
    this.localName = String(tagName).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.namespaceURI = namespaceURI;
    this.attributes = new Map();
    this.listeners = new Map();
    this.shadowRoot = null;
    this.rect = { width: 200, height: 32 };
    const element = this;
    const styleValues = new Map();
    this.style = {
      setProperty(name, value) { styleValues.set(name, String(value)); element.ownerDocument.mutations += 1; },
      removeProperty(name) { styleValues.delete(name); element.ownerDocument.mutations += 1; },
      getPropertyValue(name) { return styleValues.get(name) || ''; }
    };
    this.classList = {
      add: (...names) => { const set = element.classSet(); names.forEach(n => set.add(n)); element.setAttribute('class', [...set].join(' ')); },
      remove: (...names) => { const set = element.classSet(); names.forEach(n => set.delete(n)); element.setAttribute('class', [...set].join(' ')); },
      contains: name => element.classSet().has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !element.classSet().has(name) : Boolean(force);
        if (on) element.classList.add(name); else element.classList.remove(name);
        return on;
      }
    };
    this.dataset = new Proxy({}, {
      get: (_, key) => element.getAttribute(`data-${toKebab(String(key))}`) ?? undefined,
      set: (_, key, value) => { element.setAttribute(`data-${toKebab(String(key))}`, value); return true; },
      deleteProperty: (_, key) => { element.removeAttribute(`data-${toKebab(String(key))}`); return true; },
      has: (_, key) => element.hasAttribute(`data-${toKebab(String(key))}`)
    });
  }

  classSet() {
    return new Set(String(this.getAttribute('class') || '').split(/\s+/).filter(Boolean));
  }

  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }

  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
    this.ownerDocument.mutations += 1;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    this.ownerDocument.mutations += 1;
  }

  attachShadow({ mode } = {}) {
    if (this.shadowRoot) throw new Error('NotSupportedError: shadow root already attached');
    const shadow = new FakeShadowRoot(this.ownerDocument, this, mode);
    this.shadowRoot = mode === 'open' ? shadow : null;
    this.attachedShadow = shadow;
    return shadow;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(listener);
  }

  dispatchEvent(event) {
    const listeners = this.listeners.get(event.type);
    if (listeners) for (const listener of [...listeners]) listener.call(this, event);
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
  }

  listenerCount(type) {
    return this.listeners.has(type) ? this.listeners.get(type).size : 0;
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: this.rect.width, bottom: this.rect.height, width: this.rect.width, height: this.rect.height };
  }
}

class FakeShadowRoot extends FakeNode {
  constructor(ownerDocument, host, mode) {
    super(ownerDocument, 11);
    this.host = host;
    this.mode = mode;
  }

  get parentNode() { return null; }
  set parentNode(_) { /* shadow roots have no parent */ }

  get isConnected() { return this.host.isConnected; }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(null, 9);
    this.ownerDocument = this;
    this.mutations = 0;
    this.visibilityState = 'visible';
    this.listeners = new Map();
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.mutations = 0;
  }

  get hidden() { return this.visibilityState === 'hidden'; }

  createElement(tagName) { return new FakeElement(this, tagName); }
  createElementNS(namespaceURI, tagName) { return new FakeElement(this, tagName, namespaceURI); }
  createTextNode(text) { return new FakeText(this, text); }
  getElementById(id) { return this.querySelector(`#${id}`); }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(listener);
  }

  listenerCount(type) {
    return this.listeners.has(type) ? this.listeners.get(type).size : 0;
  }

  setVisibility(state) {
    this.visibilityState = state;
    const listeners = this.listeners.get('visibilitychange');
    if (listeners) for (const listener of [...listeners]) listener({ type: 'visibilitychange' });
  }
}

function toKebab(key) {
  return key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

function createFakeDocument() {
  return new FakeDocument();
}

function createFakeWindow({ media = {}, BroadcastChannel, locks } = {}) {
  const listeners = new Map();
  const window = {
    innerWidth: 1280,
    navigator: locks ? { locks } : {},
    matchMedia: query => ({ matches: Boolean(media[query]), media: query }),
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (listeners.has(type)) listeners.get(type).delete(listener);
    },
    listenerCount: type => (listeners.has(type) ? listeners.get(type).size : 0),
    dispatch(type, event = {}) {
      if (listeners.has(type)) for (const listener of [...listeners.get(type)]) listener({ type, ...event });
    }
  };
  if (BroadcastChannel) window.BroadcastChannel = BroadcastChannel;
  return window;
}

// Counts every node (elements and text) under root, including shadow roots.
function countNodes(root) {
  let total = 0;
  const walk = node => {
    for (const child of node.childNodes) {
      total += 1;
      walk(child);
    }
    if (node.attachedShadow) walk(node.attachedShadow);
  };
  total += 1;
  walk(root);
  return total;
}

module.exports = { createFakeDocument, createFakeWindow, countNodes, FakeElement };
```

`test/lite-icons-tokens.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { SVG_NS, ICON_NAMES, ICON_PATHS, iconMarkup, createIcon } = require('../src/lite/icons');
const { ACCENT, LIGHT, DARK, MOTION, TOKENS_CSS } = require('../src/lite/tokens');
const { createFakeDocument } = require('./helpers/fake-dom');

const SPEC_ICONS = ['heartbeat', 'clock', 'plane', 'user-check', 'check', 'alert', 'refund', 'settings', 'close', 'chevron', 'bell', 'bolt', 'shield', 'cash', 'pill', 'external'];

test('the bundled icon set is exactly the 16 spec icons', () => {
  assert.deepEqual([...ICON_NAMES].sort(), [...SPEC_ICONS].sort());
  assert.equal(Object.isFrozen(ICON_PATHS), true);
});

test('every icon string is static, currentColor, 24-unit and script-free', () => {
  for (const name of ICON_NAMES) {
    for (const size of [16, 20]) {
      const svg = iconMarkup(name, size);
      assert.match(svg, /^<svg [^>]*viewBox="0 0 24 24"/);
      assert.match(svg, /stroke="currentColor"/);
      assert.match(svg, new RegExp(`width="${size}" height="${size}"`));
      assert.match(svg, /aria-hidden="true"/);
      assert.doesNotMatch(svg, /<script|on\w+=|javascript:|href=/i);
      for (const d of ICON_PATHS[name]) assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/);
    }
  }
});

test('unknown icon names and sizes fall back safely', () => {
  assert.match(iconMarkup('<img onerror=1>', 99), /data-rr-icon="pill"/);
  assert.match(iconMarkup('check', 99), /width="16"/);
});

test('createIcon builds SVG nodes without parsing markup', () => {
  const document = createFakeDocument();
  const svg = createIcon(document, 'clock', 20);
  assert.equal(svg.namespaceURI, SVG_NS);
  assert.equal(svg.localName, 'svg');
  assert.equal(svg.getAttribute('stroke'), 'currentColor');
  assert.equal(svg.getAttribute('width'), '20');
  assert.equal(svg.getAttribute('data-rr-icon'), 'clock');
  assert.equal(svg.childNodes.length, ICON_PATHS.clock.length);
  assert.deepEqual(svg.childNodes.map(path => path.getAttribute('d')), [...ICON_PATHS.clock]);
  assert.equal(svg.childNodes.every(path => path.namespaceURI === SVG_NS), true);
});

test('tokens: brand accent, every tone in light and dark, motion 120–250 ms', () => {
  assert.equal(ACCENT, '#a4161a');
  assert.equal(LIGHT.accent, '#a4161a');
  assert.notEqual(DARK.accent, '#a4161a');
  for (const tone of ['neutral', 'waiting', 'action', 'progress', 'success', 'attention']) {
    assert.ok(LIGHT[`tone-${tone}`], tone);
    assert.ok(DARK[`tone-${tone}`], tone);
    assert.match(TOKENS_CSS, new RegExp(`--rr-tone-${tone}:`));
  }
  assert.deepEqual(MOTION, { fast: '120ms', slow: '250ms' });
  assert.match(TOKENS_CSS, /:host\(\[data-theme="dark"\]\)/);
  assert.match(TOKENS_CSS, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(TOKENS_CSS, /--rr-tone-attention:#a4161a|--rr-tone-attention:#e5484d/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lite-icons-tokens.test.js`
Expected: FAIL with `Cannot find module '../src/lite/icons'`.

- [ ] **Step 3: Write the icons module**

`src/lite/icons.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteIcons = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEW_BOX = '0 0 24 24';

  // Static, trusted path data (24 × 24 grid, 2 px round strokes, currentColor).
  const ICON_PATHS = Object.freeze({
    heartbeat: Object.freeze(['M3 12h4l2-5 4 10 2-5h6']),
    clock: Object.freeze(['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 7v5l3 2']),
    plane: Object.freeze(['M3 11l18-7-7 18-3-8-8-3z']),
    'user-check': Object.freeze(['M9 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8z', 'M2 21v-1a6 6 0 0 1 12 0v1', 'M16 11l2 2 4-4']),
    check: Object.freeze(['M5 12l5 5 9-10']),
    alert: Object.freeze(['M12 3l10 18H2L12 3z', 'M12 10v4', 'M12 17.5v.5']),
    refund: Object.freeze(['M4 9h12a4 4 0 0 1 0 8h-6', 'M8 5L4 9l4 4']),
    settings: Object.freeze(['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1']),
    close: Object.freeze(['M6 6l12 12M18 6L6 18']),
    chevron: Object.freeze(['M9 6l6 6-6 6']),
    bell: Object.freeze(['M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2z', 'M10 21h4']),
    bolt: Object.freeze(['M13 2L4 14h7l-1 8 9-12h-7l1-8z']),
    shield: Object.freeze(['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z']),
    cash: Object.freeze(['M2 6h20v12H2z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z']),
    pill: Object.freeze(['M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7l7-7z', 'M7 7l10 10']),
    external: Object.freeze(['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'])
  });
  const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS));
  const SIZES = Object.freeze([16, 20]);

  function resolveName(name) {
    return Object.prototype.hasOwnProperty.call(ICON_PATHS, name) ? name : 'pill';
  }

  function resolveSize(size) {
    return SIZES.includes(Number(size)) ? Number(size) : 16;
  }

  function svgAttributes(name, size) {
    return [
      ['xmlns', SVG_NS],
      ['viewBox', VIEW_BOX],
      ['width', String(size)],
      ['height', String(size)],
      ['fill', 'none'],
      ['stroke', 'currentColor'],
      ['stroke-width', '2'],
      ['stroke-linecap', 'round'],
      ['stroke-linejoin', 'round'],
      ['aria-hidden', 'true'],
      ['focusable', 'false'],
      ['data-rr-icon', name]
    ];
  }

  // Static SVG string for a bundled icon. Only ever built from ICON_PATHS, never from data.
  function iconMarkup(name, size = 16) {
    const key = resolveName(name);
    const px = resolveSize(size);
    const attrs = svgAttributes(key, px).map(([attr, value]) => `${attr}="${value}"`).join(' ');
    const paths = ICON_PATHS[key].map(d => `<path d="${d}"/>`).join('');
    return `<svg ${attrs}>${paths}</svg>`;
  }

  // Builds the same icon as DOM nodes; no HTML string is ever parsed.
  function createIcon(document, name, size = 16) {
    const key = resolveName(name);
    const px = resolveSize(size);
    const svg = document.createElementNS(SVG_NS, 'svg');
    for (const [attr, value] of svgAttributes(key, px)) {
      if (attr !== 'xmlns') svg.setAttribute(attr, value);
    }
    for (const d of ICON_PATHS[key]) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }

  return Object.freeze({ SVG_NS, ICON_NAMES, ICON_PATHS, SIZES, iconMarkup, createIcon });
});
```

- [ ] **Step 4: Write the tokens module**

`src/lite/tokens.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteTokens = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACCENT = '#a4161a';
  const ACCENT_DARK = '#e5484d';

  const LIGHT = Object.freeze({
    accent: ACCENT,
    surface: '#ffffff',
    'surface-raised': '#f2f2f2',
    text: '#333333',
    'text-muted': '#666666',
    border: '#cccccc',
    'tone-neutral': '#666666',
    'tone-waiting': '#b7791f',
    'tone-action': '#6b46c1',
    'tone-progress': '#2b6cb0',
    'tone-success': '#2f855a',
    'tone-attention': '#c05621',
    elevation: '0 4px 12px rgba(0,0,0,.18)'
  });

  const DARK = Object.freeze({
    accent: ACCENT_DARK,
    surface: '#222222',
    'surface-raised': '#2e2e2e',
    text: '#dddddd',
    'text-muted': '#999999',
    border: '#444444',
    'tone-neutral': '#999999',
    'tone-waiting': '#f6c453',
    'tone-action': '#b794f4',
    'tone-progress': '#63b3ed',
    'tone-success': '#68d391',
    'tone-attention': '#f6ad55',
    elevation: '0 4px 12px rgba(0,0,0,.5)'
  });

  const MOTION = Object.freeze({ fast: '120ms', slow: '250ms' });

  function declarations(set) {
    return Object.entries(set).map(([name, value]) => `--rr-${name}:${value}`).join(';');
  }

  const TOKENS_CSS = [
    `:host{${declarations(LIGHT)};--rr-weight-regular:400;--rr-weight-strong:700;--rr-motion-fast:${MOTION.fast};--rr-motion-slow:${MOTION.slow}}`,
    `:host([data-theme="dark"]){${declarations(DARK)}}`,
    '@media (prefers-reduced-motion: reduce){:host{--rr-motion-fast:0ms;--rr-motion-slow:0ms}}',
    ':host([data-motion="reduce"]){--rr-motion-fast:0ms;--rr-motion-slow:0ms}'
  ].join('\n');

  return Object.freeze({ ACCENT, ACCENT_DARK, LIGHT, DARK, MOTION, TOKENS_CSS });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/lite-icons-tokens.test.js`
Expected: `# tests 5`, `# pass 5`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/lite/icons.js src/lite/tokens.js test/lite-icons-tokens.test.js test/helpers/fake-dom.js
git commit -m "feat(lite): add bundled icon set and design tokens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Header pill view (`src/lite/pill-view.js`)

**Files:**
- Create: `src/lite/pill-view.js`
- Test: `test/lite-pill-view.test.js`

**Interfaces:**
- Consumes: `ReviveRelayLiteIcons.createIcon` and `ReviveRelayLiteTokens.TOKENS_CSS` (Task 6), resolved from `globalThis` or `require('./icons')`/`require('./tokens')`; view models from `derivePill` (Task 1); injected `document`/`window`.
- Produces (global `ReviveRelayLitePillView`):
  - `mountPill({ document, window, onActivate?, headerSelectors?, minSlotWidth? }) → Readonly<{ update(viewModel), destroy(), place() → 'header'|'launcher'|null, refreshTheme(), host, shadow, placement() }>`.
  - One host `<div id="reviverelay-lite-root">` with a closed shadow root containing `<style>` (tokens + pill CSS) and one `<button class="rr-pill">` with `.rr-icon`, `.rr-label`, `.rr-detail`, `.rr-sync` spans. A leftover host with the same id is removed before mounting.
  - Placement: first `headerSelectors` match whose width ≥ `minSlotWidth` (40 px) → `data-rr-placement="header"`; otherwise appended to `document.body` with `data-rr-placement="launcher"` (fixed bottom-right with safe-area insets, 44 px touch target — the 0.7.3 PDA launcher position). Re-checked on `resize`.
  - `update` patches only changed values: `data-tone`, `data-syncing`, `data-offline`, `aria-label` (`ReviveRelay: <text>` + ` (syncing)`), label/detail via `textContent`, and swaps the icon node only when `icon` changes.
  - Theme: host `data-theme` from Torn's body class (`dark-mode`/`light-mode`), else `prefers-color-scheme`; host `data-motion` `reduce|full` from `prefers-reduced-motion`. `refreshTheme()` is the hook Plan 3 calls on Torn navigation.
  - Constants `HOST_ID = 'reviverelay-lite-root'`, `HEADER_SLOT_SELECTORS`, `MIN_SLOT_WIDTH = 40`, `PILL_CSS`; also `detectTheme({ document, window }) → 'dark'|'light'`.

- [ ] **Step 1: Write the failing test**

`test/lite-pill-view.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HOST_ID, HEADER_SLOT_SELECTORS, PILL_CSS, detectTheme, mountPill } = require('../src/lite/pill-view');
const { derivePill } = require('../src/lite/pill-state');
const { createFakeDocument, createFakeWindow, countNodes } = require('./helpers/fake-dom');

const NOW = Date.parse('2026-11-25T12:00:00.000Z');

function idleSnapshot(online = 3) {
  return {
    stateVersion: '0123456789abcdef',
    me: { tornId: 1, name: 'P', roles: ['requester'], verification: { usable: true, requester: true, reviver: false } },
    activeRequest: null,
    activeTransactions: [],
    revivers: { online },
    queue: null
  };
}

function setup({ header = true, headerWidth = 300, media = {} } = {}) {
  const document = createFakeDocument();
  const window = createFakeWindow({ media });
  let slot = null;
  if (header) {
    slot = document.createElement('div');
    slot.setAttribute('id', 'rr-test-header');
    slot.rect.width = headerWidth;
    document.body.appendChild(slot);
  }
  const activations = [];
  const view = mountPill({ document, window, onActivate: () => activations.push(1), headerSelectors: ['#rr-test-header'] });
  const button = view.shadow.querySelector('.rr-pill');
  return { document, window, slot, view, button, activations };
}

test('mounts one shadow-root host in the header slot', () => {
  const { document, slot, view } = setup();
  assert.equal(view.host.getAttribute('id'), HOST_ID);
  assert.equal(view.host.parentNode, slot);
  assert.equal(view.placement(), 'header');
  assert.equal(view.shadow.mode, 'closed');
  assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 1);
  assert.ok(Array.isArray(HEADER_SLOT_SELECTORS) && HEADER_SLOT_SELECTORS.length > 0);
});

test('falls back to the launcher position when the header slot is missing or too narrow', () => {
  const missing = setup({ header: false });
  assert.equal(missing.view.placement(), 'launcher');
  assert.equal(missing.view.host.parentNode, missing.document.body);
  const narrow = setup({ headerWidth: 0 });
  assert.equal(narrow.view.placement(), 'launcher');
  assert.match(PILL_CSS, /:host\(\[data-rr-placement="launcher"\]\)\{position:fixed/);
});

test('re-checks the slot on resize', () => {
  const { window, slot, view } = setup({ headerWidth: 0 });
  assert.equal(view.placement(), 'launcher');
  slot.rect.width = 300;
  window.dispatch('resize');
  assert.equal(view.placement(), 'header');
  assert.equal(view.host.parentNode, slot);
});

test('renders a view model with textContent and attributes', () => {
  const { view, button } = setup();
  view.update(derivePill(idleSnapshot(), 'live', NOW));
  assert.equal(button.getAttribute('data-tone'), 'neutral');
  assert.equal(button.getAttribute('data-syncing'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'ReviveRelay: Revive me · 3 online');
  assert.equal(button.querySelector('.rr-label').textContent, 'Revive me');
  assert.equal(button.querySelector('.rr-detail').textContent, '3 online');
  assert.equal(button.querySelector('.rr-icon').firstChild.getAttribute('data-rr-icon'), 'heartbeat');
});

test('player names are rendered as text, never parsed as markup', () => {
  const { view, button } = setup();
  const hostile = '<img src=x onerror=alert(1)>';
  view.update({ label: `Pay ${hostile}`, detail: '1:00 left', text: `Pay ${hostile} · 1:00 left`, tone: 'action', icon: 'cash', syncing: false, offline: false });
  const label = button.querySelector('.rr-label');
  assert.equal(label.textContent, `Pay ${hostile}`);
  assert.equal(label.childNodes.length, 1);
  assert.equal(label.childNodes[0].nodeType, 3);
  assert.equal(button.querySelector('img'), null);
});

test('updates patch only what changed', () => {
  const { document, view } = setup();
  const vm = derivePill(idleSnapshot(), 'live', NOW);
  view.update(vm);
  const before = document.mutations;
  view.update(derivePill(idleSnapshot(), 'live', NOW));
  assert.equal(document.mutations, before);
  view.update(derivePill(idleSnapshot(5), 'live', NOW));
  assert.equal(document.mutations, before + 2);
});

test('syncing and offline states are reflected on the pill', () => {
  const { view, button } = setup();
  view.update(derivePill(idleSnapshot(), 'syncing', NOW));
  assert.equal(button.getAttribute('data-syncing'), 'true');
  assert.match(button.getAttribute('aria-label'), /\(syncing\)$/);
  view.update(derivePill(idleSnapshot(), 'offline', NOW));
  assert.equal(button.getAttribute('data-offline'), 'true');
  assert.equal(button.querySelector('.rr-label').textContent, 'Offline');
  assert.equal(button.querySelector('.rr-icon').firstChild.getAttribute('data-rr-icon'), 'alert');
  assert.equal(button.querySelector('.rr-icon').childNodes.length, 1);
});

test('collapsed pill stays within 30 DOM nodes in every icon state', () => {
  const { view } = setup();
  for (const icon of ['heartbeat', 'clock', 'cash', 'check', 'alert', 'refund', 'bolt', 'shield', 'settings', 'pill', 'user-check']) {
    view.update({ label: 'Label', detail: '1:00 left', text: 'Label · 1:00 left', tone: 'waiting', icon, syncing: true, offline: false });
    assert.ok(countNodes(view.host) <= 30, `${icon}: ${countNodes(view.host)} nodes`);
  }
});

test('click activates; destroy removes host and listeners and is idempotent', () => {
  const { document, window, view, button, activations } = setup();
  button.click();
  assert.equal(activations.length, 1);
  assert.equal(window.listenerCount('resize'), 1);
  view.destroy();
  view.destroy();
  assert.equal(document.getElementById(HOST_ID), null);
  assert.equal(window.listenerCount('resize'), 0);
  assert.equal(button.listenerCount('click'), 0);
  view.update(derivePill(idleSnapshot(), 'live', NOW));
});

test('mounting again replaces a leftover host instead of duplicating it', () => {
  const { document, window } = setup();
  mountPill({ document, window, headerSelectors: ['#rr-test-header'] });
  assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 1);
});

test('theme follows Torn body class, then prefers-color-scheme; reduced motion is flagged', () => {
  const dark = setup({ media: { '(prefers-color-scheme: dark)': true, '(prefers-reduced-motion: reduce)': true } });
  assert.equal(dark.view.host.getAttribute('data-theme'), 'dark');
  assert.equal(dark.view.host.getAttribute('data-motion'), 'reduce');
  dark.document.body.classList.add('light-mode');
  dark.view.refreshTheme();
  assert.equal(dark.view.host.getAttribute('data-theme'), 'light');
  const light = setup();
  assert.equal(light.view.host.getAttribute('data-theme'), 'light');
  assert.equal(light.view.host.getAttribute('data-motion'), 'full');
  light.document.body.classList.add('dark-mode');
  assert.equal(detectTheme({ document: light.document, window: light.window }), 'dark');
});

test('the lite UI source never uses innerHTML', () => {
  for (const file of ['pill-view.js', 'icons.js', 'tokens.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lite', file), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/, file);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lite-pill-view.test.js`
Expected: FAIL with `Cannot find module '../src/lite/pill-view'`.

- [ ] **Step 3: Write the implementation**

`src/lite/pill-view.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLitePillView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HOST_ID = 'reviverelay-lite-root';
  // Torn header button area, most specific first. Overridable for tests and future Torn markup.
  const HEADER_SLOT_SELECTORS = Object.freeze([
    '#topRoot [class*="header-buttons"]',
    '#header-root [class*="header-buttons"]',
    '.header-wrapper-top .header-navigation.right',
    '.header-wrapper-top .header-navigation'
  ]);
  const MIN_SLOT_WIDTH = 40;

  const PILL_CSS = [
    ':host{all:initial;display:inline-flex;align-items:center;vertical-align:middle;margin:0 4px;font-family:inherit;font-size:inherit;line-height:1;color:var(--rr-text)}',
    ':host([data-rr-placement="launcher"]){position:fixed;z-index:2147483646;right:calc(10px + env(safe-area-inset-right, 0px));bottom:calc(10px + env(safe-area-inset-bottom, 0px));margin:0}',
    '.rr-pill{display:inline-flex;align-items:center;gap:6px;min-height:28px;max-width:280px;padding:0 10px;border:1px solid var(--rr-border);border-radius:999px;background:var(--rr-surface);color:var(--rr-text);font:inherit;font-weight:var(--rr-weight-regular);cursor:pointer;transition:border-color var(--rr-motion-fast) ease,background-color var(--rr-motion-fast) ease,opacity var(--rr-motion-slow) ease}',
    ':host([data-rr-placement="launcher"]) .rr-pill{min-height:44px;padding:0 14px;box-shadow:var(--rr-elevation)}',
    '@media (pointer: coarse){.rr-pill{min-height:44px}}',
    '.rr-pill:focus-visible{outline:2px solid var(--rr-accent);outline-offset:2px}',
    '.rr-pill[data-tone="neutral"]{--rr-tone:var(--rr-accent)}',
    '.rr-pill[data-tone="waiting"]{--rr-tone:var(--rr-tone-waiting);border-color:var(--rr-tone-waiting)}',
    '.rr-pill[data-tone="action"]{--rr-tone:var(--rr-tone-action);border-color:var(--rr-tone-action)}',
    '.rr-pill[data-tone="progress"]{--rr-tone:var(--rr-tone-progress);border-color:var(--rr-tone-progress)}',
    '.rr-pill[data-tone="success"]{--rr-tone:var(--rr-tone-success);border-color:var(--rr-tone-success)}',
    '.rr-pill[data-tone="attention"]{--rr-tone:var(--rr-tone-attention);border-color:var(--rr-tone-attention)}',
    '.rr-icon{display:inline-flex;color:var(--rr-tone)}',
    '.rr-label{font-weight:var(--rr-weight-strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rr-detail{color:var(--rr-text-muted);white-space:nowrap}',
    '.rr-detail:empty{display:none}',
    '.rr-detail::before{content:"\\00B7\\00A0"}',
    '.rr-sync{display:none;width:6px;height:6px;border-radius:50%;background:var(--rr-text-muted);animation:rr-pulse 1.2s ease-in-out infinite}',
    '.rr-pill[data-syncing="true"] .rr-sync{display:inline-block}',
    '.rr-pill[data-offline="true"]{border-style:dashed;opacity:.85}',
    '@keyframes rr-pulse{0%,100%{opacity:.35}50%{opacity:1}}',
    '@media (prefers-reduced-motion: reduce){.rr-pill,.rr-sync{transition:none;animation:none}}',
    ':host([data-motion="reduce"]) .rr-pill,:host([data-motion="reduce"]) .rr-sync{transition:none;animation:none}'
  ].join('\n');

  function dependency(globalName, path) {
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
    if (typeof require === 'function') return require(path);
    throw new Error(`${globalName} unavailable`);
  }

  function mediaMatches(window, query) {
    try {
      return Boolean(window && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
    } catch (_) {
      return false;
    }
  }

  function detectTheme({ document, window }) {
    const body = document && document.body;
    if (body && body.classList) {
      if (body.classList.contains('dark-mode')) return 'dark';
      if (body.classList.contains('light-mode')) return 'light';
    }
    return mediaMatches(window, '(prefers-color-scheme: dark)') ? 'dark' : 'light';
  }

  function mountPill({ document, window, onActivate = () => {}, headerSelectors = HEADER_SLOT_SELECTORS, minSlotWidth = MIN_SLOT_WIDTH } = {}) {
    if (!document || typeof document.createElement !== 'function') throw new Error('document is required');
    const { createIcon } = dependency('ReviveRelayLiteIcons', './icons');
    const { TOKENS_CSS } = dependency('ReviveRelayLiteTokens', './tokens');

    const stale = typeof document.getElementById === 'function' ? document.getElementById(HOST_ID) : null;
    if (stale) stale.remove();

    const host = document.createElement('div');
    host.setAttribute('id', HOST_ID);
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `${TOKENS_CSS}\n${PILL_CSS}`;
    const button = document.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('class', 'rr-pill');
    button.setAttribute('part', 'pill');
    const iconSlot = document.createElement('span');
    iconSlot.setAttribute('class', 'rr-icon');
    const label = document.createElement('span');
    label.setAttribute('class', 'rr-label');
    const detail = document.createElement('span');
    detail.setAttribute('class', 'rr-detail');
    const sync = document.createElement('span');
    sync.setAttribute('class', 'rr-sync');
    sync.setAttribute('aria-hidden', 'true');
    button.appendChild(iconSlot);
    button.appendChild(label);
    button.appendChild(detail);
    button.appendChild(sync);
    shadow.appendChild(style);
    shadow.appendChild(button);

    const last = {};
    let destroyed = false;

    function patchAttribute(element, key, name, value) {
      if (last[key] === value) return;
      last[key] = value;
      element.setAttribute(name, value);
    }

    function patchText(element, key, value) {
      if (last[key] === value) return;
      last[key] = value;
      element.textContent = value;
    }

    function findHeaderSlot() {
      for (const selector of headerSelectors) {
        let slot = null;
        try { slot = document.querySelector(selector); } catch (_) { slot = null; }
        if (!slot) continue;
        const width = typeof slot.getBoundingClientRect === 'function' ? slot.getBoundingClientRect().width : minSlotWidth;
        if (width >= minSlotWidth) return slot;
      }
      return null;
    }

    function place() {
      if (destroyed) return null;
      const slot = findHeaderSlot();
      const target = slot || document.body;
      if (!target) return null;
      const placement = slot ? 'header' : 'launcher';
      if (host.parentNode !== target) target.appendChild(host);
      patchAttribute(host, 'placement', 'data-rr-placement', placement);
      return placement;
    }

    function refreshTheme() {
      if (destroyed) return;
      patchAttribute(host, 'theme', 'data-theme', detectTheme({ document, window }));
      patchAttribute(host, 'motion', 'data-motion', mediaMatches(window, '(prefers-reduced-motion: reduce)') ? 'reduce' : 'full');
    }

    function onClick(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      try { onActivate(); } catch (_) { /* activation errors stay with the caller */ }
    }

    function onResize() {
      place();
    }

    function update(view) {
      if (destroyed || !view) return;
      const text = String(view.text || view.label || '');
      patchAttribute(button, 'tone', 'data-tone', String(view.tone || 'neutral'));
      patchAttribute(button, 'syncing', 'data-syncing', view.syncing ? 'true' : 'false');
      patchAttribute(button, 'offline', 'data-offline', view.offline ? 'true' : 'false');
      patchAttribute(button, 'aria', 'aria-label', `ReviveRelay: ${text}${view.syncing ? ' (syncing)' : ''}`);
      patchText(label, 'label', String(view.label || ''));
      patchText(detail, 'detail', String(view.detail || ''));
      const icon = String(view.icon || 'pill');
      if (last.icon !== icon) {
        last.icon = icon;
        const previous = iconSlot.firstChild;
        if (previous) previous.remove();
        iconSlot.appendChild(createIcon(document, icon, 16));
      }
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      button.removeEventListener('click', onClick);
      if (window && typeof window.removeEventListener === 'function') window.removeEventListener('resize', onResize);
      host.remove();
    }

    button.addEventListener('click', onClick);
    if (window && typeof window.addEventListener === 'function') window.addEventListener('resize', onResize);
    refreshTheme();
    place();

    return Object.freeze({
      update,
      destroy,
      place,
      refreshTheme,
      host,
      shadow,
      placement: () => last.placement || null
    });
  }

  return Object.freeze({ HOST_ID, HEADER_SLOT_SELECTORS, MIN_SLOT_WIDTH, PILL_CSS, detectTheme, mountPill });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/lite-pill-view.test.js`
Expected: `# tests 12`, `# pass 12`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lite/pill-view.js test/lite-pill-view.test.js
git commit -m "feat(lite): add shadow-root header pill view with launcher fallback" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Engine (`src/lite/engine.js`)

**Files:**
- Create: `src/lite/engine.js`
- Test: `test/lite-engine.test.js`

**Interfaces:**
- Consumes: `derivePill`, `FRESHNESS` (Task 1); `createScheduler`, `pollDelayMs`, `CADENCE_MS` (Task 2); `createSnapshotCache` (Task 3); `createTabLeader` (Task 4); `mountPill` (Task 7); an `api` with `getState()` shaped like Task 5's state client. All modules are resolved from `globalThis` (`ReviveRelayLite…`) or, under Node, `require('./…')`.
- Produces (global `ReviveRelayLiteEngine`):
  - `createLiteEngine({ platform?, api, window, document, storage, clock?, tabId?, headerSelectors?, onActivate? }) → Readonly<{ start(), stop(), setSheetOpen(open), refresh(), isStarted(), isLeader(), viewModel() }>`.
    - `clock = { now, setTimeout, clearTimeout, random }` (defaults to the real ones).
    - `platform.runtime.isTornPda === true` forces solo leadership (no `BroadcastChannel`); otherwise `window.BroadcastChannel` and `window.navigator.locks` select the leadership mode.
  - `start()`: read the cache and paint it as `syncing` (or the `ReviveRelay` placeholder), mount the pill, register the `poll` and `tick` jobs on one scheduler, join leadership, listen to `visibilitychange`. The leader polls immediately on gaining leadership, then on `pollDelayMs`; each result is cached, broadcast as `{ snapshot, freshness, fetchedAt }` and rendered; a failure renders `offline` and backs off. Followers render broadcasts. `tick` re-renders every 1 s only while the pill shows a timer/fade or the sheet is open.
  - `stop()`: removes the listener, stops leadership, clears the scheduler, destroys the pill. Both are idempotent; a response that lands after `stop()` is ignored.
  - `setSheetOpen(open)` (used by Plan 3's sheet) reschedules `poll` and `tick`; `refresh()` polls now if leader.

- [ ] **Step 1: Write the failing test**

`test/lite-engine.test.js`:

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
    revivers: { online: 2 },
    queue: null,
    ...overrides
  };
}

function fakeApi(responses) {
  const api = {
    calls: 0,
    async getState() {
      api.calls += 1;
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (next instanceof Error) throw next;
      return next;
    }
  };
  return api;
}

function makeEngine({ clock, api, storage = memoryStorage(), window = createFakeWindow(), document = createFakeDocument(), tabId = 'tab', platform = null }) {
  const engine = createLiteEngine({ platform, api, window, document, storage, clock, tabId, headerSelectors: ['#rr-none'] });
  return { engine, document, window, storage };
}

const pillText = engine => engine.viewModel() && engine.viewModel().text;

test('boot paints the cached snapshot as syncing before the network answers, then confirms it', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage({ [SNAPSHOT_KEY]: { stateVersion: '0123456789abcdef', fetchedAt: clock.now() - 60000, data: snapshot({ revivers: { online: 7 } }) } });
  const api = fakeApi([{ notModified: false, snapshot: snapshot({ revivers: { online: 4 } }) }]);
  const { engine, document } = makeEngine({ clock, api, storage });
  engine.start();
  assert.equal(pillText(engine), 'Revive me · 7 online');
  assert.equal(engine.viewModel().syncing, true);
  assert.ok(document.getElementById(HOST_ID));
  assert.equal(api.calls, 0);
  await clock.advance(0);
  assert.equal(api.calls, 1);
  assert.equal(pillText(engine), 'Revive me · 4 online');
  assert.equal(engine.viewModel().syncing, false);
  assert.equal(storage.values[SNAPSHOT_KEY].data.revivers.online, 4);
  assert.equal(storage.values[SNAPSHOT_KEY].fetchedAt, clock.now());
  engine.stop();
});

test('without BroadcastChannel the tab is always leader and polls on the server cadence with one timer', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api });
  engine.start();
  assert.equal(engine.isLeader(), true);
  await clock.advance(0);
  assert.equal(clock.pending(), 1);
  assert.equal(clock.nextDelay(), 60000);
  await clock.advance(60000);
  assert.equal(api.calls, 2);
  engine.stop();
});

test('an active request polls every 5 s and ticks the timer every second (still one timer)', async () => {
  const createdAt = new Date(Date.parse('2026-11-25T12:00:00.000Z') - 10000).toISOString();
  const active = snapshot({ nextPollMs: 5000, activeRequest: { id: 'r1', state: 'AVAILABLE', createdAt, transactionId: null } });
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: active }]);
  const { engine } = makeEngine({ clock, api });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Waiting · 0:10');
  assert.equal(clock.pending(), 1);
  await clock.advance(1000);
  assert.equal(pillText(engine), 'Waiting · 0:11');
  await clock.advance(4000);
  assert.equal(api.calls, 2);
  await clock.advance(60000);
  assert.equal(api.calls, 14);
  assert.equal(clock.pending(), 1);
  engine.stop();
});

test('304 keeps the snapshot, confirms it live and refreshes the cache time', async () => {
  const clock = createFakeTimers();
  const storage = memoryStorage();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }, { notModified: true, stateVersion: '0123456789abcdef' }]);
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  await clock.advance(60000);
  assert.equal(api.calls, 2);
  assert.equal(engine.viewModel().syncing, false);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  assert.equal(storage.values[SNAPSHOT_KEY].fetchedAt, clock.now());
  engine.stop();
});

test('transport failure shows "Offline · retrying" and backs off 5 → 10 s, then recovers', async () => {
  const clock = createFakeTimers();
  const down = new DirectApiClientError('NETWORK_ERROR', { retryable: true });
  const api = fakeApi([down, down, { notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api, window: createFakeWindow() });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Offline · retrying');
  assert.equal(engine.viewModel().tone, 'neutral');
  const firstBackoff = clock.nextDelay();
  assert.ok(firstBackoff >= 4000 && firstBackoff <= 6000, `backoff ${firstBackoff}`);
  await clock.advance(firstBackoff);
  const secondBackoff = clock.nextDelay();
  assert.ok(secondBackoff >= 8000 && secondBackoff <= 12000, `backoff ${secondBackoff}`);
  await clock.advance(secondBackoff);
  assert.equal(pillText(engine), 'Revive me · 2 online');
  assert.equal(clock.nextDelay(), 60000);
  engine.stop();
});

test('a hidden tab makes no requests and holds no timers; becoming visible polls at once', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const document = createFakeDocument();
  document.visibilityState = 'hidden';
  const { engine } = makeEngine({ clock, api, document });
  engine.start();
  await clock.advance(10 * 60000);
  assert.equal(api.calls, 0);
  assert.equal(clock.pending(), 0);
  document.setVisibility('visible');
  await clock.advance(0);
  assert.equal(api.calls, 1);
  document.setVisibility('hidden');
  assert.equal(clock.pending(), 0);
  await clock.advance(10 * 60000);
  assert.equal(api.calls, 1);
  engine.stop();
});

test('start/stop are idempotent: no duplicated hosts, listeners or timers across cycles', async () => {
  const clock = createFakeTimers();
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine, document, window } = makeEngine({ clock, api });
  for (let cycle = 0; cycle < 5; cycle += 1) {
    engine.start();
    engine.start();
    await clock.advance(0);
    assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 1);
    assert.equal(document.listenerCount('visibilitychange'), 1);
    assert.equal(window.listenerCount('resize'), 1);
    assert.equal(clock.pending(), 1);
    engine.stop();
    engine.stop();
    assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 0);
    assert.equal(document.listenerCount('visibilitychange'), 0);
    assert.equal(window.listenerCount('resize'), 0);
    assert.equal(clock.pending(), 0);
  }
  assert.equal(api.calls, 5);
  assert.equal(engine.isStarted(), false);
});

test('a response arriving after stop is ignored', async () => {
  const clock = createFakeTimers();
  let resolve;
  const api = { calls: 0, getState: () => { api.calls += 1; return new Promise(r => { resolve = r; }); } };
  const storage = memoryStorage();
  const { engine } = makeEngine({ clock, api, storage });
  engine.start();
  await clock.advance(0);
  engine.stop();
  resolve({ notModified: false, snapshot: snapshot() });
  await clock.flush();
  assert.equal(storage.values[SNAPSHOT_KEY], undefined);
  assert.equal(clock.pending(), 0);
});

test('TornPDA runtime ignores BroadcastChannel and leads alone', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  function BroadcastChannel(name) { return hub.createChannel(name); }
  const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
  const { engine } = makeEngine({ clock, api, window: createFakeWindow({ BroadcastChannel }), platform: { runtime: { isTornPda: true } } });
  engine.start();
  assert.equal(engine.isLeader(), true);
  assert.equal(hub.openCount(), 0);
  engine.stop();
});

test('three tabs: exactly one polls, the others render its broadcast; hiding the leader hands off', async () => {
  const clock = createFakeTimers();
  const hub = createChannelHub();
  const locks = createLockManager();
  function BroadcastChannel(name) { return hub.createChannel(name); }
  const storage = memoryStorage();
  const tabs = ['a', 'b', 'c'].map(tabId => {
    const api = fakeApi([{ notModified: false, snapshot: snapshot() }]);
    const window = createFakeWindow({ BroadcastChannel, locks });
    window.AbortController = function AbortController() { return createAbortController(); };
    return { api, ...makeEngine({ clock, api, storage, window, tabId }) };
  });
  tabs.forEach(tab => tab.engine.start());
  await clock.advance(0);
  await clock.advance(60000);
  assert.deepEqual(tabs.map(tab => tab.engine.isLeader()), [true, false, false]);
  assert.deepEqual(tabs.map(tab => tab.api.calls), [2, 0, 0]);
  for (const tab of tabs) {
    assert.equal(pillText(tab.engine), 'Revive me · 2 online');
    assert.equal(tab.engine.viewModel().syncing, false);
  }

  tabs[0].document.setVisibility('hidden');
  await clock.advance(0);
  assert.deepEqual(tabs.map(tab => tab.engine.isLeader()), [false, true, false]);
  assert.equal(tabs[1].api.calls, 1);
  await clock.advance(60000);
  assert.deepEqual(tabs.map(tab => tab.api.calls), [2, 2, 0]);
  tabs.forEach(tab => tab.engine.stop());
  assert.equal(hub.openCount(), 0);
});

test('setSheetOpen speeds a reviver poll to 5 s and enables the 1 s tick', async () => {
  const clock = createFakeTimers();
  const reviver = snapshot({ nextPollMs: 20000, me: { tornId: 2, name: 'Medic', roles: ['reviver'], verification: { usable: true, requester: false, reviver: true } }, queue: { count: 3 } });
  const api = fakeApi([{ notModified: false, snapshot: reviver }]);
  const { engine } = makeEngine({ clock, api });
  engine.start();
  await clock.advance(0);
  assert.equal(pillText(engine), 'Queue · 3');
  assert.equal(clock.nextDelay(), 20000);
  engine.setSheetOpen(true);
  assert.equal(clock.nextDelay(), 1000);
  await clock.advance(5000);
  assert.equal(api.calls, 2);
  engine.setSheetOpen(false);
  assert.equal(clock.nextDelay(), 20000);
  engine.stop();
});

test('constructor validation', () => {
  assert.throws(() => createLiteEngine({ document: createFakeDocument(), storage: memoryStorage() }), /api.getState/);
  assert.throws(() => createLiteEngine({ api: fakeApi([]), storage: memoryStorage() }), /document/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lite-engine.test.js`
Expected: FAIL with `Cannot find module '../src/lite/engine'`.

- [ ] **Step 3: Write the implementation**

`src/lite/engine.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dependency(globalName, path) {
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
    if (typeof require === 'function') return require(path);
    throw new Error(`${globalName} unavailable`);
  }

  function loadModules() {
    return {
      PillState: dependency('ReviveRelayLitePillState', './pill-state'),
      Scheduler: dependency('ReviveRelayLiteScheduler', './scheduler'),
      TabLeader: dependency('ReviveRelayLiteTabLeader', './tab-leader'),
      SnapshotCache: dependency('ReviveRelayLiteSnapshotCache', './snapshot-cache'),
      PillView: dependency('ReviveRelayLitePillView', './pill-view')
    };
  }

  function createLiteEngine({
    platform = null,
    api,
    window,
    document,
    storage,
    clock = {},
    tabId,
    headerSelectors,
    onActivate = () => {}
  } = {}) {
    if (!api || typeof api.getState !== 'function') throw new Error('api.getState is required');
    if (!document || typeof document.addEventListener !== 'function') throw new Error('document is required');
    const { PillState, Scheduler, TabLeader, SnapshotCache, PillView } = loadModules();

    const now = typeof clock.now === 'function' ? clock.now : () => Date.now();
    const setTimer = typeof clock.setTimeout === 'function' ? clock.setTimeout : (fn, ms) => globalThis.setTimeout(fn, ms);
    const clearTimer = typeof clock.clearTimeout === 'function' ? clock.clearTimeout : handle => globalThis.clearTimeout(handle);
    const random = typeof clock.random === 'function' ? clock.random : Math.random;
    const cache = SnapshotCache.createSnapshotCache({ storage, now });

    const isTornPda = Boolean(platform && platform.runtime && platform.runtime.isTornPda);
    const BroadcastChannelCtor = window && typeof window.BroadcastChannel === 'function' ? window.BroadcastChannel : null;
    const createChannel = !isTornPda && BroadcastChannelCtor ? name => new BroadcastChannelCtor(name) : null;
    const locks = window && window.navigator && window.navigator.locks ? window.navigator.locks : null;
    const AbortControllerCtor = window && typeof window.AbortController === 'function'
      ? window.AbortController
      : (typeof AbortController === 'function' ? AbortController : null);

    let started = false;
    let epoch = 0;
    let view = null;
    let scheduler = null;
    let leader = null;
    let current = { snapshot: null, freshness: 'syncing' };
    let lastView = null;
    let sheetOpen = false;

    function isHidden() {
      return document.visibilityState === 'hidden' || document.hidden === true;
    }

    function isLeader() {
      return Boolean(leader && leader.isLeader());
    }

    function render() {
      if (!view) return;
      lastView = PillState.derivePill(current.snapshot, current.freshness, now());
      view.update(lastView);
    }

    function needsTick() {
      return Boolean(sheetOpen || (lastView && (lastView.timer || lastView.refreshAt !== null)));
    }

    function pollDelay() {
      if (!isLeader()) return null;
      const snapshot = current.snapshot || {};
      return Scheduler.pollDelayMs({
        hidden: isHidden(),
        nextPollMs: snapshot.nextPollMs,
        hasActive: Boolean(snapshot.activeRequest || (Array.isArray(snapshot.activeTransactions) && snapshot.activeTransactions.length)),
        isReviver: Boolean(snapshot.me && Array.isArray(snapshot.me.roles) && snapshot.me.roles.includes('reviver')),
        sheetOpen
      });
    }

    function apply(snapshot, freshness, fetchedAt) {
      current = { snapshot, freshness };
      if (snapshot && fetchedAt !== null) cache.write(snapshot, fetchedAt);
      if (isLeader()) leader.broadcast({ snapshot, freshness, fetchedAt });
      render();
      if (scheduler) scheduler.reschedule('tick');
    }

    async function poll() {
      if (!isLeader()) return;
      const runEpoch = epoch;
      let result;
      try {
        result = await api.getState();
      } catch (error) {
        if (started && runEpoch === epoch) apply(current.snapshot, 'offline', null);
        throw error;
      }
      if (!started || runEpoch !== epoch) return;
      const snapshot = result && result.notModified ? current.snapshot : result && result.snapshot;
      if (!snapshot) return;
      apply(snapshot, 'live', now());
    }

    function onLeaderChange(nowLeader) {
      if (!scheduler) return;
      if (nowLeader) scheduler.trigger('poll');
      else scheduler.reschedule('poll');
    }

    function onBroadcast(payload) {
      if (!started || isLeader() || !payload || typeof payload !== 'object') return;
      const freshness = PillState.FRESHNESS.includes(payload.freshness) ? payload.freshness : 'syncing';
      current = { snapshot: payload.snapshot || current.snapshot, freshness };
      render();
      if (scheduler) scheduler.reschedule('tick');
    }

    function onVisibilityChange() {
      if (!started) return;
      leader.onVisibilityChange();
      scheduler.onVisibilityChange();
      if (!isHidden()) render();
    }

    function start() {
      if (started) return;
      started = true;
      epoch += 1;
      const cached = cache.read();
      current = { snapshot: cached ? cached.snapshot : null, freshness: 'syncing' };
      view = PillView.mountPill({ document, window, onActivate, headerSelectors });
      render();
      scheduler = Scheduler.createScheduler({ setTimeout: setTimer, clearTimeout: clearTimer, now, random, isHidden });
      scheduler.addJob('poll', { delay: pollDelay, run: poll });
      scheduler.addJob('tick', { delay: () => (needsTick() ? Scheduler.CADENCE_MS.TICK : null), run: () => render() });
      leader = TabLeader.createTabLeader({
        tabId,
        locks,
        createChannel,
        createAbortController: AbortControllerCtor ? () => new AbortControllerCtor() : null,
        isHidden,
        setTimeout: setTimer,
        clearTimeout: clearTimer,
        onChange: onLeaderChange,
        onSnapshot: onBroadcast
      });
      document.addEventListener('visibilitychange', onVisibilityChange);
      scheduler.start();
      leader.start();
    }

    function stop() {
      if (!started) return;
      started = false;
      epoch += 1;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      leader.stop();
      scheduler.clear();
      view.destroy();
      leader = null;
      scheduler = null;
      view = null;
      lastView = null;
    }

    function setSheetOpen(open) {
      sheetOpen = Boolean(open);
      if (!scheduler) return;
      scheduler.reschedule('poll');
      scheduler.reschedule('tick');
    }

    function refresh() {
      if (scheduler && isLeader()) scheduler.trigger('poll');
    }

    return Object.freeze({
      start,
      stop,
      setSheetOpen,
      refresh,
      isStarted: () => started,
      isLeader,
      viewModel: () => lastView
    });
  }

  return Object.freeze({ createLiteEngine });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/lite-engine.test.js`
Expected: `# tests 12`, `# pass 12`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lite/engine.js test/lite-engine.test.js
git commit -m "feat(lite): compose the lite engine with idempotent start and stop" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Module inventory, bundle smoke test, full verification

**Why the modules are not added to `DIRECT_SUPPORT_MODULES` yet:** `scripts/build.js` bundles every `DIRECT_SUPPORT_MODULES` entry into the 0.7.3 review artifact, and `docs/review/BUILD-MANIFEST.json` pins that artifact's SHA-256, size and source commit. Adding the lite modules there while the version is still 0.7.3 changes the artifact and fails three existing pinned-release tests (`release validation accepts self-contained artifacts…` and `release verification compares every direct support module byte-for-byte…` in `test/release-dependency-verification.test.js`, `immutable review verifier accepts the exact pinned candidate…` in `test/review-artifact-verifier.test.js`). Changing the version or the pin belongs to the 1.0 release work in Plan 3. This task therefore adds a separate, frozen `LITE_ENGINE_MODULES` inventory (load order) and proves, with the same `bundledModule` wrapper `build.js` uses, that the modules work bundled without `require`. Plan 3 moves the list into `DIRECT_SUPPORT_MODULES` (and `REQUIRED` in `test/direct-only-build.test.js`) together with the new entry point and version.

**Files:**
- Modify: `scripts/client-modules.js` (whole file shown below)
- Test: `test/lite-bundle.test.js`

**Interfaces:**
- Consumes: every module from Tasks 1–8; `bundledModule(relativePath)` from `scripts/build.js`; the test helpers.
- Produces: `require('./scripts/client-modules').LITE_ENGINE_MODULES` — frozen, in load order: `src/lite/pill-state.js`, `src/lite/scheduler.js`, `src/lite/snapshot-cache.js`, `src/lite/tab-leader.js`, `src/lite/state-client.js`, `src/lite/icons.js`, `src/lite/tokens.js`, `src/lite/pill-view.js`, `src/lite/engine.js`. When bundled they must follow `src/direct-api-client.js` and `src/versioning.js`.

- [ ] **Step 1: Write the failing test**

`test/lite-bundle.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES } = require('../scripts/client-modules');
const { bundledModule } = require('../scripts/build');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createFakeDocument, createFakeWindow } = require('./helpers/fake-dom');

const root = path.resolve(__dirname, '..');

const EXPECTED = [
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js'
];

const GLOBALS = {
  'src/lite/pill-state.js': 'ReviveRelayLitePillState',
  'src/lite/scheduler.js': 'ReviveRelayLiteScheduler',
  'src/lite/snapshot-cache.js': 'ReviveRelayLiteSnapshotCache',
  'src/lite/tab-leader.js': 'ReviveRelayLiteTabLeader',
  'src/lite/state-client.js': 'ReviveRelayLiteStateClient',
  'src/lite/icons.js': 'ReviveRelayLiteIcons',
  'src/lite/tokens.js': 'ReviveRelayLiteTokens',
  'src/lite/pill-view.js': 'ReviveRelayLitePillView',
  'src/lite/engine.js': 'ReviveRelayLiteEngine'
};

const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

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

test('each lite module is a UMD file that sets exactly one ReviveRelayLite global', () => {
  for (const modulePath of LITE_ENGINE_MODULES) {
    const source = read(modulePath);
    const globals = [...source.matchAll(/root\.(\w+)\s*=\s*api;/g)].map(match => match[1]);
    assert.deepEqual(globals, [GLOBALS[modulePath]], modulePath);
    assert.match(source, /^\(function \(root, factory\) \{\n  const api = factory\(\);\n  if \(typeof module === 'object' && module\.exports\) module\.exports = api;/, modulePath);
    assert.match(source, /'use strict';/, modulePath);
  }
});

test('lite sources avoid dynamic HTML, dynamic code, fetch and remote dependencies', () => {
  for (const modulePath of LITE_ENGINE_MODULES) {
    const source = read(modulePath);
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, modulePath);
    assert.doesNotMatch(source, /\beval\s*\(|\bnew\s+Function\s*\(/, modulePath);
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket/, modulePath);
    assert.doesNotMatch(source, /^\/\/\s*@require/m, modulePath);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/, modulePath);
  }
});

test('bundled exactly as build.js would, the lite modules resolve each other through globals without require', async () => {
  const bundle = ['src/direct-api-client.js', 'src/versioning.js', ...LITE_ENGINE_MODULES].map(bundledModule).join('\n\n');
  const sandbox = vm.createContext({});
  vm.runInContext(bundle, sandbox, { filename: 'lite-bundle.js' });
  for (const name of Object.values(GLOBALS)) assert.equal(typeof sandbox[name], 'object', name);
  assert.equal(vm.runInContext('typeof require', sandbox), 'undefined');

  const stateClient = sandbox.ReviveRelayLiteStateClient.createStateClient({
    baseUrl: 'https://reviverelay.voidsmithindustries.com/review',
    request: async () => ({ status: 401, body: { error: 'AUTH_REQUIRED' } })
  });
  await assert.rejects(stateClient.getState(), error => error.name === 'DirectApiClientError' && error.code === 'AUTH_REQUIRED');

  const clock = createFakeTimers();
  const document = createFakeDocument();
  const values = {};
  const engine = sandbox.ReviveRelayLiteEngine.createLiteEngine({
    api: { getState: async () => ({ notModified: false, snapshot: { stateVersion: '0123456789abcdef', nextPollMs: 60000, me: { roles: ['requester'], verification: { usable: true, requester: true, reviver: false } }, activeRequest: null, activeTransactions: [], revivers: { online: 0 }, queue: null } }) },
    window: createFakeWindow(),
    document,
    storage: { get: (key, fallback) => (key in values ? values[key] : fallback), set: (key, value) => { values[key] = value; } },
    clock
  });
  engine.start();
  await clock.advance(0);
  assert.equal(engine.viewModel().text, 'Revive me');
  assert.ok(document.getElementById('reviverelay-lite-root'));
  engine.stop();
  assert.equal(clock.pending(), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/lite-bundle.test.js`
Expected: FAIL, the first test throws `TypeError: LITE_ENGINE_MODULES is not iterable` (and the others fail the same way).

- [ ] **Step 3: Export the inventory**

Replace `scripts/client-modules.js` with:

```js
'use strict';

const DIRECT_SUPPORT_MODULES = Object.freeze([
  'src/platform.js',
  'src/core.js',
  'src/direct-api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  'src/sidebar-action.js'
]);

// ReviveRelay 1.0 Lite engine (load order). Not bundled into the pinned 0.7.3 review
// artifact; Plan 3 moves these into DIRECT_SUPPORT_MODULES with the 1.0 entry point.
const LITE_ENGINE_MODULES = Object.freeze([
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js'
]);

module.exports = { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES };
```

- [ ] **Step 4: Run the new test**

Run: `node --test test/lite-bundle.test.js`
Expected: `# tests 4`, `# pass 4`, `# fail 0`.

- [ ] **Step 5: Run the whole client suite on a fresh build**

Run: `npm run build && node --test test`
Expected: build prints `Built immutable ReviveRelay 0.7.3 review artifact at e661af8a… (reproduced from pinned manifest)`; suite ends with `# tests 507`, `# pass 507`, `# fail 0` (316 existing + 188 new tests + 3 helper files).

- [ ] **Step 6: Prove the pinned 0.7.3 artifact and the review audit are unchanged**

Run: `node scripts/verify-review-artifact.js && npm run audit:review`
Expected: the verifier prints the pinned manifest identity (no error), and the audit prints `"ok": true` with `"findings": []`.

Run: `git diff --stat origin/feat/reviverelay-1.0-server-state -- torn-revive-chat-collector.user.js docs/review dist server`
Expected: no output (MAIN, the pinned review documents, the build output and the server are untouched).

- [ ] **Step 7: Confirm the server suite is unaffected**

Run (with `TEST_DATABASE_URL` from Setup): `(cd server && npm test) 2>&1 | grep -E '^# (tests|pass|fail)'`
Expected: identical to the Setup baseline (on 2026-11-25: `# tests 401`, `# pass 399`, `# fail 2`, the two pre-existing `admin-pro` date failures).

- [ ] **Step 8: Commit**

```bash
git add scripts/client-modules.js test/lite-bundle.test.js
git commit -m "build(lite): add lite engine module inventory and bundle smoke test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Clean up the test database**

```bash
docker stop rr-plan2-testdb
```

## Out of scope for this plan

- Wiring the engine into a userscript entry point, bundling it, the version bump and repinning `BUILD-MANIFEST.json` (Plan 3).
- The expanded sheet, reviver queue rows, inline badges (and the GM-storage copy of the badge cache), notifications and sound, settings and Pro tabs, settings migration from 0.7.x keys, `requestIdleCallback` deferral, Torn SPA navigation observer (Plan 3).
- The automated performance harness and the visual screenshot review (Plan 3). This plan's tests already pin the per-tab parts of the budgets: one timer, zero timers and zero requests while hidden, one poller across tabs, ≤ 30 collapsed DOM nodes.
- Confirming `HEADER_SLOT_SELECTORS` against live Torn desktop and TornPDA markup (Plan 3 visual review; the list is injectable and the launcher fallback keeps the pill usable meanwhile).

## Self-review

- Spec coverage: requester table, reviver mapping and freshness overrides → Task 1; cadence table, `nextPollMs` bounds, back-off, one timer, hidden = zero work → Task 2; cache ages and no older-overwrites-newer → Task 3; Web Locks, heartbeat fallback, TornPDA solo, hand-off ≤ 5 s, `rr-state` broadcast → Task 4; `/v1/state` with ETag/304, shared headers and error mapping, badge LRU 200/10 min → Task 5; 16 icons, tokens, accent, tones, motion → Task 6; one shadow root, header slot with launcher fallback, light/dark, reduced motion, ≤ 30 nodes, no `innerHTML` → Task 7; boot paints from cache, leader polls and broadcasts, followers render, idempotent lifecycle → Task 8; bundling without `require`, inventory, existing suites unchanged → Task 9.
- Names used across tasks: `derivePill`, `FRESHNESS`, `createScheduler`, `pollDelayMs`, `CADENCE_MS.TICK`, `createSnapshotCache`, `SNAPSHOT_KEY`, `createTabLeader`, `createStateClient`, `createIcon`, `TOKENS_CSS`, `mountPill`, `HOST_ID`, `createLiteEngine`, `LITE_ENGINE_MODULES`.
