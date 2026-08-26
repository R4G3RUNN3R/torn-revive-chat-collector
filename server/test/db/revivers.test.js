const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createReviverRepository } = require('../../src/db/revivers');

async function createUser(pool, tornId = 991001) {
  const result = await pool.query('INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id', [tornId, `Reviver ${tornId}`]);
  return result.rows[0].id;
}

test('register is idempotent but never resets suspended standing', async () => {
  await withDisposableDatabase('reviverelay_reviver_register', async pool => {
    const userId = await createUser(pool);
    const repo = createReviverRepository(pool);
    const first = await repo.register({ userId, now: new Date('2026-08-26T10:00:00Z') });
    assert.equal(first.registered, true);
    assert.equal(first.reviver.standing, 'active');

    await pool.query("UPDATE revivers SET standing='suspended' WHERE user_id=$1", [userId]);
    const second = await repo.register({ userId, now: new Date('2026-08-26T10:01:00Z') });
    assert.equal(second.registered, false);
    assert.equal(second.reason, 'REVIVER_NOT_ELIGIBLE');
    assert.equal(second.reviver.standing, 'suspended');
  });
});

test('active ban makes registration ineligible without changing standing', async () => {
  await withDisposableDatabase('reviverelay_reviver_ban', async pool => {
    const userId = await createUser(pool, 991002);
    const repo = createReviverRepository(pool);
    await repo.register({ userId });
    await pool.query("INSERT INTO bans (reviver_id,reason,active) VALUES ($1,'test',true)", [userId]);
    const result = await repo.register({ userId });
    assert.equal(result.registered, false);
    assert.equal(result.reason, 'REVIVER_NOT_ELIGIBLE');
  });
});
