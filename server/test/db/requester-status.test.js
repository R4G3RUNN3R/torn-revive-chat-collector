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
