function rowToPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    transactionId: row.transaction_id,
    method: row.method,
    expectedAmount: Number(row.expected_amount),
    verifiedAmount: Number(row.verified_amount),
    evidenceTimestamp: row.evidence_timestamp,
    verifiedAt: row.verified_at,
    createdAt: row.created_at
  };
}

function createPaymentRepository(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new Error('PostgreSQL pool is required');
  }

  async function getVerificationContext(transactionId) {
    const result = await pool.query(`
      SELECT
        t.id AS transaction_id,
        t.state,
        t.accepted_at,
        t.payment_deadline,
        t.payment_reconcile_until,
        t.verification_hold_reason,
        t.requester_id,
        t.reviver_id,
        rq.payment_method,
        rq.offer_amount,
        requester.torn_id AS requester_torn_id,
        reviver.torn_id AS reviver_torn_id
      FROM transactions t
      JOIN revive_requests rq ON rq.id = t.request_id
      JOIN users requester ON requester.id = t.requester_id
      JOIN users reviver ON reviver.id = t.reviver_id
      WHERE t.id = $1
    `, [transactionId]);
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];
    return {
      transactionId: row.transaction_id,
      state: row.state,
      acceptedAt: row.accepted_at,
      paymentDeadline: row.payment_deadline,
      paymentReconcileUntil: row.payment_reconcile_until,
      verificationHoldReason: row.verification_hold_reason,
      requesterUserId: row.requester_id,
      reviverUserId: row.reviver_id,
      requesterTornId: Number(row.requester_torn_id),
      reviverTornId: Number(row.reviver_torn_id),
      method: row.payment_method,
      offerAmount: Number(row.offer_amount)
    };
  }

  async function recordVerifiedPayment({
    transactionId,
    method,
    expectedAmount,
    verifiedAmount,
    evidence,
    verifiedAt = new Date()
  }) {
    if (!['cash','xanax'].includes(method)) throw new Error('Unsupported payment method');
    if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0) throw new Error('Expected amount must be a safe positive integer');
    if (!Number.isSafeInteger(verifiedAmount) || verifiedAmount < expectedAmount) throw new Error('Verified amount must cover the expected amount');
    const evidenceRows = Array.isArray(evidence) ? evidence : [];
    if (!evidenceRows.length) throw new Error('Payment evidence is required');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const earliest = evidenceRows.reduce((min,row) => {
        const at = row.at instanceof Date ? row.at : new Date(row.at);
        if (Number.isNaN(at.getTime())) throw new Error('Payment evidence timestamp is invalid');
        return !min || at < min ? at : min;
      }, null);

      const inserted = await client.query(`
        INSERT INTO payments (
          transaction_id, method, expected_amount, verified_amount,
          torn_evidence_id, evidence_timestamp, verified_at
        ) VALUES ($1,$2,$3,$4,NULL,$5,$6)
        ON CONFLICT (transaction_id) DO UPDATE
        SET verified_amount = GREATEST(payments.verified_amount, EXCLUDED.verified_amount),
            evidence_timestamp = LEAST(payments.evidence_timestamp, EXCLUDED.evidence_timestamp),
            verified_at = LEAST(payments.verified_at, EXCLUDED.verified_at)
        WHERE payments.method = EXCLUDED.method
          AND payments.expected_amount = EXCLUDED.expected_amount
        RETURNING *
      `, [transactionId, method, expectedAmount, verifiedAmount, earliest, verifiedAt]);
      if (inserted.rowCount !== 1) throw new Error('Existing payment contract does not match verification input');
      const payment = inserted.rows[0];

      for (const row of evidenceRows) {
        const id = String(row && row.id || '').trim();
        const amount = Number(row && row.amount);
        const at = row && row.at instanceof Date ? row.at : new Date(row && row.at);
        if (!id || !Number.isSafeInteger(amount) || amount <= 0 || Number.isNaN(at.getTime())) {
          throw new Error('Payment evidence row is invalid');
        }
        await client.query(`
          INSERT INTO payment_evidence (
            payment_id, torn_evidence_id, evidence_timestamp, amount, details
          ) VALUES ($1,$2,$3,$4,'{}'::jsonb)
          ON CONFLICT (torn_evidence_id) DO NOTHING
        `, [payment.id, id, at, amount]);
      }

      await client.query('COMMIT');
      return rowToPayment(payment);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    getVerificationContext,
    recordVerifiedPayment
  };
}

module.exports = { createPaymentRepository };
