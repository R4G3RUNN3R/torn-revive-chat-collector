const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');
const { enqueueJob, claimDueJobs } = require('../../src/db/jobs');

test('two workers claim ten due jobs exactly once using SKIP LOCKED', async () => {
  const sourceUrl = process.env.TEST_DATABASE_URL;
  assert.ok(sourceUrl, 'TEST_DATABASE_URL is required');

  const dbName = `reviverelay_jobs_${process.pid}_${Date.now()}`;
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
    for (let i = 0; i < 10; i += 1) {
      await enqueueJob(pool, {
        type: 'payment.verify',
        entityId: null,
        runAt: dueAt,
        payload: { sequence: i }
      });
    }

    const now = new Date('2026-08-24T00:00:01Z');
    const [a, b] = await Promise.all([
      claimDueJobs(pool, { limit: 5, workerId: 'worker-a', now }),
      claimDueJobs(pool, { limit: 5, workerId: 'worker-b', now })
    ]);

    const claimed = [...a, ...b];
    assert.equal(claimed.length, 10);
    assert.equal(new Set(claimed.map(job => job.id)).size, 10);
    assert.deepEqual(
      new Set(claimed.map(job => job.lockedBy)),
      new Set(['worker-a', 'worker-b'])
    );

    const rows = await pool.query(`
      SELECT id, attempts, locked_by
      FROM jobs
      ORDER BY id
    `);
    assert.equal(rows.rowCount, 10);
    assert.ok(rows.rows.every(row => Number(row.attempts) === 1));
    assert.ok(rows.rows.every(row => row.locked_by));
  } finally {
    await pool.end();
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminPool.end();
  }
});
