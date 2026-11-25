const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { listAvailableRequests, countAvailableRequests } = require('../../src/db/transactions');

async function seedUser(pool, tornId, { credential }) {
  const id = (await pool.query('INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id', [tornId, `R${tornId}`])).rows[0].id;
  if (credential) {
    await pool.query(`
      INSERT INTO api_credentials (user_id,ciphertext,iv,auth_tag,access_scope,purpose,capability,last_validated_at)
      VALUES ($1,'c','i','t','{}'::jsonb,'transaction_verification','{"requester":true,"reviver":false}'::jsonb,now())
    `, [id]);
  }
  return id;
}

async function seedRequest(pool, userId, closed = false) {
  const sql = closed
    ? "INSERT INTO revive_requests (requester_id,payment_method,offer_amount,state,closed_at) VALUES ($1,'cash',1000000,'CANCELLED_BY_REQUESTER',now())"
    : "INSERT INTO revive_requests (requester_id,payment_method,offer_amount,state) VALUES ($1,'cash',1000000,'AVAILABLE')";
  await pool.query(sql, [userId]);
}

test('countAvailableRequests matches the queue filters exactly', async () => {
  await withDisposableDatabase('queue_count', async pool => {
    await seedRequest(pool, await seedUser(pool, 870001, { credential: true }));
    await seedRequest(pool, await seedUser(pool, 870002, { credential: true }));
    await seedRequest(pool, await seedUser(pool, 870003, { credential: false }));
    await seedRequest(pool, await seedUser(pool, 870004, { credential: true }), true);

    const count = await countAvailableRequests(pool);
    assert.equal(count, 2);
    assert.equal(count, (await listAvailableRequests(pool)).length);
  });
});
