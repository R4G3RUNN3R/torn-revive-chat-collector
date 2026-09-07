const ADJUSTMENT_TYPES = Object.freeze(['FULL_REFUND','ENTITLEMENT_CORRECTION','COMPLIMENTARY_GRANT']);
const PRO_STATES = Object.freeze(['NONE','TRIAL','ACTIVE','EXPIRED','REVOKED']);

function assertDate(value, code) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(code);
}

function normalizeActorTornId(value) {
  const number=Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('ADJUSTMENT_ACTOR_REQUIRED');
  return number;
}

function rowToAdjustment(row) {
  if (!row) return null;
  return {
    id:row.id,
    userId:row.user_id,
    invoiceId:row.invoice_id || null,
    adjustmentType:row.adjustment_type,
    currency:row.currency || null,
    amount:row.amount === null || row.amount === undefined ? null : Number(row.amount),
    entitlementMonths:row.entitlement_months === null || row.entitlement_months === undefined ? null : Number(row.entitlement_months),
    reason:row.reason,
    actorType:row.actor_type,
    actorTornId:row.actor_torn_id === null || row.actor_torn_id === undefined ? null : Number(row.actor_torn_id),
    createdAt:row.created_at,
    previousState:row.previous_state,
    previousValidUntil:row.previous_valid_until || null,
    newState:row.new_state,
    newValidUntil:row.new_valid_until || null
  };
}

async function recordAdjustmentWithClient(client, {
  userId,
  invoiceId=null,
  adjustmentType,
  currency=null,
  amount=null,
  entitlementMonths=null,
  reason,
  actorType='operator',
  actorTornId,
  createdAt=new Date(),
  previousStatus,
  newStatus
}) {
  if (!client || typeof client.query !== 'function') throw new Error('PostgreSQL client is required');
  if (!ADJUSTMENT_TYPES.includes(adjustmentType)) throw new Error('INVALID_ADJUSTMENT_TYPE');
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500) throw new Error('ADJUSTMENT_REASON_REQUIRED');
  if (actorType !== 'operator' && actorType !== 'system') throw new Error('INVALID_ADJUSTMENT_ACTOR_TYPE');
  const normalizedActorTornId = actorType === 'operator' ? normalizeActorTornId(actorTornId) : null;
  assertDate(createdAt,'INVALID_ADJUSTMENT_DATE');
  if (!previousStatus || !PRO_STATES.includes(previousStatus.state)) throw new Error('INVALID_PREVIOUS_PRO_STATE');
  if (!newStatus || !PRO_STATES.includes(newStatus.state)) throw new Error('INVALID_NEW_PRO_STATE');

  const result=await client.query(`
    INSERT INTO pro_billing_adjustments (
      user_id,invoice_id,adjustment_type,currency,amount,entitlement_months,
      reason,actor_type,actor_torn_id,created_at,
      previous_state,previous_valid_until,new_state,new_valid_until
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *
  `,[
    userId,
    invoiceId,
    adjustmentType,
    currency,
    amount,
    entitlementMonths,
    reason.trim(),
    actorType,
    normalizedActorTornId,
    createdAt,
    previousStatus.state,
    previousStatus.validUntil || null,
    newStatus.state,
    newStatus.validUntil || null
  ]);
  return rowToAdjustment(result.rows[0]);
}

async function listForUser(pool,userId) {
  const result=await pool.query(`
    SELECT *
    FROM pro_billing_adjustments
    WHERE user_id=$1
    ORDER BY created_at ASC,id ASC
  `,[userId]);
  return result.rows.map(rowToAdjustment);
}

function createProBillingAdjustmentRepository(pool) {
  if (!pool || typeof pool.query !== 'function') throw new Error('PostgreSQL pool is required');
  return Object.freeze({
    listForUser(userId){return listForUser(pool,userId);}
  });
}

module.exports={
  ADJUSTMENT_TYPES,
  PRO_STATES,
  rowToAdjustment,
  recordAdjustmentWithClient,
  listForUser,
  createProBillingAdjustmentRepository
};
