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
