const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { acceptRequest, createTransactionRepository } = require('../../src/db/transactions');

async function insertUser(pool, tornId, name) {
  return (await pool.query('INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id', [tornId, name])).rows[0].id;
}

async function insertRequesterCredential(pool, userId) {
  await pool.query(`
    INSERT INTO api_credentials (user_id,ciphertext,iv,auth_tag,access_scope,purpose,capability,last_validated_at)
    VALUES ($1,'c','i','t','{}'::jsonb,'transaction_verification','{"requester":true,"reviver":false}'::jsonb,now())
  `, [userId]);
}

async function insertAvailableRequest(pool, requesterId) {
  return (await pool.query("INSERT INTO revive_requests (requester_id,payment_method,offer_amount,state) VALUES ($1,'cash',500000,'AVAILABLE') RETURNING id", [requesterId])).rows[0].id;
}

test('lists the open transaction for requester and reviver, and nothing once closed', async () => {
  await withDisposableDatabase('open_transaction', async pool => {
    const requester = await insertUser(pool, 870001, 'Req');
    const reviver = await insertUser(pool, 870002, 'Rev');
    const bystander = await insertUser(pool, 870003, 'Other');
    await pool.query("INSERT INTO revivers (user_id,standing) VALUES ($1,'active')", [reviver]);
    await insertRequesterCredential(pool, requester);
    const requestId = await insertAvailableRequest(pool, requester);
    const repo = createTransactionRepository(pool);

    assert.deepEqual(await repo.listOpenTransactionIdsForUser(requester), []);
    const accepted = await acceptRequest(pool, { requestId, reviverId: reviver, now: new Date('2026-11-25T12:00:00Z') });
    assert.equal(accepted.accepted, true);

    assert.deepEqual(await repo.listOpenTransactionIdsForUser(requester), [accepted.transaction.id]);
    assert.deepEqual(await repo.listOpenTransactionIdsForUser(reviver), [accepted.transaction.id]);
    assert.deepEqual(await repo.listOpenTransactionIdsForUser(bystander), []);

    await pool.query('UPDATE transactions SET closed_at=now() WHERE id=$1', [accepted.transaction.id]);
    assert.deepEqual(await repo.listOpenTransactionIdsForUser(requester), []);
  });
});

test('lists every open transaction for a user who is requester in one and reviver in another', async () => {
  await withDisposableDatabase('open_transactions_both_roles', async pool => {
    const both = await insertUser(pool, 870011, 'Both');
    const otherReviver = await insertUser(pool, 870012, 'OtherRev');
    const otherRequester = await insertUser(pool, 870013, 'OtherReq');
    await pool.query("INSERT INTO revivers (user_id,standing) VALUES ($1,'active'),($2,'active')", [both, otherReviver]);
    await insertRequesterCredential(pool, both);
    await insertRequesterCredential(pool, otherRequester);
    const ownRequestId = await insertAvailableRequest(pool, both);
    const otherRequestId = await insertAvailableRequest(pool, otherRequester);
    const repo = createTransactionRepository(pool);

    const asRequester = await acceptRequest(pool, { requestId: ownRequestId, reviverId: otherReviver, now: new Date('2026-11-25T12:00:00Z') });
    const asReviver = await acceptRequest(pool, { requestId: otherRequestId, reviverId: both, now: new Date('2026-11-25T12:05:00Z') });
    assert.equal(asRequester.accepted, true);
    assert.equal(asReviver.accepted, true);

    assert.deepEqual(await repo.listOpenTransactionIdsForUser(both), [asReviver.transaction.id, asRequester.transaction.id]);
  });
});
