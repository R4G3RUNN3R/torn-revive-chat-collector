const { extendCalendarDuration } = require('../domain/pro-plans');

const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

function assertDate(value, code) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(code);
}

function maxDate(...values) {
  const dates = values.filter(value => value instanceof Date && !Number.isNaN(value.getTime()));
  if (!dates.length) throw new Error('NO_VALID_BASE_DATE');
  return new Date(Math.max(...dates.map(value => value.getTime())));
}

function statusFromRow(row, now) {
  assertDate(now, 'INVALID_STATUS_DATE');
  if (!row) {
    return {
      state: 'NONE',
      trialEligible: true,
      trialStartedAt: null,
      validUntil: null
    };
  }

  const trialStartedAt = row.trial_started_at || null;
  const trialEndsAt = row.trial_ends_at || null;
  const paidUntil = row.paid_until || null;
  let state;

  if (row.revoked_at) state = 'EXPIRED';
  else if (paidUntil && paidUntil.getTime() > now.getTime()) state = 'ACTIVE';
  else if (trialEndsAt && trialEndsAt.getTime() > now.getTime()) state = 'TRIAL';
  else if (trialStartedAt || row.ever_paid) state = 'EXPIRED';
  else state = 'NONE';

  let validUntil = null;
  if (state === 'ACTIVE') validUntil = paidUntil;
  else if (state === 'TRIAL') validUntil = trialEndsAt;
  else if (state === 'EXPIRED') {
    const candidates = [paidUntil, trialEndsAt].filter(Boolean);
    validUntil = candidates.length ? maxDate(...candidates) : null;
  }

  return {
    state,
    trialEligible: !trialStartedAt && !row.ever_paid && !row.revoked_at,
    trialStartedAt,
    validUntil
  };
}

async function ensureLockedRow(client, userId) {
  await client.query(`
    INSERT INTO pro_entitlements (user_id)
    VALUES ($1)
    ON CONFLICT (user_id) DO NOTHING
  `, [userId]);
  const result = await client.query(`
    SELECT *
    FROM pro_entitlements
    WHERE user_id = $1
    FOR UPDATE
  `, [userId]);
  if (result.rowCount !== 1) throw new Error('PRO_ENTITLEMENT_NOT_FOUND');
  return result.rows[0];
}

async function getStatus(pool, userId, now = new Date()) {
  assertDate(now, 'INVALID_STATUS_DATE');
  const result = await pool.query(`
    SELECT *
    FROM pro_entitlements
    WHERE user_id = $1
  `, [userId]);
  return statusFromRow(result.rowCount === 1 ? result.rows[0] : null, now);
}

async function startTrial(pool, { userId, now = new Date() }) {
  assertDate(now, 'INVALID_TRIAL_DATE');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await ensureLockedRow(client, userId);
    if (current.ever_paid || current.revoked_at) throw new Error('TRIAL_NOT_ELIGIBLE');
    if (current.trial_started_at) throw new Error('TRIAL_ALREADY_USED');

    const trialEndsAt = new Date(now.getTime() + TRIAL_MS);
    const updated = await client.query(`
      UPDATE pro_entitlements
      SET trial_started_at = $2,
          trial_ends_at = $3,
          updated_at = $2
      WHERE user_id = $1
      RETURNING *
    `, [userId, now, trialEndsAt]);

    await client.query('COMMIT');
    return statusFromRow(updated.rows[0], now);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function hasEverPaid(pool, userId) {
  const result = await pool.query(`
    SELECT ever_paid
    FROM pro_entitlements
    WHERE user_id = $1
  `, [userId]);
  return result.rowCount === 1 && result.rows[0].ever_paid === true;
}

async function activatePaidWithClient(client, { userId, invoiceId, months, paidAt = new Date() }) {
  assertDate(paidAt, 'INVALID_PAID_DATE');
  if (!Number.isInteger(months) || months <= 0) throw new Error('INVALID_MONTH_COUNT');
  if (typeof invoiceId !== 'string' || !invoiceId.trim()) throw new Error('INVALID_INVOICE_ID');
  if (!client || typeof client.query !== 'function') throw new Error('PostgreSQL client is required');

  const current = await ensureLockedRow(client, userId);
  const base = maxDate(paidAt, current.paid_until, current.trial_ends_at);
  const validUntil = extendCalendarDuration(base, months);

  const updated = await client.query(`
    UPDATE pro_entitlements
    SET paid_started_at = COALESCE(paid_started_at, $2),
        paid_until = $3,
        ever_paid = true,
        updated_at = $2
    WHERE user_id = $1
    RETURNING *
  `, [userId, paidAt, validUntil]);

  await client.query(`
    INSERT INTO audit_events (
      actor_type, actor_id, entity_type, entity_id, action, details, created_at
    ) VALUES (
      'system', NULL, 'pro_entitlement', $1, 'pro.paid_activated', $2::jsonb, $3
    )
  `, [userId, JSON.stringify({
    invoiceId: invoiceId.trim(),
    months,
    validUntil: validUntil.toISOString()
  }), paidAt]);

  return statusFromRow(updated.rows[0], paidAt);
}

async function activatePaid(pool, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const status = await activatePaidWithClient(client, input);
    await client.query('COMMIT');
    return status;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function auditDetails({operatorTornId,reason,previousStatus,newStatus}) {
  const operator=Number(operatorTornId);
  return {
    operatorTornId:Number.isSafeInteger(operator) && operator>0 ? operator : null,
    reason,
    previousState:previousStatus.state,
    previousValidUntil:previousStatus.validUntil ? previousStatus.validUntil.toISOString() : null,
    newState:newStatus.state,
    newValidUntil:newStatus.validUntil ? newStatus.validUntil.toISOString() : null
  };
}

async function writeOperatorAudit(client,{userId,action,operatorTornId,reason,previousStatus,newStatus,now}) {
  await client.query(`
    INSERT INTO audit_events (
      actor_type, actor_id, entity_type, entity_id, action, details, created_at
    ) VALUES ('operator',NULL,'pro_entitlement',$1,$2,$3::jsonb,$4)
  `,[userId,action,JSON.stringify(auditDetails({operatorTornId,reason,previousStatus,newStatus})),now]);
}

async function grantManual(pool,{userId,months,reason,operatorTornId=null,now=new Date()}) {
  assertDate(now,'INVALID_GRANT_DATE');
  if (!Number.isInteger(months) || months<1 || months>12) throw new Error('INVALID_GRANT_MONTHS');
  if (typeof reason!=='string' || !reason.trim()) throw new Error('GRANT_REASON_REQUIRED');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const current=await ensureLockedRow(client,userId);
    const previousStatus=statusFromRow(current,now);
    const base=maxDate(now,current.paid_until,current.trial_ends_at);
    const validUntil=extendCalendarDuration(base,months);
    const updated=await client.query(`
      UPDATE pro_entitlements
      SET paid_started_at=COALESCE(paid_started_at,$2),
          paid_until=$3,
          ever_paid=true,
          revoked_at=NULL,
          revoke_reason=NULL,
          updated_at=$2
      WHERE user_id=$1
      RETURNING *
    `,[userId,now,validUntil]);
    const newStatus=statusFromRow(updated.rows[0],now);
    await writeOperatorAudit(client,{
      userId,action:'pro.manual_grant',operatorTornId,reason:reason.trim(),previousStatus,newStatus,now
    });
    await client.query('COMMIT');
    return newStatus;
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function correctExpiry(pool,{userId,validUntil,reason,operatorTornId=null,now=new Date()}) {
  assertDate(now,'INVALID_CORRECTION_DATE');
  assertDate(validUntil,'INVALID_VALID_UNTIL');
  if (typeof reason!=='string' || !reason.trim()) throw new Error('CORRECTION_REASON_REQUIRED');
  const maximum=extendCalendarDuration(now,24);
  if (validUntil.getTime()>maximum.getTime()) throw new Error('VALID_UNTIL_TOO_FAR');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const current=await ensureLockedRow(client,userId);
    const previousStatus=statusFromRow(current,now);
    const updated=await client.query(`
      UPDATE pro_entitlements
      SET paid_started_at=COALESCE(paid_started_at,$2),
          paid_until=$3,
          ever_paid=true,
          revoked_at=NULL,
          revoke_reason=NULL,
          updated_at=$2
      WHERE user_id=$1
      RETURNING *
    `,[userId,now,validUntil]);
    const newStatus=statusFromRow(updated.rows[0],now);
    await writeOperatorAudit(client,{
      userId,action:'pro.expiry_corrected',operatorTornId,reason:reason.trim(),previousStatus,newStatus,now
    });
    await client.query('COMMIT');
    return newStatus;
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function revoke(pool, { userId, reason, operatorTornId=null, now = new Date() }) {
  assertDate(now, 'INVALID_REVOKE_DATE');
  if (typeof reason !== 'string' || !reason.trim()) throw new Error('REVOKE_REASON_REQUIRED');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current=await ensureLockedRow(client, userId);
    const previousStatus=statusFromRow(current,now);
    const updated = await client.query(`
      UPDATE pro_entitlements
      SET revoked_at = $2,
          revoke_reason = $3,
          updated_at = $2
      WHERE user_id = $1
      RETURNING *
    `, [userId, now, reason.trim()]);
    const newStatus=statusFromRow(updated.rows[0],now);
    await writeOperatorAudit(client,{
      userId,action:'pro.revoked',operatorTornId,reason:reason.trim(),previousStatus,newStatus,now
    });
    await client.query('COMMIT');
    return newStatus;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function createProEntitlementRepository(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new Error('PostgreSQL pool is required');
  }
  return {
    getStatus(userId, now) { return getStatus(pool, userId, now); },
    startTrial(input) { return startTrial(pool, input); },
    hasEverPaid(userId) { return hasEverPaid(pool, userId); },
    activatePaid(input) { return activatePaid(pool, input); },
    grantManual(input) { return grantManual(pool, input); },
    correctExpiry(input) { return correctExpiry(pool, input); },
    revoke(input) { return revoke(pool, input); }
  };
}

module.exports = {
  TRIAL_MS,
  statusFromRow,
  getStatus,
  startTrial,
  hasEverPaid,
  activatePaidWithClient,
  activatePaid,
  grantManual,
  correctExpiry,
  revoke,
  createProEntitlementRepository
};
