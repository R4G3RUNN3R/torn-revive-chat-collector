const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { migrate } = require('../../src/db/migrate');

const modulePath = path.resolve(__dirname, '../../src/db/candidates.js');
const migrationsDir = path.resolve(__dirname, '../../src/db/migrations');
const databaseUrl = process.env.TEST_DATABASE_URL;

function candidate(overrides = {}) {
  return {
    channel: { id: 'public_hospital', name: 'Hospital', type: 'hospital' },
    senderId: '1234567',
    senderName: 'NeedARevive',
    text: 'rev please',
    sourceMessageId: null,
    messageTimestamp: null,
    classifierVersion: '2.0.0',
    score: 90,
    reasons: ['direct-request'],
    capturedAt: '2026-08-23T17:00:00.000Z',
    ...overrides
  };
}

async function clean(pool) {
  await migrate(pool, migrationsDir);
  await pool.query('TRUNCATE public_chat_candidates RESTART IDENTITY');
}

test('fallback dedupe merges simultaneous observations within 120 seconds but preserves later repeats', { skip: !databaseUrl }, async () => {
  assert.ok(fs.existsSync(modulePath), 'server/src/db/candidates.js must exist');
  const { upsertCandidate } = require(modulePath);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await clean(pool);
    const t0 = new Date('2026-08-23T17:00:00.000Z');
    const t45 = new Date('2026-08-23T17:00:45.000Z');
    const t181 = new Date('2026-08-23T17:03:01.000Z');

    const first = await upsertCandidate(pool, candidate(), t0);
    const second = await upsertCandidate(pool, candidate({ capturedAt: '2026-08-23T17:00:40.000Z' }), t45);
    const later = await upsertCandidate(pool, candidate({ capturedAt: '2026-08-23T17:03:00.000Z' }), t181);

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(first.candidate.id, second.candidate.id);
    assert.equal(second.candidate.seenCount, 2);
    assert.equal(later.duplicate, false);
    assert.notEqual(later.candidate.id, first.candidate.id);

    const rows = await pool.query('SELECT id, seen_count FROM public_chat_candidates ORDER BY first_seen_at');
    assert.equal(rows.rowCount, 2);
    assert.deepEqual(rows.rows.map((row) => row.seen_count), [2, 1]);
  } finally {
    await pool.end();
  }
});

test('concurrent fallback observations create one occurrence row', { skip: !databaseUrl }, async () => {
  assert.ok(fs.existsSync(modulePath), 'server/src/db/candidates.js must exist');
  const { upsertCandidate } = require(modulePath);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await clean(pool);
    const receivedAt = new Date('2026-08-23T17:00:00.000Z');
    const [a, b] = await Promise.all([
      upsertCandidate(pool, candidate({ capturedAt: '2026-08-23T17:00:00.000Z' }), receivedAt),
      upsertCandidate(pool, candidate({ capturedAt: '2026-08-23T17:00:07.000Z' }), receivedAt)
    ]);

    assert.equal(new Set([a.candidate.id, b.candidate.id]).size, 1);
    assert.equal([a.duplicate, b.duplicate].filter(Boolean).length, 1);

    const rows = await pool.query('SELECT seen_count FROM public_chat_candidates');
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].seen_count, 2);
  } finally {
    await pool.end();
  }
});

test('stable canonical key dedupes regardless of observer capture time', { skip: !databaseUrl }, async () => {
  assert.ok(fs.existsSync(modulePath), 'server/src/db/candidates.js must exist');
  const { upsertCandidate } = require(modulePath);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await clean(pool);
    const a = await upsertCandidate(pool, candidate({
      sourceMessageId: 'msg-stable-1',
      capturedAt: '2026-08-23T17:00:00.000Z'
    }), new Date('2026-08-23T17:00:01.000Z'));
    const b = await upsertCandidate(pool, candidate({
      sourceMessageId: 'msg-stable-1',
      capturedAt: '2026-08-23T17:10:00.000Z'
    }), new Date('2026-08-23T17:10:01.000Z'));

    assert.equal(a.candidate.id, b.candidate.id);
    assert.equal(b.duplicate, true);
    assert.equal(b.candidate.seenCount, 2);
  } finally {
    await pool.end();
  }
});
