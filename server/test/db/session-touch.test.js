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
