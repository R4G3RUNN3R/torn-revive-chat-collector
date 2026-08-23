function mapRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    requesterId: row.requester_id,
    paymentMethod: row.payment_method,
    offerAmount: Number(row.offer_amount),
    comment: row.comment,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at,
    closedAt: row.closed_at
  };
}

const RETURNING = `
  RETURNING id, requester_id, payment_method, offer_amount, comment, state,
    created_at, updated_at, cancelled_at, closed_at
`;

function createRequestRepository(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('PostgreSQL pool is required');
  }

  async function createOrGetActive({ requesterId, paymentMethod, offerAmount, comment, now = new Date() }) {
    const inserted = await pool.query(`
      INSERT INTO revive_requests (
        requester_id, payment_method, offer_amount, comment, state, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'AVAILABLE', $5, $5)
      ON CONFLICT (requester_id) WHERE closed_at IS NULL
      DO NOTHING
      ${RETURNING}
    `, [requesterId, paymentMethod, offerAmount, comment, now]);

    if (inserted.rowCount > 0) {
      return { request: mapRequest(inserted.rows[0]), created: true };
    }

    const existing = await pool.query(`
      SELECT id, requester_id, payment_method, offer_amount, comment, state,
        created_at, updated_at, cancelled_at, closed_at
      FROM revive_requests
      WHERE requester_id = $1 AND closed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `, [requesterId]);

    if (existing.rowCount === 0) {
      throw new Error('Active request conflict resolved without an active request');
    }

    return { request: mapRequest(existing.rows[0]), created: false };
  }

  async function getActive(requesterId) {
    const result = await pool.query(`
      SELECT id, requester_id, payment_method, offer_amount, comment, state,
        created_at, updated_at, cancelled_at, closed_at
      FROM revive_requests
      WHERE requester_id = $1 AND closed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `, [requesterId]);
    return result.rowCount ? mapRequest(result.rows[0]) : null;
  }

  async function cancelAvailable(requestId, requesterId, now = new Date()) {
    const result = await pool.query(`
      UPDATE revive_requests
      SET state = 'CANCELLED', cancelled_at = $3, closed_at = $3, updated_at = $3
      WHERE id = $1
        AND requester_id = $2
        AND closed_at IS NULL
        AND state = 'AVAILABLE'
      ${RETURNING}
    `, [requestId, requesterId, now]);
    return result.rowCount ? mapRequest(result.rows[0]) : null;
  }

  return {
    createOrGetActive,
    getActive,
    cancelAvailable
  };
}

module.exports = {
  createRequestRepository
};
