const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');
const { upsertCandidate } = require('../../src/db/candidates');

function candidate(overrides = {}) {
  return {
    channelId: 'public_global',
    channelName: 'Global',
    channelType: 'global',
    senderId: '12345',
    senderName: 'NeedsRevive',
    text: 'rev me please',
    sourceMessageId: null,
    messageTimestamp: null,
    classifierVersion: '2.0.0',
    score: 95,
    reasons: ['direct-request'],
    capturedAt: '2026-08-23T12:00:00Z',
    ...overrides
  };
}

async function preparePool(t) {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, 'TEST_DATABASE_URL is required');
  const pool = createPool(connectionString);
  t.after(async () => pool.end());
  await migrate(pool, path.resolve(__dirname, '../../src/db/migrations'));
  await pool.query('TRUNCATE public_chat_candidates');
  return pool;
}

test('fallback dedupe merges observations inside 120 seconds but preserves later repeats', async t => {
  const pool = await preparePool(t);
  const payload = candidate();

  const at0 = new Date('2026-08-23T12:00:00Z');
  const at45 = new Date('2026-08-23T12:00:45Z');
  const at181 = new Date('2026-08-23T12:03:01Z');

  const first = await upsertCandidate(pool, payload, at0);
  const second = await upsertCandidate(pool, payload, at45);
  const third = await upsertCandidate(pool, payload, at181);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.candidate.id, first.candidate.id);
  assert.equal(second.candidate.seenCount, 2);
  assert.equal(third.duplicate, false);
  assert.notEqual(third.candidate.id, first.candidate.id);

  const rows = await pool.query(`
    SELECT id, seen_count
    FROM public_chat_candidates
    ORDER BY first_seen_at
  `);
  assert.equal(rows.rowCount, 2);
  assert.deepEqual(rows.rows.map(row => Number(row.seen_count)), [2, 1]);
});

test('two concurrent fallback observations create exactly one row', async t => {
  const pool = await preparePool(t);
  const payload = candidate();
  const now = new Date('2026-08-23T13:00:00Z');

  const [a, b] = await Promise.all([
    upsertCandidate(pool, payload, now),
    upsertCandidate(pool, payload, now)
  ]);

  assert.equal([a.duplicate, b.duplicate].filter(Boolean).length, 1);
  assert.equal(a.candidate.id, b.candidate.id);

  const rows = await pool.query('SELECT id, seen_count FROM public_chat_candidates');
  assert.equal(rows.rowCount, 1);
  assert.equal(Number(rows.rows[0].seen_count), 2);
});

test('stable canonical source identity is idempotent regardless of local capture time', async t => {
  const pool = await preparePool(t);
  const payload = candidate({ sourceMessageId: 'stable-message-1' });

  const first = await upsertCandidate(pool, payload, new Date('2026-08-23T14:00:00Z'));
  const second = await upsertCandidate(
    pool,
    { ...payload, capturedAt: '2026-08-23T14:10:00Z' },
    new Date('2026-08-23T14:10:00Z')
  );

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.candidate.id, second.candidate.id);
  assert.equal(second.candidate.seenCount, 2);
});


test('recent shared-candidate query returns only fresh rows newest first', async t => {
  const candidatesModule = require('../../src/db/candidates');
  assert.equal(typeof candidatesModule.listRecentCandidates, 'function', 'candidate repository must expose the shared-feed query');
  const pool = await preparePool(t);
  await upsertCandidate(pool, candidate({ senderId: '1', senderName: 'Old', text: 'old revive' }), new Date('2026-08-27T12:00:00Z'));
  await upsertCandidate(pool, candidate({ senderId: '2', senderName: 'FreshA', text: 'fresh revive A' }), new Date('2026-08-27T12:09:00Z'));
  await upsertCandidate(pool, candidate({ senderId: '3', senderName: 'FreshB', text: 'fresh revive B' }), new Date('2026-08-27T12:09:30Z'));

  const rows = await candidatesModule.listRecentCandidates(pool, {
    freshSince: new Date('2026-08-27T12:08:00Z'),
    limit: 50
  });
  assert.deepEqual(rows.map(row => row.senderName), ['FreshB', 'FreshA']);
});
