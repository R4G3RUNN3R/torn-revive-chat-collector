const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');
const { enqueueJob, claimDueJobs } = require('../../src/db/jobs');

async function waitForDatabaseSessionsToClose(adminPool, dbName) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await adminPool.query(`
      SELECT COUNT(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = $1
    `, [dbName]);

    if (result.rows[0].count === 0) return;
    await sleep(10);
  }

  throw new Error(`Timed out waiting for PostgreSQL sessions to close for ${dbName}`);
}

test('stale worker locks are reclaimable while fresh locks remain protected', async () => {
  const sourceUrl = process.env.TEST_DATABASE_URL;
  assert.ok(sourceUrl, 'TEST_DATABASE_URL is required');

  const dbName = `reviverelay_job_recovery_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${dbName}`;

  const adminPool = createPool(adminUrl.toString());
  const pool = createPool(targetUrl.toString());

  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    await migrate(pool, path.resolve(__dirname, '../../src/db/migrations'));

    const dueAt = new Date('2026-08-24T00:00:00Z');
    const job = await enqueueJob(pool, {
      type: 'payment.verify',
      entityId: null,
      runAt: dueAt,
      payload: { transactionId: 'lease-test' }
    });

    const firstClaim = await claimDueJobs(pool, {
      limit: 1,
      workerId: 'worker-a',
      now: new Date('2026-08-24T00:00:01Z')
    });
    assert.equal(firstClaim.length, 1);
    assert.equal(firstClaim[0].id, job.id);
    assert.equal(firstClaim[0].lockedBy, 'worker-a');
    assert.equal(firstClaim[0].attempts, 1);

    const protectedClaim = await claimDueJobs(pool, {
      limit: 1,
      workerId: 'worker-b',
      now: new Date('2026-08-24T00:01:00Z')
    });
    assert.deepEqual(protectedClaim, []);

    const recoveredClaim = await claimDueJobs(pool, {
      limit: 1,
      workerId: 'worker-b',
      now: new Date('2026-08-24T00:06:00Z')
    });
    assert.equal(recoveredClaim.length, 1);
    assert.equal(recoveredClaim[0].id, job.id);
    assert.equal(recoveredClaim[0].lockedBy, 'worker-b');
    assert.equal(recoveredClaim[0].attempts, 2);

    const row = await pool.query(`
      SELECT locked_by, attempts, completed_at
      FROM jobs
      WHERE id = $1
    `, [job.id]);
    assert.equal(row.rowCount, 1);
    assert.equal(row.rows[0].locked_by, 'worker-b');
    assert.equal(Number(row.rows[0].attempts), 2);
    assert.equal(row.rows[0].completed_at, null);
  } finally {
    await pool.end();
    await waitForDatabaseSessionsToClose(adminPool, dbName);
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminPool.end();
  }
});
