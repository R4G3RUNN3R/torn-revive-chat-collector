class RequestAcceptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RequestAcceptError';
    this.code = code;
  }
}

function mapTransaction(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    reviverId: row.reviver_id,
    state: row.state,
    acceptedAt: row.accepted_at,
    paymentDeadline: row.payment_deadline,
    paymentReconciliationDeadline: row.payment_reconciliation_deadline,
    paymentVerifiedAt: row.payment_verified_at,
    reviveDeadline: row.revive_deadline,
    refundRequiredAt: row.refund_required_at,
    refundDeadline: row.refund_deadline,
    terminalAt: row.terminal_at
  };
}

function mapQueueRow(row) {
  return {
    id: row.id,
    requesterTornId: Number(row.requester_torn_id),
    requesterName: row.requester_name,
    paymentMethod: row.payment_method,
    offerAmount: Number(row.offer_amount),
    comment: row.comment,
    createdAt: row.created_at
  };
}

function createTransactionRepository(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('PostgreSQL pool is required');
  }

  async function listAvailable() {
    const result = await pool.query(`
      SELECT r.id, u.torn_id AS requester_torn_id, u.display_name AS requester_name,
        r.payment_method, r.offer_amount, r.comment, r.created_at
      FROM revive_requests r
      JOIN users u ON u.id = r.requester_id
      WHERE r.state = 'AVAILABLE' AND r.closed_at IS NULL
      ORDER BY r.created_at ASC, r.id ASC
    `);
    return result.rows.map(mapQueueRow);
  }

  async function acceptRequest({ requestId, reviverId, now = new Date() }) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const reviver = await client.query(`
        SELECT r.standing,
          EXISTS (
            SELECT 1 FROM bans b
            WHERE b.reviver_id = r.user_id AND b.revoked_at IS NULL
          ) AS active_ban
        FROM revivers r
        WHERE r.user_id = $1
        FOR UPDATE
      `, [reviverId]);

      if (
        reviver.rowCount === 0 ||
        reviver.rows[0].standing !== 'ACTIVE' ||
        reviver.rows[0].active_ban
      ) {
        throw new RequestAcceptError('REVIVER_NOT_ELIGIBLE', 'Reviver is not eligible to accept requests');
      }

      const request = await client.query(`
        SELECT id, state, closed_at
        FROM revive_requests
        WHERE id = $1
        FOR UPDATE
      `, [requestId]);

      if (
        request.rowCount === 0 ||
        request.rows[0].closed_at ||
        request.rows[0].state !== 'AVAILABLE'
      ) {
        throw new RequestAcceptError('REQUEST_NOT_AVAILABLE', 'Request is no longer available');
      }

      const inserted = await client.query(`
        INSERT INTO transactions (
          request_id, reviver_id, state, accepted_at, payment_deadline, created_at, updated_at
        ) VALUES (
          $1, $2, 'WAITING_FOR_PAYMENT', $3,
          $3::timestamptz + interval '3 minutes', $3, $3
        )
        RETURNING id, request_id, reviver_id, state, accepted_at, payment_deadline,
          payment_reconciliation_deadline, payment_verified_at, revive_deadline,
          refund_required_at, refund_deadline, terminal_at
      `, [requestId, reviverId, now]);

      await client.query(`
        UPDATE revive_requests
        SET state = 'WAITING_FOR_PAYMENT', updated_at = $2
        WHERE id = $1
      `, [requestId, now]);

      await client.query('COMMIT');
      return mapTransaction(inserted.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && error.code === '23505') {
        throw new RequestAcceptError('REQUEST_NOT_AVAILABLE', 'Request is already assigned');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    listAvailable,
    acceptRequest
  };
}

module.exports = {
  RequestAcceptError,
  createTransactionRepository
};
