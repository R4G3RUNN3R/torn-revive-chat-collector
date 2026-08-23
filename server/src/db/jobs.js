const JOB_TYPES = Object.freeze([
  'payment.verify',
  'revive.verify',
  'refund.verify',
  'subscription.scan',
  'sheets.mirror'
]);

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    entityId: row.entity_id,
    runAt: row.run_at,
    attempts: Number(row.attempts),
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    completedAt: row.completed_at,
    payload: row.payload || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function enqueueJob(pool, {
  type,
  entityId = null,
  runAt = new Date(),
  payload = {}
}) {
  if (typeof type !== 'string' || !type.trim()) {
    throw new Error('job type is required');
  }
  if (!(runAt instanceof Date) || Number.isNaN(runAt.getTime())) {
    throw new Error('runAt must be a valid Date');
  }

  const result = await pool.query(`
    INSERT INTO jobs (type, entity_id, run_at, payload)
    VALUES ($1, $2, $3, $4::jsonb)
    RETURNING *
  `, [type.trim(), entityId, runAt, JSON.stringify(payload || {})]);

  return rowToJob(result.rows[0]);
}

async function claimDueJobs(pool, {
  limit = 10,
  workerId,
  now = new Date()
}) {
  if (typeof workerId !== 'string' || !workerId.trim()) {
    throw new Error('workerId is required');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('now must be a valid Date');
  }

  const normalizedLimit = Math.max(
    1,
    Math.min(100, Number.isInteger(limit) ? limit : 10)
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      WITH due AS (
        SELECT id
        FROM jobs
        WHERE completed_at IS NULL
          AND locked_at IS NULL
          AND run_at <= $1
        ORDER BY run_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE jobs j
      SET locked_at = $1,
          locked_by = $3,
          attempts = j.attempts + 1,
          updated_at = $1
      FROM due
      WHERE j.id = due.id
      RETURNING j.*
    `, [now, normalizedLimit, workerId.trim()]);
    await client.query('COMMIT');
    return result.rows.map(rowToJob);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function completeJob(pool, jobId, now = new Date()) {
  const result = await pool.query(`
    UPDATE jobs
    SET completed_at = $2,
        updated_at = $2
    WHERE id = $1
      AND completed_at IS NULL
    RETURNING *
  `, [jobId, now]);

  return result.rowCount === 1 ? rowToJob(result.rows[0]) : null;
}

async function failJob(pool, jobId, error, {
  terminal = false,
  retryAt = null,
  now = new Date()
} = {}) {
  const message = String(error || 'Unknown job failure').slice(0, 4000);
  const nextRunAt = retryAt instanceof Date && !Number.isNaN(retryAt.getTime())
    ? retryAt
    : new Date(now.getTime() + 60_000);

  const result = await pool.query(`
    UPDATE jobs
    SET last_error = $2,
        locked_at = NULL,
        locked_by = NULL,
        run_at = CASE WHEN $3::boolean THEN run_at ELSE $4 END,
        completed_at = CASE WHEN $3::boolean THEN $5 ELSE completed_at END,
        updated_at = $5
    WHERE id = $1
      AND completed_at IS NULL
    RETURNING *
  `, [jobId, message, terminal, nextRunAt, now]);

  return result.rowCount === 1 ? rowToJob(result.rows[0]) : null;
}

function createJobRepository(pool) {
  return {
    enqueueJob(input) {
      return enqueueJob(pool, input);
    },
    claimDueJobs(input) {
      return claimDueJobs(pool, input);
    },
    completeJob(jobId, now) {
      return completeJob(pool, jobId, now);
    },
    failJob(jobId, error, options) {
      return failJob(pool, jobId, error, options);
    }
  };
}

module.exports = {
  JOB_TYPES,
  enqueueJob,
  claimDueJobs,
  completeJob,
  failJob,
  createJobRepository
};
