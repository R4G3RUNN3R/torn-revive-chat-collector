const { canTransition, isTerminalState, STATES } = require('./transaction-state');

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
    refundReason: row.refund_reason,
    verificationHoldReason: row.verification_hold_reason,
    verificationHoldStartedAt: row.verification_hold_started_at,
    verificationHoldMetadata: row.verification_hold_metadata || {},
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToRequest(row) {
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

function assertPool(pool) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new Error('PostgreSQL pool is required');
  }
}

function safeActor(actor) {
  const input = actor && typeof actor === 'object' ? actor : {};
  const type = String(input.type || 'system').trim();
  if (!type) throw new Error('Transition actor type is required');
  return { type: type.slice(0, 50), id: input.id || null };
}

function refundReasonFor(event, details) {
  if (details && details.refundReason) return String(details.refundReason).slice(0, 100);
  if (event === 'late_payment') return 'late_payment';
  if (event === 'third_party_revive') return 'third_party_revive';
  if (event === 'refund_requested') return 'failed_attempt_requester_choice';
  if (event === 'retry_declined') return 'retry_declined';
  if (event === 'retry_timeout') return 'retry_timeout';
  return null;
}

function createTransactionService(pool) {
  assertPool(pool);

  async function transitionTransaction({
    transactionId,
    event,
    actor = { type: 'system' },
    details = {},
    now = new Date()
  }) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('now must be a valid Date');
    const normalizedActor = safeActor(actor);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(`
        SELECT t.*, r.state AS request_state, r.closed_at AS request_closed_at, r.payment_method AS request_payment_method
        FROM transactions t
        JOIN revive_requests r ON r.id = t.request_id
        WHERE t.id = $1
        FOR UPDATE OF t, r
      `, [transactionId]);
      if (current.rowCount !== 1) {
        await client.query('ROLLBACK');
        return { transitioned: false, reason: 'TRANSACTION_NOT_FOUND' };
      }

      const row = current.rows[0];
      const nextState = canTransition(row.state, event);
      if (!nextState) {
        await client.query('ROLLBACK');
        return {
          transitioned: false,
          reason: 'TRANSACTION_STATE_CONFLICT',
          transaction: rowToTransaction(row)
        };
      }

      const paymentVerifiedAt = event === 'payment_verified'
        ? (details.paymentVerifiedAt instanceof Date ? details.paymentVerifiedAt : now)
        : row.payment_verified_at;
      const reviveDeadline = event === 'payment_verified'
        ? (details.reviveDeadline instanceof Date ? details.reviveDeadline : new Date(paymentVerifiedAt.getTime() + 5 * 60 * 1000))
        : event === 'retry_accepted'
          ? (details.reviveDeadline instanceof Date ? details.reviveDeadline : new Date(now.getTime() + 5 * 60 * 1000))
          : row.revive_deadline;
      const retryResponseDeadline = event === "retry_requested"
        ? (details.retryResponseDeadline instanceof Date ? details.retryResponseDeadline : new Date(now.getTime() + 2 * 60 * 1000))
        : ["retry_accepted", "retry_declined", "retry_timeout"].includes(event)
          ? null
          : row.retry_response_deadline;
      const paymentReconcileUntil = event === 'deadline' && row.state === STATES.WAITING_FOR_PAYMENT && details.reconcileUntil instanceof Date
        ? details.reconcileUntil
        : row.payment_reconcile_until;
      const refundRequired = nextState === STATES.REFUND_REQUIRED && row.state !== STATES.REFUND_REQUIRED;
      const refundRequiredAt = refundRequired ? now : row.refund_required_at;
      const refundDeadline = refundRequired
        ? (details.refundDeadline instanceof Date ? details.refundDeadline : new Date(now.getTime() + 10 * 60 * 1000))
        : row.refund_deadline;
      const refundReason = refundRequired ? refundReasonFor(event, details) : row.refund_reason;
      const terminal = isTerminalState(nextState);
      const transactionClosedAt = terminal ? now : row.closed_at;

      const updatedTransaction = await client.query(`
        UPDATE transactions
        SET state = $2,
            payment_reconcile_until = $3,
            payment_verified_at = $4,
            revive_deadline = $5,
            retry_response_deadline = $6,
            refund_required_at = $7,
            refund_deadline = $8,
            refund_reason = $9,
            closed_at = $10,
            updated_at = $11
        WHERE id = $1
        RETURNING *
      `, [
        transactionId,
        nextState,
        paymentReconcileUntil,
        paymentVerifiedAt,
        reviveDeadline,
        retryResponseDeadline,
        refundRequiredAt,
        refundDeadline,
        refundReason,
        transactionClosedAt,
        now
      ]);

      if (refundRequired) {
        const paymentResult = await client.query(`
          SELECT verified_amount
          FROM payments
          WHERE transaction_id = $1
          FOR SHARE
        `, [transactionId]);
        if (paymentResult.rowCount !== 1) throw new Error("Verified payment is required before refund obligation");
        const requiredAmount = Number(paymentResult.rows[0].verified_amount);
        if (!Number.isSafeInteger(requiredAmount) || requiredAmount <= 0) throw new Error("Verified payment amount is invalid");

        const refundResult = await client.query(`
          INSERT INTO refunds (transaction_id, method, required_amount, required_at, deadline)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (transaction_id) DO UPDATE
          SET transaction_id = EXCLUDED.transaction_id
          WHERE refunds.method = EXCLUDED.method
            AND refunds.required_amount = EXCLUDED.required_amount
            AND refunds.required_at = EXCLUDED.required_at
            AND refunds.deadline = EXCLUDED.deadline
          RETURNING id
        `, [transactionId, row.request_payment_method, requiredAmount, refundRequiredAt, refundDeadline]);
        if (refundResult.rowCount !== 1) throw new Error("Existing refund obligation does not match transition contract");

        await client.query(`
          INSERT INTO jobs (type, entity_id, run_at, payload, dedupe_key)
          VALUES ($1,$2,$3,$4::jsonb,$5)
          ON CONFLICT (dedupe_key) WHERE completed_at IS NULL AND dedupe_key IS NOT NULL
          DO UPDATE SET run_at = LEAST(jobs.run_at, EXCLUDED.run_at), updated_at = EXCLUDED.updated_at
        `, ["refund.verify", transactionId, now, JSON.stringify({ transactionId }), `refund.verify:${transactionId}`]);
      }

      let requestState = nextState;
      let requestClosedAt = row.request_closed_at;
      if (nextState === STATES.PAYMENT_EXPIRED) {
        requestState = STATES.AVAILABLE;
        requestClosedAt = null;
      } else if (nextState === STATES.CANCELLED_BY_REQUESTER) {
        requestState = 'CANCELLED';
        requestClosedAt = now;
      } else if (terminal) {
        requestClosedAt = now;
      }

      const updatedRequest = await client.query(`
        UPDATE revive_requests
        SET state = $2,
            closed_at = $3,
            cancelled_at = CASE WHEN $2 = 'CANCELLED' THEN $4 ELSE cancelled_at END,
            updated_at = $4
        WHERE id = $1
        RETURNING *
      `, [row.request_id, requestState, requestClosedAt, now]);

      await client.query(`
        INSERT INTO transaction_state_history (
          transaction_id, from_state, to_state, event_code,
          actor_type, actor_id, details, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      `, [
        transactionId,
        row.state,
        nextState,
        String(event).slice(0, 100),
        normalizedActor.type,
        normalizedActor.id,
        JSON.stringify(details || {}),
        now
      ]);

      await client.query(`
        INSERT INTO audit_events (
          actor_type, actor_id, entity_type, entity_id, action, details, created_at
        ) VALUES ($1,$2,'transaction',$3,'transaction.transitioned',$4::jsonb,$5)
      `, [
        normalizedActor.type,
        normalizedActor.id,
        transactionId,
        JSON.stringify({ fromState: row.state, toState: nextState, event: String(event).slice(0, 100) }),
        now
      ]);

      await client.query('COMMIT');
      return {
        transitioned: true,
        transaction: rowToTransaction(updatedTransaction.rows[0]),
        request: rowToRequest(updatedRequest.rows[0])
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function setVerificationHold({ transactionId, reason, metadata = {}, now = new Date() }) {
    const safeReason = String(reason || '').trim().slice(0, 200);
    if (!safeReason) throw new Error('Verification hold reason is required');
    const result = await pool.query(`
      UPDATE transactions
      SET verification_hold_reason = $2,
          verification_hold_started_at = COALESCE(verification_hold_started_at, $3),
          verification_hold_metadata = $4::jsonb,
          updated_at = $3
      WHERE id = $1
      RETURNING *
    `, [transactionId, safeReason, now, JSON.stringify(metadata || {})]);
    if (result.rowCount !== 1) return null;
    await pool.query(`
      INSERT INTO audit_events (actor_type, entity_type, entity_id, action, details, created_at)
      VALUES ('system','transaction',$1,'transaction.verification_hold_set',$2::jsonb,$3)
    `, [transactionId, JSON.stringify({ reason: safeReason }), now]);
    return rowToTransaction(result.rows[0]);
  }

  async function clearVerificationHold({ transactionId, now = new Date() }) {
    const result = await pool.query(`
      UPDATE transactions
      SET verification_hold_reason = NULL,
          verification_hold_started_at = NULL,
          verification_hold_metadata = '{}'::jsonb,
          updated_at = $2
      WHERE id = $1
      RETURNING *
    `, [transactionId, now]);
    if (result.rowCount !== 1) return null;
    await pool.query(`
      INSERT INTO audit_events (actor_type, entity_type, entity_id, action, details, created_at)
      VALUES ('system','transaction',$1,'transaction.verification_hold_cleared','{}'::jsonb,$2)
    `, [transactionId, now]);
    return rowToTransaction(result.rows[0]);
  }

  return {
    transitionTransaction,
    setVerificationHold,
    clearVerificationHold
  };
}

module.exports = {
  createTransactionService
};
