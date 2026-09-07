const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createRequestRepository } = require('../../src/db/requests');
const { createTransactionRepository } = require('../../src/db/transactions');
const { insertRequesterVerificationCredential } = require('../../test-support/verification');

test('direct requests persist server-owned origin and repository projects certification source', async () => {
  await withDisposableDatabase('direct_requests', async pool => {
    const user = await pool.query(`
      INSERT INTO users (torn_id, current_name)
      VALUES (900001, 'Direct Requester')
      RETURNING id
    `);
    const requesterId = user.rows[0].id;
    await insertRequesterVerificationCredential(pool, requesterId);
    const repo = createRequestRepository(pool);

    const created = await repo.createRequest({
      requesterId,
      paymentMethod: 'cash',
      offerAmount: 500000,
      comment: 'Please revive'
    });

    assert.equal(created.request.origin, 'reviverelay_direct');
    const active = await repo.getActiveRequest(requesterId);
    assert.equal(active.origin, 'reviverelay_direct');

    const queue = await createTransactionRepository(pool).listAvailableRequests();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].origin, 'reviverelay_direct');
    assert.equal(queue[0].certified, true);
    assert.equal(Object.hasOwn(queue[0], 'requesterId'), false);

    const column = await pool.query(`
      SELECT column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'revive_requests'
        AND column_name = 'origin'
    `);
    assert.equal(column.rowCount, 1);
    assert.match(String(column.rows[0].column_default), /reviverelay_direct/);
    assert.equal(column.rows[0].is_nullable, 'NO');
  });
});
