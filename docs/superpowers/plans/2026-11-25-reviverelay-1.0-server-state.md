# ReviveRelay 1.0 Server State Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 1.0 client everything it needs from the server in one cheap poll: `GET /v1/state` (with ETag/304 and a server-chosen `nextPollMs`), a privacy-safe "revivers online" count, hospital time and abroad data on queue rows, and a player badge lookup.

**Architecture:** One additive migration (presence column on `sessions`, requester status columns on `revive_requests`). Sessions record `last_seen_at` on authenticated requests (throttled to one write per minute). A new worker job refreshes each available request's hospital/abroad status from the requester's own verification credential once a minute. A new `state` route composes existing repositories into one response; existing endpoints are untouched, so 0.7.x clients keep working.

**Tech Stack:** Node 20, Fastify 4, `@fastify/rate-limit`, PostgreSQL 16 via `pg`, `zod`, `node:test`. Tests that touch the database use `withDisposableDatabase` from `server/test-support/database.js` and need `TEST_DATABASE_URL`.

**Plan series:** This is Plan 1. Plan 2 (client engine: scheduler, tab leader, store, cache, shadow root, header pill) and Plan 3 (client features: requester sheet, reviver queue, badges, notifications, settings/Pro, performance harness, release) are written after this plan lands, against the API delivered here.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-25-reviverelay-1.0-lite-redesign-design.md`.
- The server is the source of truth; nothing here may manufacture success. Unknown data is returned as `null`, never guessed.
- `revivers.online` is an aggregate count only: no identities, ever.
- Hospital/abroad refresh: at most once per minute per active request, using the requester's existing verification credential (Profile scope already disclosed). No new Torn API scopes.
- Existing endpoints and their responses must not change, except that queue rows gain `hospitalUntil` and `abroad` fields.
- Server-suggested poll interval (`nextPollMs`): 5000 ms with an open request or transaction, 20000 ms for revivers, 60000 ms otherwise.
- Code style: CommonJS, two-space indent, single quotes, the existing repository pattern (`async function x(pool, input)` plus a `createXRepository(pool)` factory).
- Commit after every task. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Setup (once, before Task 1)

Run from the repository root on a branch cut from `main` (e.g. `feat/reviverelay-1.0-server-state`).

```bash
cd server && npm install
docker run -d --rm --name rr-plan1-testdb -e POSTGRES_PASSWORD=test -p 127.0.0.1:55440:5432 postgres:16-alpine
export TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55440/postgres
```

All `node --test` commands below run from `server/` with `TEST_DATABASE_URL` exported.

## File Structure

| File | Responsibility |
| --- | --- |
| Create `server/src/db/migrations/008_lite_state.sql` | Presence and requester-status columns |
| Modify `server/src/db/sessions.js` | `touch()` throttled `last_seen_at` write |
| Modify `server/src/security/authenticate.js` | Best-effort `touch()` after successful auth |
| Create `server/src/db/presence.js` | `countOnlineRevivers()`, `getPlayerBadge()` |
| Create `server/src/torn/requester-status.js` | Pure `deriveRequesterStatus(profile)` |
| Modify `server/src/db/requests.js` | `listRequestsNeedingStatus()`, `recordRequesterStatus()` |
| Modify `server/src/db/transactions.js` | Queue rows gain `hospitalUntil`/`abroad`; `findOpenTransactionIdForUser()` |
| Create `server/src/worker/request-status-scan.js` | Recurring job refreshing requester status |
| Modify `server/src/db/jobs.js`, `server/src/worker.js` | Register and schedule `request.status-scan` |
| Modify `server/src/security/rate-limits.js` | `STATE`, `PLAYER_BADGE` limits |
| Create `server/src/routes/state.js` | `GET /v1/state` |
| Create `server/src/routes/player-badge.js` | `GET /v1/players/:tornId/badge` |
| Modify `server/src/app.js`, `server/src/server.js` | Wire presence repository and new routes |

---

### Task 1: Migration 008 (presence and requester status columns)

**Files:**
- Create: `server/src/db/migrations/008_lite_state.sql`
- Test: `server/test/db/lite-state-schema.test.js`

**Interfaces:**
- Produces: columns `sessions.last_seen_at timestamptz`, `revive_requests.hospital_until timestamptz`, `revive_requests.abroad boolean`, `revive_requests.status_checked_at timestamptz` (all nullable).

- [ ] **Step 1: Write the failing test**

`server/test/db/lite-state-schema.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');

test('008 adds presence and requester status columns', async () => {
  await withDisposableDatabase('lite_state_schema', async pool => {
    const result = await pool.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE (table_name = 'sessions' AND column_name = 'last_seen_at')
         OR (table_name = 'revive_requests' AND column_name IN ('hospital_until','abroad','status_checked_at'))
      ORDER BY table_name, column_name
    `);
    assert.deepEqual(result.rows.map(row => `${row.table_name}.${row.column_name}:${row.data_type}:${row.is_nullable}`), [
      'revive_requests.abroad:boolean:YES',
      'revive_requests.hospital_until:timestamp with time zone:YES',
      'revive_requests.status_checked_at:timestamp with time zone:YES',
      'sessions.last_seen_at:timestamp with time zone:YES'
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db/lite-state-schema.test.js`
Expected: FAIL, `actual` is `[]`.

- [ ] **Step 3: Write the migration**

`server/src/db/migrations/008_lite_state.sql`:

```sql
ALTER TABLE sessions
  ADD COLUMN last_seen_at timestamptz;

CREATE INDEX sessions_last_seen_active
  ON sessions (last_seen_at)
  WHERE revoked_at IS NULL;

ALTER TABLE revive_requests
  ADD COLUMN hospital_until timestamptz,
  ADD COLUMN abroad boolean,
  ADD COLUMN status_checked_at timestamptz;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/db/lite-state-schema.test.js test/db/migrations.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/migrations/008_lite_state.sql server/test/db/lite-state-schema.test.js
git commit -m "feat(server): add presence and requester status columns"
```

---

### Task 2: Session presence (`touch`) on authenticated requests

**Files:**
- Modify: `server/src/db/sessions.js` (add `touch` to the object returned by `createSessionRepository`)
- Modify: `server/src/security/authenticate.js` (inside `createAuthenticateRequest`, before `return {`)
- Test: `server/test/db/session-touch.test.js`, `server/test/security/authenticate-touch.test.js`

**Interfaces:**
- Consumes: `sessions.last_seen_at` (Task 1).
- Produces: `sessionRepository.touch({ sessionId: string, now: Date }) -> Promise<boolean>` (true when a write happened).

- [ ] **Step 1: Write the failing tests**

`server/test/db/session-touch.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createSessionRepository } = require('../../src/db/sessions');

test('touch writes last_seen_at at most once per 60 seconds', async () => {
  await withDisposableDatabase('session_touch', async pool => {
    const user = (await pool.query("INSERT INTO users (torn_id,current_name) VALUES (830001,'Toucher') RETURNING id")).rows[0];
    const session = (await pool.query("INSERT INTO sessions (user_id,token_hash) VALUES ($1,'touch-hash') RETURNING id", [user.id])).rows[0];
    const repo = createSessionRepository(pool);
    const t0 = new Date('2026-11-25T12:00:00Z');

    assert.equal(await repo.touch({ sessionId: session.id, now: t0 }), true);
    assert.equal(await repo.touch({ sessionId: session.id, now: new Date('2026-11-25T12:00:30Z') }), false);
    assert.equal(await repo.touch({ sessionId: session.id, now: new Date('2026-11-25T12:01:01Z') }), true);

    const row = (await pool.query('SELECT last_seen_at FROM sessions WHERE id=$1', [session.id])).rows[0];
    assert.equal(row.last_seen_at.toISOString(), '2026-11-25T12:01:01.000Z');
  });
});
```

`server/test/security/authenticate-touch.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthenticateRequest } = require('../../src/security/authenticate');

const record = {
  sessionId: 'session-1', userId: 'user-1', tornId: 1, name: 'A',
  expiresAt: null, revokedAt: null, reviverStanding: null, activeBan: false
};
const request = { headers: { authorization: 'Bearer token-1' } };
const now = new Date('2026-11-25T12:00:00Z');

test('successful authentication touches the session', async () => {
  const touched = [];
  const authenticate = createAuthenticateRequest({
    sessionRepository: { async findByTokenHash() { return record; }, async touch(input) { touched.push(input); return true; } },
    pepper: 'pepper',
    now: () => now
  });
  const user = await authenticate(request);
  assert.equal(user.userId, 'user-1');
  assert.deepEqual(touched, [{ sessionId: 'session-1', now }]);
});

test('a failing touch never fails authentication', async () => {
  const authenticate = createAuthenticateRequest({
    sessionRepository: { async findByTokenHash() { return record; }, async touch() { throw new Error('db down'); } },
    pepper: 'pepper',
    now: () => now
  });
  const user = await authenticate(request);
  assert.equal(user.sessionId, 'session-1');
});

test('repositories without touch still authenticate', async () => {
  const authenticate = createAuthenticateRequest({
    sessionRepository: { async findByTokenHash() { return record; } },
    pepper: 'pepper',
    now: () => now
  });
  assert.equal((await authenticate(request)).tornId, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/db/session-touch.test.js test/security/authenticate-touch.test.js`
Expected: FAIL (`repo.touch is not a function`; `touched` is `[]`).

- [ ] **Step 3: Implement `touch`**

In `server/src/db/sessions.js`, add after the `findByTokenHash` method (inside the returned object):

```js
    ,
    async touch({ sessionId, now = new Date() }) {
      const result = await pool.query(`
        UPDATE sessions
        SET last_seen_at = $2
        WHERE id = $1
          AND (last_seen_at IS NULL OR last_seen_at < $2::timestamptz - interval '60 seconds')
      `, [sessionId, now]);
      return result.rowCount === 1;
    }
```

(Place the comma directly after the closing `}` of `findByTokenHash` so the object literal stays valid.)

In `server/src/security/authenticate.js`, inside `authenticateRequest`, immediately before `return {` add:

```js
    if (typeof sessionRepository.touch === 'function') {
      try {
        await sessionRepository.touch({ sessionId: record.sessionId, now: now() });
      } catch (error) {
        // Presence is best-effort and must never block authentication.
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/db/session-touch.test.js test/security/authenticate-touch.test.js test/routes/auth.test.js test/routes/me.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/sessions.js server/src/security/authenticate.js server/test/db/session-touch.test.js server/test/security/authenticate-touch.test.js
git commit -m "feat(server): record throttled session presence on authentication"
```

---

### Task 3: Presence repository (revivers online and player badge)

**Files:**
- Create: `server/src/db/presence.js`
- Test: `server/test/db/presence.test.js`

**Interfaces:**
- Consumes: `sessions.last_seen_at` (Task 1, written by Task 2).
- Produces:
  - `presenceRepository.countOnlineRevivers({ now: Date, requireEntitlement: boolean, ownerTornId: number|null }) -> Promise<number>`
  - `presenceRepository.getPlayerBadge(tornId: number) -> Promise<{ tornId: number, requesterVerified: boolean, reviverVerified: boolean }>`
  - `ONLINE_WINDOW_SECONDS = 300`

A reviver counts as online when: account active; `revivers.standing = 'active'`; no active ban; a usable `transaction_verification` credential with `{"reviver":true}`; a non-revoked, non-expired session seen in the last 300 seconds; and, when `requireEntitlement`, either they are the owner or their `pro_entitlements` row is not revoked and `paid_until` or `trial_ends_at` is in the future.

- [ ] **Step 1: Write the failing test**

`server/test/db/presence.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createPresenceRepository } = require('../../src/db/presence');

const NOW = new Date('2026-11-25T12:00:00Z');
const minutesAgo = minutes => new Date(NOW.getTime() - minutes * 60000);

async function seedUser(pool, tornId, {
  reviverStanding = 'active', lastSeen = minutesAgo(1), requester = true, reviver = true,
  paidUntil = null, banned = false, credential = true
} = {}) {
  const user = (await pool.query('INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id', [tornId, `P${tornId}`])).rows[0].id;
  if (reviverStanding) await pool.query('INSERT INTO revivers (user_id,standing) VALUES ($1,$2)', [user, reviverStanding]);
  if (lastSeen) await pool.query('INSERT INTO sessions (user_id,token_hash,last_seen_at) VALUES ($1,$2,$3)', [user, `hash-${tornId}`, lastSeen]);
  if (credential) {
    await pool.query(`
      INSERT INTO api_credentials (user_id,ciphertext,iv,auth_tag,access_scope,purpose,capability,last_validated_at)
      VALUES ($1,'c','i','t','{}'::jsonb,'transaction_verification',$2::jsonb,now())
    `, [user, JSON.stringify({ requester, reviver })]);
  }
  if (paidUntil) {
    await pool.query('INSERT INTO pro_entitlements (user_id,paid_started_at,paid_until,ever_paid) VALUES ($1,$2,$3,true)', [user, minutesAgo(60 * 24), paidUntil]);
  }
  if (banned) await pool.query("INSERT INTO bans (reviver_id,reason) VALUES ($1,'test')", [user]);
  return user;
}

test('countOnlineRevivers counts only recent, eligible, entitled revivers', async () => {
  await withDisposableDatabase('presence_online', async pool => {
    const future = new Date('2026-12-25T00:00:00Z');
    await seedUser(pool, 840001, { paidUntil: future });                       // counts
    await seedUser(pool, 840002, { paidUntil: future, lastSeen: minutesAgo(10) }); // stale
    await seedUser(pool, 840003, {});                                            // no entitlement
    await seedUser(pool, 840004, { paidUntil: future, banned: true });           // banned
    await seedUser(pool, 840005, { paidUntil: future, reviverStanding: 'suspended' });
    await seedUser(pool, 840006, { paidUntil: future, reviver: false });         // no reviver capability
    await seedUser(pool, 3877028, {});                                           // owner, no entitlement row
    const repo = createPresenceRepository(pool);

    assert.equal(await repo.countOnlineRevivers({ now: NOW, requireEntitlement: true, ownerTornId: 3877028 }), 2);
    assert.equal(await repo.countOnlineRevivers({ now: NOW, requireEntitlement: false, ownerTornId: 3877028 }), 3);
    assert.equal(await repo.countOnlineRevivers({ now: NOW, requireEntitlement: true, ownerTornId: null }), 1);
  });
});

test('getPlayerBadge reports verification without revealing anything else', async () => {
  await withDisposableDatabase('presence_badge', async pool => {
    await seedUser(pool, 850001, { reviverStanding: null, reviver: false });
    await seedUser(pool, 850002, {});
    await seedUser(pool, 850003, { banned: true });
    await seedUser(pool, 850004, { reviverStanding: null, credential: false });
    const repo = createPresenceRepository(pool);

    assert.deepEqual(await repo.getPlayerBadge(850001), { tornId: 850001, requesterVerified: true, reviverVerified: false });
    assert.deepEqual(await repo.getPlayerBadge(850002), { tornId: 850002, requesterVerified: true, reviverVerified: true });
    assert.deepEqual(await repo.getPlayerBadge(850003), { tornId: 850003, requesterVerified: true, reviverVerified: false });
    assert.deepEqual(await repo.getPlayerBadge(850004), { tornId: 850004, requesterVerified: false, reviverVerified: false });
    assert.deepEqual(await repo.getPlayerBadge(899999), { tornId: 899999, requesterVerified: false, reviverVerified: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db/presence.test.js`
Expected: FAIL with `Cannot find module '../../src/db/presence'`.

- [ ] **Step 3: Implement the repository**

`server/src/db/presence.js`:

```js
const { TRANSACTION_CREDENTIAL_PURPOSE } = require('../security/verification-credential');

const ONLINE_WINDOW_SECONDS = 300;

async function countOnlineRevivers(pool, { now = new Date(), requireEntitlement = false, ownerTornId = null } = {}) {
  const result = await pool.query(`
    SELECT count(DISTINCT u.id)::int AS online
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.account_state = 'active'
    JOIN revivers r ON r.user_id = u.id AND r.standing = 'active'
    LEFT JOIN pro_entitlements pe ON pe.user_id = u.id
    WHERE s.revoked_at IS NULL
      AND (s.expires_at IS NULL OR s.expires_at > $1)
      AND s.last_seen_at >= $1::timestamptz - make_interval(secs => $2::double precision)
      AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.reviver_id = u.id AND b.active = true)
      AND EXISTS (
        SELECT 1 FROM api_credentials c
        WHERE c.user_id = u.id
          AND c.purpose = $3
          AND c.revoked_at IS NULL
          AND c.unusable_at IS NULL
          AND c.capability @> '{"reviver":true}'::jsonb
      )
      AND (
        NOT $4::boolean
        OR u.torn_id = $5::bigint
        OR (pe.revoked_at IS NULL AND (pe.paid_until > $1 OR pe.trial_ends_at > $1))
      )
  `, [now, ONLINE_WINDOW_SECONDS, TRANSACTION_CREDENTIAL_PURPOSE, Boolean(requireEntitlement), ownerTornId]);
  return result.rows[0].online;
}

async function getPlayerBadge(pool, tornId) {
  const result = await pool.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM api_credentials c
        WHERE c.user_id = u.id AND c.purpose = $2 AND c.revoked_at IS NULL AND c.unusable_at IS NULL
          AND c.capability @> '{"requester":true}'::jsonb
      ) AS requester_verified,
      COALESCE(r.standing = 'active', false)
        AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.reviver_id = u.id AND b.active = true)
        AND EXISTS (
          SELECT 1 FROM api_credentials c
          WHERE c.user_id = u.id AND c.purpose = $2 AND c.revoked_at IS NULL AND c.unusable_at IS NULL
            AND c.capability @> '{"reviver":true}'::jsonb
        ) AS reviver_verified
    FROM users u
    LEFT JOIN revivers r ON r.user_id = u.id
    WHERE u.torn_id = $1 AND u.account_state = 'active'
  `, [tornId, TRANSACTION_CREDENTIAL_PURPOSE]);
  const row = result.rows[0];
  return {
    tornId,
    requesterVerified: Boolean(row && row.requester_verified),
    reviverVerified: Boolean(row && row.reviver_verified)
  };
}

function createPresenceRepository(pool) {
  if (!pool || typeof pool.query !== 'function') throw new Error('PostgreSQL pool is required');
  return {
    countOnlineRevivers(input) {
      return countOnlineRevivers(pool, input);
    },
    getPlayerBadge(tornId) {
      return getPlayerBadge(pool, tornId);
    }
  };
}

module.exports = {
  ONLINE_WINDOW_SECONDS,
  countOnlineRevivers,
  getPlayerBadge,
  createPresenceRepository
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/db/presence.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/presence.js server/test/db/presence.test.js
git commit -m "feat(server): add presence repository for revivers online and player badges"
```

---

### Task 4: Requester status (derive, store, expose on queue rows)

**Files:**
- Create: `server/src/torn/requester-status.js`
- Modify: `server/src/db/requests.js` (new functions, exports, repository methods)
- Modify: `server/src/db/transactions.js` (`listAvailableRequests` SELECT and `rowToQueueRequest`)
- Test: `server/test/torn/requester-status.test.js`, `server/test/db/requester-status.test.js`

**Interfaces:**
- Produces:
  - `deriveRequesterStatus(profile) -> { hospitalUntil: Date|null, abroad: boolean|null }`
  - `requestRepository.listRequestsNeedingStatus({ now: Date, limit: number }) -> Promise<Array<{ id: string, requesterId: string }>>`
  - `requestRepository.recordRequesterStatus({ requestId: string, status: { hospitalUntil: Date|null, abroad: boolean|null } | null, checkedAt: Date }) -> Promise<boolean>`; `status: null` updates only `status_checked_at` and keeps previous values.
  - Queue rows from `listAvailableRequests` gain `hospitalUntil: Date|null` and `abroad: boolean|null`.

Abroad rule (assumption to confirm during the review alpha with a real abroad profile): Torn's `status.description` reads "In hospital for …" at home and "In a/an <Country adjective> hospital for …" abroad. Anything else yields `abroad: null`.

- [ ] **Step 1: Write the failing tests**

`server/test/torn/requester-status.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveRequesterStatus } = require('../../src/torn/requester-status');

test('home hospital yields until time and abroad false', () => {
  assert.deepEqual(
    deriveRequesterStatus({ status: { state: 'Hospital', until: 1795612800, description: 'In hospital for 2 hrs 10 mins' } }),
    { hospitalUntil: new Date(1795612800 * 1000), abroad: false }
  );
});

test('foreign hospital yields abroad true', () => {
  const result = deriveRequesterStatus({ status: { state: 'Hospital', until: 1795612800, description: 'In a Mexican hospital for 45 mins' } });
  assert.equal(result.abroad, true);
  assert.equal(deriveRequesterStatus({ status: { state: 'Hospital', until: 1795612800, description: 'In an Argentinian hospital for 3 mins' } }).abroad, true);
});

test('unrecognised description leaves abroad unknown', () => {
  assert.equal(deriveRequesterStatus({ status: { state: 'Hospital', until: 1795612800, description: 'Hospitalized by someone' } }).abroad, null);
});

test('not in hospital, missing or malformed data yields unknowns', () => {
  const unknown = { hospitalUntil: null, abroad: null };
  assert.deepEqual(deriveRequesterStatus({ status: { state: 'Okay', until: 0, description: 'Okay' } }), unknown);
  assert.deepEqual(deriveRequesterStatus({}), unknown);
  assert.deepEqual(deriveRequesterStatus(null), unknown);
  assert.deepEqual(deriveRequesterStatus({ status: { state: 'Hospital', until: 'soon', description: 'In hospital for 1 min' } }), { hospitalUntil: null, abroad: false });
});
```

`server/test/db/requester-status.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createRequestRepository } = require('../../src/db/requests');
const { listAvailableRequests } = require('../../src/db/transactions');

async function seedRequest(pool, tornId) {
  const user = (await pool.query('INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id', [tornId, `R${tornId}`])).rows[0].id;
  await pool.query(`
    INSERT INTO api_credentials (user_id,ciphertext,iv,auth_tag,access_scope,purpose,capability,last_validated_at)
    VALUES ($1,'c','i','t','{}'::jsonb,'transaction_verification','{"requester":true,"reviver":false}'::jsonb,now())
  `, [user]);
  const request = (await pool.query("INSERT INTO revive_requests (requester_id,payment_method,offer_amount,state) VALUES ($1,'cash',1000000,'AVAILABLE') RETURNING id", [user])).rows[0].id;
  return { userId: user, requestId: request };
}

test('requests needing status are listed until checked, then again after 60 seconds', async () => {
  await withDisposableDatabase('requester_status_due', async pool => {
    const repo = createRequestRepository(pool);
    const { userId, requestId } = await seedRequest(pool, 860001);
    const t0 = new Date('2026-11-25T12:00:00Z');

    assert.deepEqual(await repo.listRequestsNeedingStatus({ now: t0, limit: 25 }), [{ id: requestId, requesterId: userId }]);
    const hospitalUntil = new Date('2026-11-25T14:00:00Z');
    assert.equal(await repo.recordRequesterStatus({ requestId, status: { hospitalUntil, abroad: true }, checkedAt: t0 }), true);
    assert.deepEqual(await repo.listRequestsNeedingStatus({ now: new Date('2026-11-25T12:00:59Z'), limit: 25 }), []);
    assert.equal((await repo.listRequestsNeedingStatus({ now: new Date('2026-11-25T12:01:01Z'), limit: 25 })).length, 1);

    assert.equal(await repo.recordRequesterStatus({ requestId, status: null, checkedAt: new Date('2026-11-25T12:01:01Z') }), true);
    const row = (await pool.query('SELECT hospital_until, abroad, status_checked_at FROM revive_requests WHERE id=$1', [requestId])).rows[0];
    assert.equal(row.hospital_until.toISOString(), hospitalUntil.toISOString());
    assert.equal(row.abroad, true);
    assert.equal(row.status_checked_at.toISOString(), '2026-11-25T12:01:01.000Z');
  });
});

test('closed or non-available requests are never listed', async () => {
  await withDisposableDatabase('requester_status_closed', async pool => {
    const repo = createRequestRepository(pool);
    const { requestId } = await seedRequest(pool, 860002);
    await pool.query("UPDATE revive_requests SET state='CANCELLED_BY_REQUESTER', closed_at=now() WHERE id=$1", [requestId]);
    assert.deepEqual(await repo.listRequestsNeedingStatus({ now: new Date(), limit: 25 }), []);
  });
});

test('queue rows expose hospitalUntil and abroad', async () => {
  await withDisposableDatabase('requester_status_queue', async pool => {
    const repo = createRequestRepository(pool);
    const { requestId } = await seedRequest(pool, 860003);
    let rows = await listAvailableRequests(pool);
    assert.equal(rows[0].hospitalUntil, null);
    assert.equal(rows[0].abroad, null);

    const hospitalUntil = new Date('2026-11-25T15:30:00Z');
    await repo.recordRequesterStatus({ requestId, status: { hospitalUntil, abroad: false }, checkedAt: new Date() });
    rows = await listAvailableRequests(pool);
    assert.equal(rows[0].hospitalUntil.toISOString(), hospitalUntil.toISOString());
    assert.equal(rows[0].abroad, false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/torn/requester-status.test.js test/db/requester-status.test.js`
Expected: FAIL (`Cannot find module '../../src/torn/requester-status'`; `repo.listRequestsNeedingStatus is not a function`).

- [ ] **Step 3: Implement**

`server/src/torn/requester-status.js`:

```js
const ABROAD_HOSPITAL = /^in an? [a-z][a-z .'-]* hospital\b/i;
const HOME_HOSPITAL = /^in hospital\b/i;
const UNKNOWN = Object.freeze({ hospitalUntil: null, abroad: null });

function deriveRequesterStatus(profile) {
  const status = profile && profile.status;
  if (!status || typeof status !== 'object') return { ...UNKNOWN };
  if (String(status.state || '').trim().toLowerCase() !== 'hospital') return { ...UNKNOWN };

  const untilSeconds = Number(status.until);
  const hospitalUntil = Number.isFinite(untilSeconds) && untilSeconds > 0
    ? new Date(Math.floor(untilSeconds) * 1000)
    : null;
  const description = String(status.description || '').trim();
  let abroad = null;
  if (HOME_HOSPITAL.test(description)) abroad = false;
  else if (ABROAD_HOSPITAL.test(description)) abroad = true;
  return { hospitalUntil, abroad };
}

module.exports = {
  deriveRequesterStatus
};
```

In `server/src/db/requests.js`, add above `function createRequestRepository(pool)`:

```js
async function listRequestsNeedingStatus(pool, { now = new Date(), limit = 25 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 25));
  const result = await pool.query(`
    SELECT r.id, r.requester_id
    FROM revive_requests r
    WHERE r.state = 'AVAILABLE'
      AND r.closed_at IS NULL
      AND (r.status_checked_at IS NULL OR r.status_checked_at < $1::timestamptz - interval '60 seconds')
    ORDER BY r.status_checked_at ASC NULLS FIRST, r.created_at ASC, r.id ASC
    LIMIT $2
  `, [now, normalizedLimit]);
  return result.rows.map(row => ({ id: row.id, requesterId: row.requester_id }));
}

async function recordRequesterStatus(pool, { requestId, status, checkedAt = new Date() }) {
  const result = status
    ? await pool.query(`
        UPDATE revive_requests
        SET hospital_until = $2, abroad = $3, status_checked_at = $4
        WHERE id = $1
      `, [requestId, status.hospitalUntil, status.abroad, checkedAt])
    : await pool.query(`
        UPDATE revive_requests
        SET status_checked_at = $2
        WHERE id = $1
      `, [requestId, checkedAt]);
  return result.rowCount === 1;
}
```

Add to the object returned by `createRequestRepository`:

```js
    listRequestsNeedingStatus(input) {
      return listRequestsNeedingStatus(pool, input);
    },
    recordRequesterStatus(input) {
      return recordRequesterStatus(pool, input);
    }
```

and add `listRequestsNeedingStatus,` and `recordRequesterStatus,` to `module.exports`.

In `server/src/db/transactions.js`:
- In `listAvailableRequests`, after `r.created_at` in the SELECT list add `,\n      r.hospital_until,\n      r.abroad`.
- In `rowToQueueRequest`, after `createdAt: row.created_at` add:

```js
    ,
    hospitalUntil: row.hospital_until || null,
    abroad: typeof row.abroad === 'boolean' ? row.abroad : null
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/torn/requester-status.test.js test/db/requester-status.test.js test/routes/reviver-queue.test.js test/db/transactions-stage3.test.js`
Expected: PASS. If an existing queue test asserts a row with `deepEqual`, add `hospitalUntil: null, abroad: null` to its expected object (the response gained two fields by design).

- [ ] **Step 5: Commit**

```bash
git add server/src/torn/requester-status.js server/src/db/requests.js server/src/db/transactions.js server/test/torn/requester-status.test.js server/test/db/requester-status.test.js server/test
git commit -m "feat(server): store requester hospital/abroad status and expose it on queue rows"
```

---

### Task 5: `request.status-scan` worker job

**Files:**
- Create: `server/src/worker/request-status-scan.js`
- Modify: `server/src/db/jobs.js` (`JOB_TYPES`), `server/src/worker.js` (handler map and scheduling)
- Test: `server/test/worker/request-status-scan.test.js`

**Interfaces:**
- Consumes: `requestRepository.listRequestsNeedingStatus`, `requestRepository.recordRequesterStatus` (Task 4); `deriveRequesterStatus` (Task 4); `verificationCredentialRepository.getDecryptedActiveForUser(userId) -> { plaintextKey } | null`; `verificationCredentialRepository.markUnusable({ userId, reason, now })`; `tornClient.getUserProfile(apiKey)`; `TornApiError` from `server/src/torn/client.js`.
- Produces: `createRequestStatusScanHandler({ requestRepository, verificationCredentialRepository, tornClient, clock }) -> async () => { status: 'reschedule', runAt: Date, checked: number, refreshed: number }`; constants `REQUEST_STATUS_INTERVAL_MS = 60000`, `REQUEST_STATUS_BATCH = 25`.

- [ ] **Step 1: Write the failing test**

`server/test/worker/request-status-scan.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { TornApiError } = require('../../src/torn/client');
const { createRequestStatusScanHandler, REQUEST_STATUS_INTERVAL_MS } = require('../../src/worker/request-status-scan');

const NOW = new Date('2026-11-25T12:00:00Z');

function setup({ due, credentials = {}, profiles = {}, profileErrors = {} }) {
  const recorded = [];
  const unusable = [];
  const profileCalls = [];
  const handler = createRequestStatusScanHandler({
    requestRepository: {
      async listRequestsNeedingStatus(input) { assert.deepEqual(input, { now: NOW, limit: 25 }); return due; },
      async recordRequesterStatus(input) { recorded.push(input); return true; }
    },
    verificationCredentialRepository: {
      async getDecryptedActiveForUser(userId) { return credentials[userId] ? { plaintextKey: credentials[userId] } : null; },
      async markUnusable(input) { unusable.push(input); }
    },
    tornClient: {
      async getUserProfile(key) {
        profileCalls.push(key);
        if (profileErrors[key]) throw profileErrors[key];
        return profiles[key];
      }
    },
    clock: () => NOW
  });
  return { handler, recorded, unusable, profileCalls };
}

test('refreshes status with the requester key and reschedules in one minute', async () => {
  const s = setup({
    due: [{ id: 'req-1', requesterId: 'user-1' }],
    credentials: { 'user-1': 'key-1' },
    profiles: { 'key-1': { status: { state: 'Hospital', until: 1795612800, description: 'In a Mexican hospital for 1 hr' } } }
  });
  const result = await s.handler();
  assert.deepEqual(s.profileCalls, ['key-1']);
  assert.deepEqual(s.recorded, [{ requestId: 'req-1', status: { hospitalUntil: new Date(1795612800 * 1000), abroad: true }, checkedAt: NOW }]);
  assert.deepEqual(result, { status: 'reschedule', runAt: new Date(NOW.getTime() + REQUEST_STATUS_INTERVAL_MS), checked: 1, refreshed: 1 });
});

test('missing credential or Torn failure only marks the request checked', async () => {
  const s = setup({
    due: [{ id: 'req-1', requesterId: 'user-1' }, { id: 'req-2', requesterId: 'user-2' }],
    credentials: { 'user-2': 'key-2' },
    profileErrors: { 'key-2': new Error('network') }
  });
  const result = await s.handler();
  assert.deepEqual(s.recorded, [
    { requestId: 'req-1', status: null, checkedAt: NOW },
    { requestId: 'req-2', status: null, checkedAt: NOW }
  ]);
  assert.equal(result.refreshed, 0);
  assert.deepEqual(s.unusable, []);
});

test('an invalid Torn key marks the credential unusable', async () => {
  const s = setup({
    due: [{ id: 'req-1', requesterId: 'user-1' }],
    credentials: { 'user-1': 'key-1' },
    profileErrors: { 'key-1': new TornApiError('TORN_INVALID_KEY', 'Incorrect key') }
  });
  await s.handler();
  assert.deepEqual(s.unusable, [{ userId: 'user-1', reason: 'TORN_INVALID_KEY', now: NOW }]);
  assert.deepEqual(s.recorded, [{ requestId: 'req-1', status: null, checkedAt: NOW }]);
});
```

(`TornApiError`'s constructor is `(code, message, options)`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/worker/request-status-scan.test.js`
Expected: FAIL with `Cannot find module '../../src/worker/request-status-scan'`.

- [ ] **Step 3: Implement the handler**

`server/src/worker/request-status-scan.js`:

```js
const { TornApiError } = require('../torn/client');
const { deriveRequesterStatus } = require('../torn/requester-status');

const REQUEST_STATUS_INTERVAL_MS = 60 * 1000;
const REQUEST_STATUS_BATCH = 25;

function createRequestStatusScanHandler({ requestRepository, verificationCredentialRepository, tornClient, clock = () => new Date() }) {
  if (!requestRepository ||
      typeof requestRepository.listRequestsNeedingStatus !== 'function' ||
      typeof requestRepository.recordRequesterStatus !== 'function') {
    throw new Error('requestRepository status methods are required');
  }
  if (!verificationCredentialRepository || typeof verificationCredentialRepository.getDecryptedActiveForUser !== 'function') {
    throw new Error('verificationCredentialRepository is required');
  }
  if (!tornClient || typeof tornClient.getUserProfile !== 'function') throw new Error('tornClient.getUserProfile is required');

  return async function requestStatusScanHandler() {
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('clock returned an invalid date');

    const due = await requestRepository.listRequestsNeedingStatus({ now, limit: REQUEST_STATUS_BATCH });
    let refreshed = 0;
    for (const row of due) {
      let status = null;
      try {
        const credential = await verificationCredentialRepository.getDecryptedActiveForUser(row.requesterId);
        if (credential) {
          status = deriveRequesterStatus(await tornClient.getUserProfile(credential.plaintextKey));
          refreshed += 1;
        }
      } catch (error) {
        if (error instanceof TornApiError && error.code === 'TORN_INVALID_KEY' &&
            typeof verificationCredentialRepository.markUnusable === 'function') {
          await verificationCredentialRepository.markUnusable({ userId: row.requesterId, reason: 'TORN_INVALID_KEY', now });
        }
      }
      await requestRepository.recordRequesterStatus({ requestId: row.id, status, checkedAt: now });
    }

    return {
      status: 'reschedule',
      runAt: new Date(now.getTime() + REQUEST_STATUS_INTERVAL_MS),
      checked: due.length,
      refreshed
    };
  };
}

module.exports = {
  REQUEST_STATUS_INTERVAL_MS,
  REQUEST_STATUS_BATCH,
  createRequestStatusScanHandler
};
```

- [ ] **Step 4: Register and schedule the job**

In `server/src/db/jobs.js`, add `'request.status-scan'` as the last entry of `JOB_TYPES`.

In `server/src/worker.js`:
1. Add near the other handler imports: `const { createRequestStatusScanHandler } = require('./worker/request-status-scan');` and `const { createRequestRepository } = require('./db/requests');` (skip the second if already imported).
2. Add a `requestStatusScanHandler = null` parameter to `buildStageThreeHandlers` and, before the final `return [type, unimplementedHandler(...)]`, add:

```js
    if (type === 'request.status-scan' && typeof requestStatusScanHandler === 'function') return [type, requestStatusScanHandler];
```

3. In `start()`, after the `telemetry.retention` `enqueueUniqueJob` call, add:

```js
  const requestStatusScanHandler = createRequestStatusScanHandler({
    requestRepository: createRequestRepository(pool),
    verificationCredentialRepository,
    tornClient
  });
  await jobRepository.enqueueUniqueJob({
    type: 'request.status-scan',
    runAt: new Date(),
    dedupeKey: 'request.status-scan:available-requests',
    payload: {}
  });
```

4. Pass `requestStatusScanHandler` into the `buildStageThreeHandlers({...})` call in `start()`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/worker/request-status-scan.test.js test/db/jobs.test.js test/worker`
Expected: PASS. If a worker test enumerates `JOB_TYPES` or the handler map exactly, add `'request.status-scan'` to its expectation.

- [ ] **Step 6: Commit**

```bash
git add server/src/worker/request-status-scan.js server/src/db/jobs.js server/src/worker.js server/test
git commit -m "feat(server): refresh available requests' hospital status every minute"
```

---

### Task 6: Open transaction lookup

**Files:**
- Modify: `server/src/db/transactions.js`
- Test: `server/test/db/open-transaction.test.js`

**Interfaces:**
- Produces: `transactionRepository.findOpenTransactionIdForUser(userId: string) -> Promise<string|null>`: id of the newest transaction with `closed_at IS NULL` where the user is requester or reviver.

- [ ] **Step 1: Write the failing test**

`server/test/db/open-transaction.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { acceptRequest, createTransactionRepository } = require('../../src/db/transactions');

test('finds the open transaction for requester and reviver, and nothing once closed', async () => {
  await withDisposableDatabase('open_transaction', async pool => {
    const requester = (await pool.query("INSERT INTO users (torn_id,current_name) VALUES (870001,'Req') RETURNING id")).rows[0].id;
    const reviver = (await pool.query("INSERT INTO users (torn_id,current_name) VALUES (870002,'Rev') RETURNING id")).rows[0].id;
    const bystander = (await pool.query("INSERT INTO users (torn_id,current_name) VALUES (870003,'Other') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO revivers (user_id,standing) VALUES ($1,'active')", [reviver]);
    await pool.query(`
      INSERT INTO api_credentials (user_id,ciphertext,iv,auth_tag,access_scope,purpose,capability,last_validated_at)
      VALUES ($1,'c','i','t','{}'::jsonb,'transaction_verification','{"requester":true,"reviver":false}'::jsonb,now())
    `, [requester]);
    const requestId = (await pool.query("INSERT INTO revive_requests (requester_id,payment_method,offer_amount,state) VALUES ($1,'cash',500000,'AVAILABLE') RETURNING id", [requester])).rows[0].id;
    const repo = createTransactionRepository(pool);

    assert.equal(await repo.findOpenTransactionIdForUser(requester), null);
    const accepted = await acceptRequest(pool, { requestId, reviverId: reviver, now: new Date('2026-11-25T12:00:00Z') });
    assert.equal(accepted.accepted, true);

    assert.equal(await repo.findOpenTransactionIdForUser(requester), accepted.transaction.id);
    assert.equal(await repo.findOpenTransactionIdForUser(reviver), accepted.transaction.id);
    assert.equal(await repo.findOpenTransactionIdForUser(bystander), null);

    await pool.query('UPDATE transactions SET closed_at=now() WHERE id=$1', [accepted.transaction.id]);
    assert.equal(await repo.findOpenTransactionIdForUser(requester), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db/open-transaction.test.js`
Expected: FAIL with `repo.findOpenTransactionIdForUser is not a function`.

- [ ] **Step 3: Implement**

In `server/src/db/transactions.js`, add above `function createTransactionRepository(pool)`:

```js
async function findOpenTransactionIdForUser(pool, userId) {
  const result = await pool.query(`
    SELECT id
    FROM transactions
    WHERE closed_at IS NULL
      AND (requester_id = $1 OR reviver_id = $1)
    ORDER BY accepted_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  `, [userId]);
  return result.rowCount === 1 ? result.rows[0].id : null;
}
```

Add to the repository object:

```js
    findOpenTransactionIdForUser(userId) {
      return findOpenTransactionIdForUser(pool, userId);
    },
```

and add `findOpenTransactionIdForUser,` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/db/open-transaction.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/transactions.js server/test/db/open-transaction.test.js
git commit -m "feat(server): look up a user's open transaction"
```

---

### Task 7: `GET /v1/state`

**Files:**
- Create: `server/src/routes/state.js`
- Modify: `server/src/security/rate-limits.js`
- Test: `server/test/routes/state.test.js`

**Interfaces:**
- Consumes: `requestRepository.getActiveRequest(userId)`; `transactionRepository.findOpenTransactionIdForUser(userId)` (Task 6), `transactionRepository.getTransactionForUser({ transactionId, userId })`, `transactionRepository.listAvailableRequests()`; `entitlementRepository.getStatus(userId, now)`; `presenceRepository.countOnlineRevivers(...)` (Task 3, optional); `publicSubscriptionState`, `subscriptionRequiresEntitlement` from `server/src/domain/subscription-mode.js`; `publicProPlans` from `server/src/domain/pro-plans.js`; `resolvePublicProStatus` from `server/src/security/pro-access.js`.
- Produces: `registerStateRoute(app, { requestRepository, transactionRepository, entitlementRepository, presenceRepository, config, clock })`; `STATE_POLL_MS = { ACTIVE: 5000, REVIVER: 20000, IDLE: 60000 }`; `computeStateVersion(payload) -> string` (16 hex chars).

Response body (200):

```json
{
  "stateVersion": "16 hex chars",
  "nextPollMs": 5000,
  "me": { "tornId": 1, "name": "A", "roles": ["requester"] },
  "pro": { "...": "resolvePublicProStatus output" },
  "activeRequest": { "id": "uuid", "state": "AVAILABLE", "paymentMethod": "cash", "offerAmount": 1000000, "createdAt": "ISO", "transactionId": null },
  "activeTransaction": { "...": "getTransactionForUser output" },
  "revivers": { "online": 3 },
  "queue": { "count": 4 }
}
```

`activeRequest`, `activeTransaction` and `queue` may be `null`; `revivers.online` is `null` when no presence repository is configured. `queue` is non-null only for users whose roles include `reviver` (the count only; rows stay behind the gated `GET /v1/reviver/queue`). `stateVersion` hashes every field except `stateVersion` and `nextPollMs`. The response carries `ETag: "<stateVersion>"` and `Cache-Control: no-store`; a request whose `If-None-Match` equals that ETag gets `304` with no body.

- [ ] **Step 1: Write the failing test**

`server/test/routes/state.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const fastifyRateLimit = require('@fastify/rate-limit');
const { registerStateRoute, STATE_POLL_MS } = require('../../src/routes/state');

const NOW = new Date('2026-11-25T12:00:00Z');
const REQUESTER = { sessionId: 's1', userId: 'user-1', tornId: 111, name: 'Req', roles: ['requester'] };
const REVIVER = { sessionId: 's2', userId: 'user-2', tornId: 222, name: 'Rev', roles: ['requester', 'reviver'] };

async function makeApp({ user = REQUESTER, activeRequest = null, openTransactionId = null, transaction = null, queue = [], online = 3, presence = true } = {}) {
  const app = Fastify();
  await app.register(fastifyRateLimit, { global: false });
  app.decorateRequest('reviveRelayUser', null);
  app.decorate('authenticate', async request => { request.reviveRelayUser = user; });
  const calls = { online: [] };
  await registerStateRoute(app, {
    requestRepository: { async getActiveRequest(userId) { assert.equal(userId, user.userId); return activeRequest; } },
    transactionRepository: {
      async findOpenTransactionIdForUser() { return openTransactionId; },
      async getTransactionForUser(input) { assert.deepEqual(input, { transactionId: openTransactionId, userId: user.userId }); return transaction; },
      async listAvailableRequests() { return queue; }
    },
    entitlementRepository: { async getStatus() { return { state: 'NONE', trialEligible: true, trialStartedAt: null, validUntil: null }; } },
    presenceRepository: presence ? { async countOnlineRevivers(input) { calls.online.push(input); return online; } } : null,
    config: { SUBSCRIPTION_MODE: 'review', PRO_RECEIVER_TORN_ID: 3877028 },
    clock: () => NOW
  });
  return { app, calls };
}

test('idle requester gets a 60s poll, online count and no queue', async t => {
  const { app, calls } = await makeApp();
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/state' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.nextPollMs, STATE_POLL_MS.IDLE);
  assert.deepEqual(body.me, { tornId: 111, name: 'Req', roles: ['requester'] });
  assert.equal(body.activeRequest, null);
  assert.equal(body.activeTransaction, null);
  assert.deepEqual(body.revivers, { online: 3 });
  assert.equal(body.queue, null);
  assert.match(body.stateVersion, /^[0-9a-f]{16}$/);
  assert.equal(response.headers.etag, `"${body.stateVersion}"`);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(calls.online, [{ now: NOW, requireEntitlement: true, ownerTornId: 3877028 }]);
  assert.ok(body.pro);
});

test('active request or transaction polls every 5s and includes both', async t => {
  const activeRequest = { id: 'r-1', requesterId: 'user-1', state: 'AVAILABLE', paymentMethod: 'cash', offerAmount: 1000000, createdAt: new Date('2026-11-25T11:59:00Z'), transactionId: 'tx-1', comment: null };
  const transaction = { id: 'tx-1', state: 'WAITING_FOR_PAYMENT', participantRole: 'requester' };
  const { app } = await makeApp({ activeRequest, openTransactionId: 'tx-1', transaction });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.equal(body.nextPollMs, STATE_POLL_MS.ACTIVE);
  assert.deepEqual(body.activeRequest, { id: 'r-1', state: 'AVAILABLE', paymentMethod: 'cash', offerAmount: 1000000, createdAt: '2026-11-25T11:59:00.000Z', transactionId: 'tx-1' });
  assert.deepEqual(body.activeTransaction, transaction);
});

test('reviver without a transaction gets queue count and a 20s poll', async t => {
  const { app } = await makeApp({ user: REVIVER, queue: [{ id: 'a' }, { id: 'b' }] });
  t.after(() => app.close());
  const body = (await app.inject({ method: 'GET', url: '/v1/state' })).json();
  assert.deepEqual(body.queue, { count: 2 });
  assert.equal(body.nextPollMs, STATE_POLL_MS.REVIVER);
});

test('matching If-None-Match returns 304 with no body', async t => {
  const { app } = await makeApp();
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/v1/state' });
  const second = await app.inject({ method: 'GET', url: '/v1/state', headers: { 'if-none-match': first.headers.etag } });
  assert.equal(second.statusCode, 304);
  assert.equal(second.body, '');
});

test('state changes produce a different version', async t => {
  const a = await makeApp({ online: 3 });
  const b = await makeApp({ online: 4 });
  t.after(() => Promise.all([a.app.close(), b.app.close()]));
  const va = (await a.app.inject({ method: 'GET', url: '/v1/state' })).json().stateVersion;
  const vb = (await b.app.inject({ method: 'GET', url: '/v1/state' })).json().stateVersion;
  assert.notEqual(va, vb);
});

test('without a presence repository the online count is null', async t => {
  const { app } = await makeApp({ presence: false });
  t.after(() => app.close());
  assert.deepEqual((await app.inject({ method: 'GET', url: '/v1/state' })).json().revivers, { online: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes/state.test.js`
Expected: FAIL with `Cannot find module '../../src/routes/state'`.

- [ ] **Step 3: Add rate limits**

In `server/src/security/rate-limits.js`, add inside the frozen object:

```js
  STATE: Object.freeze({ max: 30, timeWindow: '1 minute' }),
  PLAYER_BADGE: Object.freeze({ max: 60, timeWindow: '1 minute' }),
```

- [ ] **Step 4: Implement the route**

`server/src/routes/state.js`:

```js
const crypto = require('node:crypto');
const { RATE_LIMITS } = require('../security/rate-limits');
const { publicProPlans } = require('../domain/pro-plans');
const { publicSubscriptionState, subscriptionRequiresEntitlement } = require('../domain/subscription-mode');
const { resolvePublicProStatus } = require('../security/pro-access');

const STATE_POLL_MS = Object.freeze({ ACTIVE: 5000, REVIVER: 20000, IDLE: 60000 });

function computeStateVersion(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex').slice(0, 16);
}

function publicActiveRequest(request) {
  if (!request) return null;
  return {
    id: request.id,
    state: request.state,
    paymentMethod: request.paymentMethod,
    offerAmount: request.offerAmount,
    createdAt: request.createdAt,
    transactionId: request.transactionId || null
  };
}

async function registerStateRoute(app, {
  requestRepository,
  transactionRepository,
  entitlementRepository = null,
  presenceRepository = null,
  config = {},
  clock = () => new Date()
}) {
  if (typeof app.authenticate !== 'function') throw new Error('state route requires session authentication');
  if (!requestRepository || typeof requestRepository.getActiveRequest !== 'function') throw new Error('requestRepository is required');
  if (!transactionRepository ||
      typeof transactionRepository.findOpenTransactionIdForUser !== 'function' ||
      typeof transactionRepository.getTransactionForUser !== 'function' ||
      typeof transactionRepository.listAvailableRequests !== 'function') {
    throw new Error('transactionRepository is required');
  }

  const subscription = publicSubscriptionState({
    mode: config.SUBSCRIPTION_MODE,
    receiverTornId: config.PRO_RECEIVER_TORN_ID,
    plans: publicProPlans()
  });
  const requireEntitlement = subscriptionRequiresEntitlement(config.SUBSCRIPTION_MODE);
  const ownerTornId = Number(config.PRO_RECEIVER_TORN_ID) || null;

  app.get('/v1/state', {
    preHandler: app.authenticate,
    config: { rateLimit: RATE_LIMITS.STATE }
  }, async (request, reply) => {
    const user = request.reviveRelayUser;
    const now = clock();
    const isReviver = Array.isArray(user.roles) && user.roles.includes('reviver');

    const [activeRequest, openTransactionId, status, online, queueRows] = await Promise.all([
      requestRepository.getActiveRequest(user.userId),
      transactionRepository.findOpenTransactionIdForUser(user.userId),
      entitlementRepository && typeof entitlementRepository.getStatus === 'function'
        ? entitlementRepository.getStatus(user.userId, now)
        : { state: 'NONE', trialEligible: true, trialStartedAt: null, validUntil: null },
      presenceRepository && typeof presenceRepository.countOnlineRevivers === 'function'
        ? presenceRepository.countOnlineRevivers({ now, requireEntitlement, ownerTornId })
        : null,
      isReviver ? transactionRepository.listAvailableRequests() : null
    ]);
    const activeTransaction = openTransactionId
      ? await transactionRepository.getTransactionForUser({ transactionId: openTransactionId, userId: user.userId })
      : null;

    const payload = {
      me: { tornId: user.tornId, name: user.name, roles: user.roles },
      pro: resolvePublicProStatus({ status, tornId: user.tornId, subscription }),
      activeRequest: publicActiveRequest(activeRequest),
      activeTransaction: activeTransaction || null,
      revivers: { online: typeof online === 'number' ? online : null },
      queue: isReviver ? { count: Array.isArray(queueRows) ? queueRows.length : 0 } : null
    };
    const serialized = JSON.parse(JSON.stringify(payload));
    const stateVersion = computeStateVersion(serialized);
    const etag = `"${stateVersion}"`;

    let nextPollMs = STATE_POLL_MS.IDLE;
    if (serialized.activeRequest || serialized.activeTransaction) nextPollMs = STATE_POLL_MS.ACTIVE;
    else if (isReviver) nextPollMs = STATE_POLL_MS.REVIVER;

    reply.header('ETag', etag);
    reply.header('Cache-Control', 'no-store');
    if (request.headers['if-none-match'] === etag) {
      return reply.code(304).send();
    }
    return reply.code(200).send({ stateVersion, nextPollMs, ...serialized });
  });
}

module.exports = {
  STATE_POLL_MS,
  computeStateVersion,
  registerStateRoute
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/routes/state.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/state.js server/src/security/rate-limits.js server/test/routes/state.test.js
git commit -m "feat(server): add aggregated GET /v1/state with ETag and server-chosen poll interval"
```

---

### Task 8: `GET /v1/players/:tornId/badge`

**Files:**
- Create: `server/src/routes/player-badge.js`
- Test: `server/test/routes/player-badge.test.js`

**Interfaces:**
- Consumes: `presenceRepository.getPlayerBadge(tornId)` (Task 3); `RATE_LIMITS.PLAYER_BADGE` (Task 7).
- Produces: `registerPlayerBadgeRoute(app, { presenceRepository })`. Response `200 { tornId, requesterVerified, reviverVerified }`, `422 { error: 'INVALID_TORN_ID' }`, header `Cache-Control: private, max-age=600`.

- [ ] **Step 1: Write the failing test**

`server/test/routes/player-badge.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const fastifyRateLimit = require('@fastify/rate-limit');
const { registerPlayerBadgeRoute } = require('../../src/routes/player-badge');

async function makeApp(seen = []) {
  const app = Fastify();
  await app.register(fastifyRateLimit, { global: false });
  app.decorateRequest('reviveRelayUser', null);
  app.decorate('authenticate', async request => { request.reviveRelayUser = { userId: 'u', tornId: 1, roles: ['requester'] }; });
  await registerPlayerBadgeRoute(app, {
    presenceRepository: { async getPlayerBadge(tornId) { seen.push(tornId); return { tornId, requesterVerified: true, reviverVerified: false }; } }
  });
  return app;
}

test('returns the badge for a numeric Torn id with a 10 minute private cache', async t => {
  const seen = [];
  const app = await makeApp(seen);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/players/3532145/badge' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { tornId: 3532145, requesterVerified: true, reviverVerified: false });
  assert.equal(response.headers['cache-control'], 'private, max-age=600');
  assert.deepEqual(seen, [3532145]);
});

test('rejects non-numeric ids', async t => {
  const app = await makeApp();
  t.after(() => app.close());
  for (const id of ['abc', '0', '-5', '1.5']) {
    const response = await app.inject({ method: 'GET', url: `/v1/players/${id}/badge` });
    assert.equal(response.statusCode, 422, id);
    assert.deepEqual(response.json(), { error: 'INVALID_TORN_ID' });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes/player-badge.test.js`
Expected: FAIL with `Cannot find module '../../src/routes/player-badge'`.

- [ ] **Step 3: Implement the route**

`server/src/routes/player-badge.js`:

```js
const { z } = require('zod');
const { RATE_LIMITS } = require('../security/rate-limits');

const tornIdSchema = z.string().regex(/^[1-9][0-9]{0,11}$/).transform(Number);

async function registerPlayerBadgeRoute(app, { presenceRepository }) {
  if (typeof app.authenticate !== 'function') throw new Error('player badge route requires session authentication');
  if (!presenceRepository || typeof presenceRepository.getPlayerBadge !== 'function') {
    throw new Error('presenceRepository.getPlayerBadge is required');
  }

  app.get('/v1/players/:tornId/badge', {
    preHandler: app.authenticate,
    config: { rateLimit: RATE_LIMITS.PLAYER_BADGE }
  }, async (request, reply) => {
    const parsed = tornIdSchema.safeParse(request.params.tornId);
    if (!parsed.success) return reply.code(422).send({ error: 'INVALID_TORN_ID' });
    const badge = await presenceRepository.getPlayerBadge(parsed.data);
    reply.header('Cache-Control', 'private, max-age=600');
    return reply.code(200).send(badge);
  });
}

module.exports = {
  registerPlayerBadgeRoute
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/routes/player-badge.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/player-badge.js server/test/routes/player-badge.test.js
git commit -m "feat(server): add player verification badge endpoint"
```

---

### Task 9: Wire into the app and server, full verification

**Files:**
- Modify: `server/src/app.js`, `server/src/server.js`
- Test: `server/test/routes/state-wiring.test.js`

**Interfaces:**
- Consumes: `registerStateRoute` (Task 7), `registerPlayerBadgeRoute` (Task 8), `createPresenceRepository` (Task 3).
- Produces: `buildApp({ ..., presenceRepository })`; `/v1/state` registered when `sessionRepository`, `requestRepository` and `transactionRepository` are present; `/v1/players/:tornId/badge` registered when `sessionRepository` and `presenceRepository` are present.

- [ ] **Step 1: Write the failing test**

`server/test/routes/state-wiring.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

function makeApp({ presenceRepository = null } = {}) {
  return buildApp({
    config: { API_KEY_ENCRYPTION_KEY: '88'.repeat(32), SESSION_TOKEN_PEPPER: 'test-pepper', SUBSCRIPTION_MODE: 'free' },
    tornClient: {
      async getKeyInfo() { throw new Error('not used'); },
      async getUserPerks() { throw new Error('not used'); }
    },
    identityRepository: { async bindIdentity() {} },
    sessionRepository: {
      async findByTokenHash() {
        return { sessionId: 's', userId: 'u', tornId: 5, name: 'N', expiresAt: null, revokedAt: null, reviverStanding: null, activeBan: false };
      }
    },
    entitlementRepository: {
      async getStatus() { return { state: 'NONE', trialEligible: true, trialStartedAt: null, validUntil: null }; },
      async startTrial() { throw new Error('not used'); }
    },
    requestRepository: { async getActiveRequest() { return null; }, async createRequest() {}, async cancelRequest() {} },
    transactionRepository: {
      async findOpenTransactionIdForUser() { return null; },
      async getTransactionForUser() { return null; },
      async listAvailableRequests() { return []; },
      async acceptRequest() { throw new Error('not used'); }
    },
    verificationCredentialRepository: {
      async getStatus() { return null; },
      async bind() {},
      async revoke() { return false; },
      async getDecryptedActiveForUser() { return null; }
    },
    logMetadataResolver: { async get() { return { categories: {} }; } },
    presenceRepository
  });
}

test('buildApp serves /v1/state', async t => {
  const app = makeApp();
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/state', headers: { authorization: 'Bearer x' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().revivers.online, null);
});

test('buildApp serves the badge route only with a presence repository', async t => {
  const without = makeApp();
  const withPresence = makeApp({
    presenceRepository: {
      async countOnlineRevivers() { return 1; },
      async getPlayerBadge(tornId) { return { tornId, requesterVerified: false, reviverVerified: false }; }
    }
  });
  t.after(() => Promise.all([without.close(), withPresence.close()]));
  const headers = { authorization: 'Bearer x' };
  assert.equal((await without.inject({ method: 'GET', url: '/v1/players/7/badge', headers })).statusCode, 404);
  assert.equal((await withPresence.inject({ method: 'GET', url: '/v1/players/7/badge', headers })).statusCode, 200);
  assert.equal((await withPresence.inject({ method: 'GET', url: '/v1/state', headers })).json().revivers.online, 1);
});
```

`buildApp` also registers the Pro, verification-credential and reviver-queue routes from these repositories; their constructors check for `startTrial`, `getKeyInfo`, `getUserPerks` and `getDecryptedActiveForUser` at startup, which is why those fakes exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes/state-wiring.test.js`
Expected: FAIL (`/v1/state` returns 404).

- [ ] **Step 3: Wire `app.js`**

In `server/src/app.js`:
1. Add imports after the other route imports:

```js
const { registerStateRoute } = require('./routes/state');
const { registerPlayerBadgeRoute } = require('./routes/player-badge');
```

2. Add `presenceRepository = null,` to the `buildApp` parameter list (after `accountDeletionService = null,`).
3. Immediately before `return app;`, add:

```js
  if (sessionRepository && requestRepository && transactionRepository) {
    app.register(async instance => {
      await registerStateRoute(instance, {
        requestRepository,
        transactionRepository,
        entitlementRepository,
        presenceRepository,
        config
      });
    });
  }

  if (sessionRepository && presenceRepository) {
    app.register(async instance => {
      await registerPlayerBadgeRoute(instance, { presenceRepository });
    });
  }
```

- [ ] **Step 4: Wire `server.js`**

In `server/src/server.js`:
1. Add `const { createPresenceRepository } = require('./db/presence');` with the other repository imports.
2. After `const accountDeletionService = createAccountDeletionService(pool);` add `const presenceRepository = createPresenceRepository(pool);`.
3. Add `presenceRepository,` to the object passed to `buildApp({...})`.

- [ ] **Step 5: Run the full server suite**

Run: `node --test`
Expected: everything passes except the two `admin-pro` route tests (`manual revoke exposes REVOKED Pro state…`, `full refund preserves paid invoice/evidence…`), which already fail on `main` because their fixture dates are in the past. Any other failure must be fixed before continuing.

- [ ] **Step 6: Commit**

```bash
git add server/src/app.js server/src/server.js server/test/routes/state-wiring.test.js
git commit -m "feat(server): wire state and player badge routes into the API"
```

- [ ] **Step 7: Clean up the test database**

```bash
docker stop rr-plan1-testdb
```

## Out of scope for this plan

- Deploying this server line to the review stack. The review stack currently runs the `0.6.1-paid-race-20261125` release; moving it to the `main` server line is a release decision taken with Plan 3, using the existing immutable release-folder and rollback convention.
- Any client change (Plans 2 and 3).
- Server-Sent Events (decided for consideration in 1.1).
