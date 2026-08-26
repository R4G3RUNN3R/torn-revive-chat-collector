function rowToAttempt(row) {
  if (!row) return null;
  return {
    id:row.id,
    transactionId:row.transaction_id,
    reviverId:row.reviver_id,
    tornEvidenceId:row.torn_evidence_id,
    attemptTimestamp:row.attempt_timestamp,
    success:row.success,
    sequenceNumber:Number(row.sequence_number),
    createdAt:row.created_at
  };
}

function rowToContext(row) {
  if (!row) return null;
  return {
    transactionId:row.transaction_id,
    requesterUserId:row.requester_id,
    reviverUserId:row.reviver_id,
    requesterTornId:Number(row.requester_torn_id),
    reviverTornId:Number(row.reviver_torn_id),
    state:row.state,
    paymentVerifiedAt:row.payment_verified_at,
    attemptWindowStart:row.attempt_window_start,
    reviveDeadline:row.revive_deadline,
    retryResponseDeadline:row.retry_response_deadline,
    requesterHospitalUntil:row.requester_hospital_until,
    requesterHospitalObservedAt:row.requester_hospital_observed_at,
    verificationHoldReason:row.verification_hold_reason
  };
}

function createReviveAttemptRepository(pool) {
  if (!pool || typeof pool.query!=='function' || typeof pool.connect!=='function') throw new Error('PostgreSQL pool is required');

  async function getVerificationContext(transactionId) {
    const result=await pool.query(`
      SELECT
        t.id AS transaction_id,t.requester_id,t.reviver_id,t.state,
        t.payment_verified_at,t.revive_deadline,t.retry_response_deadline,t.requester_hospital_until,
        t.requester_hospital_observed_at,t.verification_hold_reason,
        requester.torn_id AS requester_torn_id,
        reviver.torn_id AS reviver_torn_id,
        COALESCE((
          SELECT MAX(h.created_at)
          FROM transaction_state_history h
          WHERE h.transaction_id=t.id
            AND h.to_state='WAITING_FOR_REVIVE'
        ),t.payment_verified_at) AS attempt_window_start
      FROM transactions t
      JOIN users requester ON requester.id=t.requester_id
      JOIN users reviver ON reviver.id=t.reviver_id
      WHERE t.id=$1
    `,[transactionId]);
    return result.rowCount===1 ? rowToContext(result.rows[0]) : null;
  }

  async function recordHospitalBaseline({transactionId,until,observedAt=new Date()}) {
    const untilDate=until instanceof Date?until:new Date(until);
    if(Number.isNaN(untilDate.getTime())) throw new Error('Hospital until must be a valid date');
    const result=await pool.query(`
      UPDATE transactions
      SET requester_hospital_until=COALESCE(requester_hospital_until,$2),
          requester_hospital_observed_at=COALESCE(requester_hospital_observed_at,$3),
          updated_at=$3
      WHERE id=$1
      RETURNING *
    `,[transactionId,untilDate,observedAt]);
    return result.rowCount===1 ? rowToContext({
      ...result.rows[0],
      transaction_id:result.rows[0].id,
      requester_torn_id:null,
      reviver_torn_id:null,
      attempt_window_start:result.rows[0].payment_verified_at
    }) : null;
  }

  async function recordAttempt({transactionId,reviverUserId,evidence}) {
    const id=String(evidence&&evidence.id||'').trim();
    const at=evidence&&evidence.at instanceof Date?evidence.at:new Date(evidence&&evidence.at);
    if(!id||Number.isNaN(at.getTime())||typeof(evidence&&evidence.success)!=='boolean') throw new Error('Revive evidence is invalid');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT id FROM transactions WHERE id=$1 FOR UPDATE',[transactionId]);
      const existing=await client.query('SELECT * FROM revive_attempts WHERE torn_evidence_id=$1',[id]);
      if(existing.rowCount===1){await client.query('COMMIT');return rowToAttempt(existing.rows[0]);}
      const seq=await client.query('SELECT COALESCE(MAX(sequence_number),0)::int+1 AS next FROM revive_attempts WHERE transaction_id=$1',[transactionId]);
      const inserted=await client.query(`
        INSERT INTO revive_attempts(transaction_id,reviver_id,torn_evidence_id,attempt_timestamp,success,sequence_number)
        VALUES($1,$2,$3,$4,$5,$6)
        RETURNING *
      `,[transactionId,reviverUserId,id,at,evidence.success,seq.rows[0].next]);
      await client.query('COMMIT');
      return rowToAttempt(inserted.rows[0]);
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  return {getVerificationContext,recordHospitalBaseline,recordAttempt};
}

module.exports={createReviveAttemptRepository};
