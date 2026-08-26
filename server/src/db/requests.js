const { canTransition } = require('../domain/transaction-state');

function rowToRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    requesterId: row.requester_id,
    paymentMethod: row.payment_method,
    offerAmount: Number(row.offer_amount),
    comment: row.comment,
    state: row.state,
    transactionId: row.transaction_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at,
    closedAt: row.closed_at
  };
}

async function createRequest(pool, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [input.requesterId]
    );

    const existingResult = await client.query(`
      SELECT *
      FROM revive_requests
      WHERE requester_id = $1
        AND closed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `, [input.requesterId]);

    if (existingResult.rowCount === 1) {
      const existing = existingResult.rows[0];

      if (existing.state !== 'AVAILABLE') {
        await client.query('ROLLBACK');
        return {
          created: false,
          updated: false,
          reason: 'REQUEST_COMMITTED',
          request: rowToRequest(existing)
        };
      }

      const updated = await client.query(`
        UPDATE revive_requests
        SET payment_method = $2,
            offer_amount = $3,
            comment = $4,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `, [
        existing.id,
        input.paymentMethod,
        input.offerAmount,
        input.comment == null ? null : input.comment
      ]);

      await client.query(`
        INSERT INTO audit_events (
          actor_type,
          actor_id,
          entity_type,
          entity_id,
          action,
          details
        ) VALUES (
          'user',
          $1,
          'revive_request',
          $2,
          'request.updated',
          jsonb_build_object(
            'paymentMethod', $3::text,
            'offerAmount', $4::bigint
          )
        )
      `, [input.requesterId, existing.id, input.paymentMethod, input.offerAmount]);

      await client.query('COMMIT');
      return {
        created: false,
        updated: true,
        request: rowToRequest(updated.rows[0])
      };
    }

    const inserted = await client.query(`
      INSERT INTO revive_requests (
        requester_id,
        payment_method,
        offer_amount,
        comment,
        state
      ) VALUES ($1, $2, $3, $4, 'AVAILABLE')
      RETURNING *
    `, [
      input.requesterId,
      input.paymentMethod,
      input.offerAmount,
      input.comment == null ? null : input.comment
    ]);

    await client.query(`
      INSERT INTO audit_events (
        actor_type,
        actor_id,
        entity_type,
        entity_id,
        action,
        details
      ) VALUES (
        'user',
        $1,
        'revive_request',
        $2,
        'request.created',
        jsonb_build_object(
          'paymentMethod', $3::text,
          'offerAmount', $4::bigint
        )
      )
    `, [input.requesterId, inserted.rows[0].id, input.paymentMethod, input.offerAmount]);

    await client.query('COMMIT');
    return {
      created: true,
      updated: false,
      request: rowToRequest(inserted.rows[0])
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getActiveRequest(pool, requesterId) {
  const result = await pool.query(`
    SELECT r.*, tx.id AS transaction_id
    FROM revive_requests r
    LEFT JOIN LATERAL (
      SELECT t.id
      FROM transactions t
      WHERE t.request_id = r.id
        AND t.closed_at IS NULL
      ORDER BY t.accepted_at DESC, t.created_at DESC
      LIMIT 1
    ) tx ON true
    WHERE r.requester_id = $1
      AND r.closed_at IS NULL
    ORDER BY r.created_at DESC
    LIMIT 1
  `, [requesterId]);

  return result.rowCount === 1 ? rowToRequest(result.rows[0]) : null;
}

async function cancelRequest(pool, { requestId, requesterId, now = new Date() }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query(`
      SELECT *
      FROM revive_requests
      WHERE id = $1
        AND requester_id = $2
      FOR UPDATE
    `, [requestId, requesterId]);

    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return { cancelled: false, reason: 'NOT_FOUND', request: null };
    }

    const request = current.rows[0];
    if (request.closed_at) {
      await client.query('ROLLBACK');
      return {
        cancelled: false,
        reason: 'REQUEST_COMMITTED',
        request: rowToRequest(request)
      };
    }

    const transactionResult = await client.query(`
      SELECT *
      FROM transactions
      WHERE request_id = $1
        AND closed_at IS NULL
      ORDER BY accepted_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
    `, [requestId]);

    let transactionId = null;

    if (transactionResult.rowCount === 0) {
      if (request.state !== 'AVAILABLE') {
        await client.query('ROLLBACK');
        return {
          cancelled: false,
          reason: 'REQUEST_COMMITTED',
          request: rowToRequest(request)
        };
      }
    } else {
      const transaction = transactionResult.rows[0];
      transactionId = transaction.id;
      const cancellationState = canTransition(transaction.state, 'requester_cancel');

      if (request.state !== 'WAITING_FOR_PAYMENT' ||
          transaction.payment_verified_at ||
          !cancellationState) {
        await client.query('ROLLBACK');
        return {
          cancelled: false,
          reason: 'PAYMENT_COMMITTED',
          request: rowToRequest(request)
        };
      }

      const payment = await client.query(
        'SELECT 1 FROM payments WHERE transaction_id = $1 LIMIT 1',
        [transaction.id]
      );

      if (payment.rowCount > 0) {
        await client.query('ROLLBACK');
        return {
          cancelled: false,
          reason: 'PAYMENT_COMMITTED',
          request: rowToRequest(request)
        };
      }

      await client.query(`
        UPDATE transactions
        SET state = $2,
            closed_at = $3,
            updated_at = $3
        WHERE id = $1
      `, [transaction.id, cancellationState, now]);


      await client.query(`
        INSERT INTO transaction_state_history (
          transaction_id, from_state, to_state, event_code,
          actor_type, actor_id, details, created_at
        ) VALUES ($1,$2,$3,'requester_cancel','user',$4,'{}'::jsonb,$5)
      `, [transaction.id, transaction.state, cancellationState, requesterId, now]);

      await client.query(`
        UPDATE jobs
        SET completed_at = COALESCE(completed_at, $2),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = $2
        WHERE entity_id = $1
          AND type = 'payment.verify'
          AND completed_at IS NULL
      `, [transaction.id, now]);
    }

    const updated = await client.query(`
      UPDATE revive_requests
      SET state = 'CANCELLED',
          cancelled_at = $3,
          closed_at = $3,
          updated_at = $3
      WHERE id = $1
        AND requester_id = $2
      RETURNING *
    `, [requestId, requesterId, now]);

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
        'revive_request',
        $2,
        'request.cancelled',
        jsonb_build_object(
          'previousState', $3::text,
          'transactionId', $4::text
        ),
        $5
      )
    `, [requesterId, requestId, request.state, transactionId, now]);

    await client.query('COMMIT');
    return {
      cancelled: true,
      request: rowToRequest(updated.rows[0])
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function createRequestRepository(pool) {
  return {
    createRequest(input) {
      return createRequest(pool, input);
    },
    getActiveRequest(requesterId) {
      return getActiveRequest(pool, requesterId);
    },
    cancelRequest(input) {
      return cancelRequest(pool, input);
    }
  };
}

module.exports = {
  createRequest,
  getActiveRequest,
  cancelRequest,
  createRequestRepository
};
