const { canTransition } = require('../domain/transaction-state');

function rowToTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    requesterId: row.requester_id,
    reviverId: row.reviver_id,
    state: row.state,
    acceptedAt: row.accepted_at,
    paymentDeadline: row.payment_deadline,
    paymentReconcileUntil: row.payment_reconcile_until,
    paymentVerifiedAt: row.payment_verified_at,
    reviveDeadline: row.revive_deadline,
    retryResponseDeadline: row.retry_response_deadline,
    refundRequiredAt: row.refund_required_at,
    refundDeadline: row.refund_deadline,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToQueueRequest(row) {
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterTornId: row.requester_torn_id == null ? null : Number(row.requester_torn_id),
    requesterName: row.requester_name,
    paymentMethod: row.payment_method,
    offerAmount: Number(row.offer_amount),
    comment: row.comment,
    state: row.state,
    createdAt: row.created_at
  };
}

async function acceptRequest(pool, { requestId, reviverId, now = new Date() }) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('now must be a valid Date');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const requestResult = await client.query(`
      SELECT *
      FROM revive_requests
      WHERE id = $1
        AND closed_at IS NULL
      FOR UPDATE
    `, [requestId]);

    if (requestResult.rowCount !== 1 || requestResult.rows[0].state !== 'AVAILABLE') {
      await client.query('ROLLBACK');
      return { accepted: false, reason: 'REQUEST_UNAVAILABLE' };
    }

    if (requestResult.rows[0].requester_id === reviverId) {
      await client.query('ROLLBACK');
      return { accepted: false, reason: 'SELF_ACCEPT_NOT_ALLOWED' };
    }

    const reviver = await client.query(`
      SELECT user_id
      FROM revivers
      WHERE user_id = $1
        AND standing = 'active'
    `, [reviverId]);

    if (reviver.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { accepted: false, reason: 'REVIVER_NOT_ELIGIBLE' };
    }

    const nextState = canTransition(requestResult.rows[0].state, 'accept');
    if (!nextState) {
      await client.query('ROLLBACK');
      return { accepted: false, reason: 'REQUEST_UNAVAILABLE' };
    }

    const transactionResult = await client.query(`
      INSERT INTO transactions (
        request_id,
        requester_id,
        reviver_id,
        state,
        accepted_at,
        payment_deadline
      ) VALUES (
        $1, $2, $3, $4, $5,
        $5::timestamptz + interval '3 minutes'
      )
      RETURNING *
    `, [
      requestId,
      requestResult.rows[0].requester_id,
      reviverId,
      nextState,
      now
    ]);

    await client.query(`
      UPDATE revive_requests
      SET state = $2,
          updated_at = $3
      WHERE id = $1
    `, [requestId, nextState, now]);

    const transaction = transactionResult.rows[0];
    await client.query(`
      INSERT INTO audit_events (
        actor_type,
        actor_id,
        entity_type,
        entity_id,
        action,
        details,
        created_at
      ) VALUES (
        'user',
        $1,
        'transaction',
        $2,
        'transaction.accepted',
        jsonb_build_object(
          'requestId', $3::text,
          'requesterId', $4::text,
          'paymentDeadline', $5::timestamptz
        ),
        $6
      )
    `, [
      reviverId,
      transaction.id,
      requestId,
      requestResult.rows[0].requester_id,
      transaction.payment_deadline,
      now
    ]);

    await client.query('COMMIT');
    return {
      accepted: true,
      transaction: rowToTransaction(transaction)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listAvailableRequests(pool, limit = 100) {
  const normalizedLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 100));
  const result = await pool.query(`
    SELECT
      r.id,
      r.requester_id,
      u.torn_id AS requester_torn_id,
      u.current_name AS requester_name,
      r.payment_method,
      r.offer_amount,
      r.comment,
      r.state,
      r.created_at
    FROM revive_requests r
    JOIN users u ON u.id = r.requester_id
    WHERE r.state = 'AVAILABLE'
      AND r.closed_at IS NULL
    ORDER BY r.created_at ASC, r.id ASC
    LIMIT $1
  `, [normalizedLimit]);

  return result.rows.map(rowToQueueRequest);
}

function createTransactionRepository(pool) {
  return {
    acceptRequest(input) {
      return acceptRequest(pool, input);
    },
    listAvailableRequests(limit) {
      return listAvailableRequests(pool, limit);
    }
  };
}

module.exports = {
  acceptRequest,
  listAvailableRequests,
  createTransactionRepository
};
