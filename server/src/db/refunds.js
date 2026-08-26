function rowToRefund(row, verifiedAmount = null) {
  if (!row) return null;
  return {
    id: row.id,
    transactionId: row.transaction_id,
    method: row.method,
    requiredAmount: Number(row.required_amount),
    verifiedAmount: verifiedAmount == null ? null : Number(verifiedAmount),
    requiredAt: row.required_at,
    deadline: row.deadline,
    verifiedAt: row.verified_at,
    createdAt: row.created_at
  };
}

function createRefundRepository(pool) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") throw new Error("PostgreSQL pool is required");

  async function getVerificationContext(transactionId) {
    const result = await pool.query(`
      SELECT rf.*, t.state, t.verification_hold_reason,
             t.requester_id, t.reviver_id,
             requester.torn_id AS requester_torn_id,
             reviver.torn_id AS reviver_torn_id,
             p.verified_amount AS payment_verified_amount
      FROM refunds rf
      JOIN transactions t ON t.id = rf.transaction_id
      JOIN users requester ON requester.id = t.requester_id
      JOIN users reviver ON reviver.id = t.reviver_id
      JOIN payments p ON p.transaction_id = t.id
      WHERE rf.transaction_id = $1
    `,[transactionId]);
    if (result.rowCount !== 1) return null;
    const row=result.rows[0];
    const requiredAmount=Number(row.required_amount);
    const paymentAmount=Number(row.payment_verified_amount);
    if (!Number.isSafeInteger(requiredAmount) || requiredAmount <= 0 || requiredAmount !== paymentAmount) {
      throw new Error("Refund obligation does not match verified payment");
    }
    return {
      refundId:row.id,
      transactionId:row.transaction_id,
      state:row.state,
      verificationHoldReason:row.verification_hold_reason,
      requesterUserId:row.requester_id,
      reviverUserId:row.reviver_id,
      requesterTornId:Number(row.requester_torn_id),
      reviverTornId:Number(row.reviver_torn_id),
      method:row.method,
      requiredAmount,
      refundRequiredAt:row.required_at,
      refundDeadline:row.deadline,
      verifiedAt:row.verified_at
    };
  }

  async function recordRefundEvidence({ transactionId, evidence = [], verifiedAt = null }) {
    const rows=Array.isArray(evidence)?evidence:[];
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const refundResult=await client.query("SELECT * FROM refunds WHERE transaction_id=$1 FOR UPDATE",[transactionId]);
      if (refundResult.rowCount !== 1) throw new Error("Refund obligation not found");
      const refund=refundResult.rows[0];
      for (const row of rows) {
        const id=String(row && row.id || "").trim();
        const amount=Number(row && row.amount);
        const at=row && row.at instanceof Date ? row.at : new Date(row && row.at);
        if (!id || !Number.isSafeInteger(amount) || amount <= 0 || Number.isNaN(at.getTime())) throw new Error("Refund evidence row is invalid");
        await client.query(`
          INSERT INTO refund_evidence(refund_id,torn_evidence_id,evidence_timestamp,amount,details)
          VALUES($1,$2,$3,$4,$5::jsonb)
          ON CONFLICT (torn_evidence_id) DO NOTHING
        `,[refund.id,id,at,amount,JSON.stringify({})]);
      }
      const totalResult=await client.query("SELECT COALESCE(SUM(amount),0)::numeric(20,0) AS total FROM refund_evidence WHERE refund_id=$1",[refund.id]);
      const total=Number(totalResult.rows[0].total);
      if (!Number.isSafeInteger(total) || total < 0) throw new Error("Refund evidence total exceeds safe integer range");
      let updated=refund;
      if (verifiedAt != null && total >= Number(refund.required_amount)) {
        const at=verifiedAt instanceof Date ? verifiedAt : new Date(verifiedAt);
        if (Number.isNaN(at.getTime())) throw new Error("verifiedAt must be a valid date");
        const result=await client.query("UPDATE refunds SET verified_at=COALESCE(verified_at,$2) WHERE id=$1 RETURNING *",[refund.id,at]);
        updated=result.rows[0];
      }
      await client.query("COMMIT");
      return rowToRefund(updated,total);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  return { getVerificationContext, recordRefundEvidence };
}

module.exports = { createRefundRepository };
