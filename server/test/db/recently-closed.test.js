const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { acceptRequest, createTransactionRepository, RECENTLY_CLOSED_WINDOW_MS } = require('../../src/db/transactions');

const NOW = new Date('2026-11-26T12:00:00Z');

async function insertUser(pool, tornId, name) {
  return (await pool.query('INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id', [tornId, name])).rows[0].id;
}

async function openTransaction(pool, requesterId, reviverId) {
  await pool.query(`
    INSERT INTO api_credentials (user_id,ciphertext,iv,auth_tag,access_scope,purpose,capability,last_validated_at)
    VALUES ($1,'c','i','t','{}'::jsonb,'transaction_verification','{"requester":true,"reviver":false}'::jsonb,now())
    ON CONFLICT DO NOTHING
  `, [requesterId]);
  const requestId = (await pool.query("INSERT INTO revive_requests (requester_id,payment_method,offer_amount,state) VALUES ($1,'cash',500000,'AVAILABLE') RETURNING id", [requesterId])).rows[0].id;
  const accepted = await acceptRequest(pool, { requestId, reviverId, now: new Date(NOW.getTime() - 10 * 60 * 1000) });
  assert.equal(accepted.accepted, true);
  return accepted.transaction.id;
}

async function close(pool, transactionId, state, closedAt) {
  await pool.query('UPDATE transactions SET state=$2, closed_at=$3 WHERE id=$1', [transactionId, state, closedAt]);
  await pool.query('UPDATE revive_requests SET state=$2, closed_at=$3 WHERE id=(SELECT request_id FROM transactions WHERE id=$1)', [transactionId, state, closedAt]);
}

test('recently closed lists outcomes for 30 s and reportables for one hour, newest first, for both participants only', async () => {
  await withDisposableDatabase('recently_closed', async pool => {
    const requester = await insertUser(pool, 880001, 'Req');
    const reviver = await insertUser(pool, 880002, 'Rev');
    const bystander = await insertUser(pool, 880003, 'Other');
    await pool.query("INSERT INTO revivers (user_id,standing) VALUES ($1,'active')", [reviver]);
    const repo = createTransactionRepository(pool);

    // One open request per requester: each transaction is closed before the next one opens.
    const closedAgo = async (state, ms) => {
      const id = await openTransaction(pool, requester, reviver);
      await close(pool, id, state, new Date(NOW.getTime() - ms));
      return id;
    };
    const completed = await closedAgo('COMPLETED', 5 * 1000);
    const refunded = await closedAgo('REFUNDED', 20 * 1000);
    const reportable = await closedAgo('REPORTABLE_NO_ATTEMPT', 50 * 60 * 1000);
    await closedAgo('COMPLETED', RECENTLY_CLOSED_WINDOW_MS.OUTCOME + 1000);
    await closedAgo('REPORTABLE_MISSING_REFUND', RECENTLY_CLOSED_WINDOW_MS.REPORTABLE + 1000);
    await closedAgo('PAYMENT_EXPIRED', 2 * 1000);
    const stillOpen = await openTransaction(pool, requester, reviver);

    const expected = [completed, refunded, reportable];
    assert.deepEqual(await repo.listRecentlyClosedTransactionIdsForUser(requester, { now: NOW }), expected);
    assert.deepEqual(await repo.listRecentlyClosedTransactionIdsForUser(reviver, { now: NOW }), expected);
    assert.deepEqual(await repo.listRecentlyClosedTransactionIdsForUser(bystander, { now: NOW }), []);
    assert.equal((await repo.listRecentlyClosedTransactionIdsForUser(requester, { now: NOW })).includes(stillOpen), false);
  });
});

test('recently closed ignores closures stamped after now and rejects an invalid clock', async () => {
  await withDisposableDatabase('recently_closed_clock', async pool => {
    const requester = await insertUser(pool, 880011, 'Req');
    const reviver = await insertUser(pool, 880012, 'Rev');
    await pool.query("INSERT INTO revivers (user_id,standing) VALUES ($1,'active')", [reviver]);
    const repo = createTransactionRepository(pool);
    const future = await openTransaction(pool, requester, reviver);
    await close(pool, future, 'COMPLETED', new Date(NOW.getTime() + 60 * 1000));
    assert.deepEqual(await repo.listRecentlyClosedTransactionIdsForUser(requester, { now: NOW }), []);
    await assert.rejects(repo.listRecentlyClosedTransactionIdsForUser(requester, { now: new Date('nope') }), /valid Date/);
  });
});
