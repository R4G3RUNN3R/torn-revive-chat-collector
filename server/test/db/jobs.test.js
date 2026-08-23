const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { migrate } = require('../../src/db/migrate');

const modulePath = path.resolve(__dirname, '../../src/db/jobs.js');
const migrationsDir = path.resolve(__dirname, '../../src/db/migrations');
const databaseUrl = process.env.TEST_DATABASE_URL;

async function clean(pool) {
  await migrate(pool, migrationsDir);
  await pool.query('TRUNCATE jobs RESTART IDENTITY');
}

test('two workers claim ten due jobs at most once using SKIP LOCKED', { skip: !databaseUrl }, async () => {
  assert.ok(fs.existsSync(modulePath), 'server/src/db/jobs.js must exist');
  const { createJobRepository } = require(modulePath);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await clean(pool);
    const now = new Date('2026-08-23T18:45:00.000Z');
    const repo = createJobRepository(pool, { now: () => now });

    for (let index = 0; index < 10; index += 1) {
      await repo.enqueueJob({
        type: index % 2 === 0 ? 'payment.verify' : 'revive.verify',
        entityId: null,
        runAt: new Date('2026-08-23T18:44:00.000Z'),
        payload: { index }
      });
    }

    const [a, b] = await Promise.all([
      repo.claimDueJobs({ limit: 5, workerId: 'worker-a' }),
      repo.claimDueJobs({ limit: 5, workerId: 'worker-b' })
    ]);

    assert.equal(a.length + b.length, 10);
    assert.equal(new Set([...a, ...b].map((job) => job.id)).size, 10);
    assert.ok(a.every((job) => job.lockedBy === 'worker-a'));
    assert.ok(b.every((job) => job.lockedBy === 'worker-b'));

    const rows = await pool.query('SELECT id, attempts, locked_by FROM jobs ORDER BY id');
    assert.equal(rows.rowCount, 10);
    assert.ok(rows.rows.every((row) => row.attempts === 1));
    assert.equal(new Set(rows.rows.map((row) => row.locked_by)).size, 2);
  } finally {
    await pool.end();
  }
});

test('completed jobs cannot be claimed again and failed jobs can be rescheduled', { skip: !databaseUrl }, async () => {
  assert.ok(fs.existsSync(modulePath), 'server/src/db/jobs.js must exist');
  const { createJobRepository } = require(modulePath);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await clean(pool);
    let current = new Date('2026-08-23T18:45:00.000Z');
    const repo = createJobRepository(pool, { now: () => current });
    const first = await repo.enqueueJob({ type: 'payment.verify', runAt: current, payload: {} });
    const second = await repo.enqueueJob({ type: 'revive.verify', runAt: current, payload: {} });

    const claimed = await repo.claimDueJobs({ limit: 2, workerId: 'worker-a' });
    assert.equal(claimed.length, 2);

    await repo.markComplete(first.id, 'worker-a');
    await repo.markFailed(second.id, 'worker-a', 'temporary failure', new Date('2026-08-23T18:46:00.000Z'));

    assert.equal((await repo.claimDueJobs({ limit: 10, workerId: 'worker-b' })).length, 0);
    current = new Date('2026-08-23T18:46:01.000Z');
    const retried = await repo.claimDueJobs({ limit: 10, workerId: 'worker-b' });
    assert.equal(retried.length, 1);
    assert.equal(retried[0].id, second.id);
    assert.equal(retried[0].attempts, 2);
  } finally {
    await pool.end();
  }
});
