const { getProPlan, amountForCurrency } = require('../domain/pro-plans');
const { activatePaidWithClient } = require('./pro-entitlements');

const INVOICE_TTL_MS = 24 * 60 * 60 * 1000;

function assertDate(value, code) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(code);
}

function rowToInvoice(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    purchaserTornId: Number(row.purchaser_torn_id),
    planId: row.plan_id,
    currency: row.currency,
    expectedAmount: Number(row.expected_amount),
    entitlementMonths: Number(row.entitlement_months),
    state: row.state,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    paidAt: row.paid_at || null,
    matchedTornLogId: row.matched_torn_log_id || null,
    updatedAt: row.updated_at
  };
}

async function createInvoice(pool, { userId, tornId, planId, currency, now = new Date() }) {
  assertDate(now, 'INVALID_INVOICE_DATE');
  const purchaserTornId = Number(tornId);
  if (!Number.isSafeInteger(purchaserTornId) || purchaserTornId <= 0) throw new Error('INVALID_PURCHASER_TORN_ID');
  const plan = getProPlan(planId);
  const expectedAmount = amountForCurrency(plan, currency);
  const expiresAt = new Date(now.getTime() + INVOICE_TTL_MS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      UPDATE pro_invoices
      SET state = 'CANCELLED',
          updated_at = $2
      WHERE user_id = $1
        AND state = 'PENDING'
    `, [userId, now]);

    const result = await client.query(`
      INSERT INTO pro_invoices (
        user_id, purchaser_torn_id, plan_id, currency,
        expected_amount, entitlement_months, state,
        created_at, expires_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$7)
      RETURNING *
    `, [userId, purchaserTornId, plan.id, currency, expectedAmount, plan.months, now, expiresAt]);
    const invoice = rowToInvoice(result.rows[0]);

    await client.query(`
      INSERT INTO audit_events (
        actor_type, actor_id, entity_type, entity_id, action, details, created_at
      ) VALUES ('user',$1,'pro_invoice',$2,'pro.invoice_created',$3::jsonb,$4)
    `, [userId, invoice.id, JSON.stringify({
      planId: invoice.planId,
      currency: invoice.currency,
      expectedAmount: invoice.expectedAmount,
      entitlementMonths: invoice.entitlementMonths,
      expiresAt: invoice.expiresAt.toISOString()
    }), now]);

    await client.query('COMMIT');
    return invoice;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getInvoiceForUser(pool, { invoiceId, userId }) {
  const result = await pool.query(`
    SELECT *
    FROM pro_invoices
    WHERE id = $1
      AND user_id = $2
  `, [invoiceId, userId]);
  return result.rowCount === 1 ? rowToInvoice(result.rows[0]) : null;
}

async function listPending(pool, now = new Date()) {
  assertDate(now, 'INVALID_LIST_DATE');
  const result = await pool.query(`
    SELECT *
    FROM pro_invoices
    WHERE state = 'PENDING'
      AND expires_at > $1
    ORDER BY created_at ASC, id ASC
  `, [now]);
  return result.rows.map(rowToInvoice);
}

async function expireDue(pool, now = new Date()) {
  assertDate(now, 'INVALID_EXPIRY_DATE');
  const result = await pool.query(`
    UPDATE pro_invoices
    SET state = 'EXPIRED',
        updated_at = $1
    WHERE state = 'PENDING'
      AND expires_at <= $1
    RETURNING id
  `, [now]);
  return result.rowCount;
}

async function cancelOpenForUser(pool, userId, now = new Date()) {
  assertDate(now, 'INVALID_CANCEL_DATE');
  const result = await pool.query(`
    UPDATE pro_invoices
    SET state = 'CANCELLED',
        updated_at = $2
    WHERE user_id = $1
      AND state = 'PENDING'
    RETURNING id
  `, [userId, now]);
  return result.rowCount;
}

function evidenceMatchesInvoice(invoice, evidence) {
  return Number(evidence.senderTornId) === invoice.purchaserTornId
    && evidence.currency === invoice.currency
    && Number(evidence.amount) === invoice.expectedAmount
    && evidence.evidenceAt instanceof Date
    && !Number.isNaN(evidence.evidenceAt.getTime())
    && evidence.evidenceAt.getTime() >= invoice.createdAt.getTime()
    && evidence.evidenceAt.getTime() <= invoice.expiresAt.getTime();
}

async function markPaidWithEvidence(pool, input) {
  const {
    invoiceId,
    tornLogId,
    senderTornId,
    currency,
    amount,
    evidenceAt,
    paidAt = new Date()
  } = input || {};
  assertDate(paidAt, 'INVALID_PAID_DATE');
  if (typeof tornLogId !== 'string' || !tornLogId.trim()) throw new Error('INVALID_TORN_LOG_ID');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(`
      SELECT *
      FROM pro_invoices
      WHERE id = $1
      FOR UPDATE
    `, [invoiceId]);
    if (locked.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { paid:false, reason:'INVOICE_NOT_FOUND', invoice:null };
    }
    const invoice = rowToInvoice(locked.rows[0]);

    if (invoice.state === 'PAID') {
      await client.query('ROLLBACK');
      return {
        paid:false,
        reason: invoice.matchedTornLogId === tornLogId.trim() ? 'ALREADY_PAID' : 'INVOICE_NOT_PENDING',
        invoice
      };
    }
    if (invoice.state !== 'PENDING') {
      await client.query('ROLLBACK');
      return { paid:false, reason:'INVOICE_NOT_PENDING', invoice };
    }
    if (!evidenceMatchesInvoice(invoice, { senderTornId, currency, amount, evidenceAt })) {
      await client.query('ROLLBACK');
      return { paid:false, reason:'EVIDENCE_MISMATCH', invoice };
    }

    const used = await client.query(`
      SELECT invoice_id
      FROM pro_payment_evidence
      WHERE torn_log_id = $1
      LIMIT 1
    `, [tornLogId.trim()]);
    if (used.rowCount > 0) {
      await client.query('ROLLBACK');
      return { paid:false, reason:'EVIDENCE_ALREADY_USED', invoice };
    }

    await client.query(`
      INSERT INTO pro_payment_evidence (
        invoice_id, torn_log_id, sender_torn_id, currency,
        amount, evidence_timestamp, recorded_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [
      invoice.id,
      tornLogId.trim(),
      Number(senderTornId),
      currency,
      Number(amount),
      evidenceAt,
      paidAt
    ]);

    const updated = await client.query(`
      UPDATE pro_invoices
      SET state = 'PAID',
          paid_at = $2,
          matched_torn_log_id = $3,
          updated_at = $2
      WHERE id = $1
      RETURNING *
    `, [invoice.id, paidAt, tornLogId.trim()]);

    await activatePaidWithClient(client, {
      userId: invoice.userId,
      invoiceId: invoice.id,
      months: invoice.entitlementMonths,
      paidAt
    });

    await client.query(`
      INSERT INTO audit_events (
        actor_type, actor_id, entity_type, entity_id, action, details, created_at
      ) VALUES ('system',NULL,'pro_invoice',$1,'pro.invoice_paid',$2::jsonb,$3)
    `, [invoice.id, JSON.stringify({
      tornLogId: tornLogId.trim(),
      senderTornId: Number(senderTornId),
      currency,
      amount: Number(amount),
      evidenceAt: evidenceAt.toISOString()
    }), paidAt]);

    await client.query('COMMIT');
    return { paid:true, invoice:rowToInvoice(updated.rows[0]) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function createProInvoiceRepository(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new Error('PostgreSQL pool is required');
  }
  return {
    createInvoice(input) { return createInvoice(pool, input); },
    getInvoiceForUser(input) { return getInvoiceForUser(pool, input); },
    listPending(now) { return listPending(pool, now); },
    markPaidWithEvidence(input) { return markPaidWithEvidence(pool, input); },
    expireDue(now) { return expireDue(pool, now); },
    cancelOpenForUser(userId, now) { return cancelOpenForUser(pool, userId, now); }
  };
}

module.exports = {
  INVOICE_TTL_MS,
  rowToInvoice,
  evidenceMatchesInvoice,
  createInvoice,
  getInvoiceForUser,
  listPending,
  markPaidWithEvidence,
  expireDue,
  cancelOpenForUser,
  createProInvoiceRepository
};
