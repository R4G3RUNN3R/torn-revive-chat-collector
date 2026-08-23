function mapJob(row) {
  return {
    id: row.id,
    type: row.type,
    entityId: row.entity_id,
    runAt: row.run_at,
    attempts: row.attempts,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    completedAt: row.completed_at,
    payload: row.payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const RETURNING = `
  RETURNING id, type, entity_id, run_at, attempts, locked_at, locked_by,
    last_error, completed_at, payload, created_at, updated_at
`;

const CLAIM_RETURNING = `
  RETURNING j.id, j.type, j.entity_id, j.run_at, j.attempts,
    j.locked_at, j.locked_by, j.last_error, j.completed_at,
    j.payload, j.created_at, j.updated_at
`;

function createJobRepository(pool, { now = () => new Date() } = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('PostgreSQL pool is required');
  }

  async function enqueueJob({ type, entityId = null, runAt, payload = {} }) {
    if (typeof type !== 'string' || !type.trim()) {
      throw new TypeError('Job type is required');
    }
    const due = runAt instanceof Date ? runAt : new Date(runAt);
    if (Number.isNaN(due.getTime())) {
      throw new TypeError('Job runAt must be a valid date');
    }

    const result = await pool.query(`
      INSERT INTO jobs (type, entity_id, run_at, payload)
      VALUES ($1, $2, $3, $4::jsonb)
      ${RETURNING}
    `, [type.trim(), entityId, due, JSON.stringify(payload || {})]);
    return mapJob(result.rows[0]);
  }

  async function claimDueJobs({ limit = 10, workerId }) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('Job claim limit must be an integer between 1 and 100');
    }
    if (typeof workerId !== 'string' || !workerId.trim()) {
      throw new TypeError('workerId is required');
    }

    const claimedAt = now();
    const result = await pool.query(`
      WITH picked AS (
        SELECT id
        FROM jobs
        WHERE completed_at IS NULL
          AND run_at <= $1
          AND (
            locked_at IS NULL
            OR locked_at < $1::timestamptz - interval '5 minutes'
          )
        ORDER BY run_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE jobs j
      SET locked_at = $1,
          locked_by = $3,
          attempts = j.attempts + 1,
          updated_at = $1
      FROM picked
      WHERE j.id = picked.id
      ${CLAIM_RETURNING}
    `, [claimedAt, limit, workerId.trim()]);

    return result.rows.map(mapJob);
  }

  async function markComplete(id, workerId) {
    const completedAt = now();
    const result = await pool.query(`
      UPDATE jobs
      SET completed_at = $3,
          locked_at = NULL,
          locked_by = NULL,
          last_error = NULL,
          updated_at = $3
      WHERE id = $1
        AND locked_by = $2
        AND completed_at IS NULL
      ${RETURNING}
    `, [id, workerId, completedAt]);
    return result.rowCount ? mapJob(result.rows[0]) : null;
  }

  async function markFailed(id, workerId, errorMessage, retryAt) {
    const failedAt = now();
    const message = String(errorMessage || 'Job failed').slice(0, 4000);

    if (retryAt === null) {
      const result = await pool.query(`
        UPDATE jobs
        SET completed_at = $4,
            locked_at = NULL,
            locked_by = NULL,
            last_error = $3,
            updated_at = $4
        WHERE id = $1
          AND locked_by = $2
          AND completed_at IS NULL
        ${RETURNING}
      `, [id, workerId, message, failedAt]);
      return result.rowCount ? mapJob(result.rows[0]) : null;
    }

    const retry = retryAt instanceof Date ? retryAt : new Date(retryAt);
    if (Number.isNaN(retry.getTime())) {
      throw new TypeError('retryAt must be a valid date or null');
    }

    const result = await pool.query(`
      UPDATE jobs
      SET run_at = $4,
          locked_at = NULL,
          locked_by = NULL,
          last_error = $3,
          updated_at = $5
      WHERE id = $1
        AND locked_by = $2
        AND completed_at IS NULL
      ${RETURNING}
    `, [id, workerId, message, retry, failedAt]);
    return result.rowCount ? mapJob(result.rows[0]) : null;
  }

  return {
    enqueueJob,
    claimDueJobs,
    markComplete,
    markFailed
  };
}

module.exports = {
  createJobRepository
};
