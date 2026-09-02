const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createProInvoiceRepository } = require('../../src/db/pro-invoices');

async function insertUser(pool, tornId, name) {
  const result=await pool.query(`INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id`,[tornId,name]);
  return result.rows[0].id;
}

test('server catalog controls invoice amount, months and exact 24-hour expiry', async () => {
  await withDisposableDatabase('pro_invoice_exact', async pool => {
    const userId=await insertUser(pool,920001,'Invoice User');
    const repo=createProInvoiceRepository(pool);
    const now=new Date('2026-08-30T12:00:00Z');
    const invoice=await repo.createInvoice({userId,tornId:920001,planId:'monthly',currency:'cash',now});
    assert.equal(invoice.planId,'monthly');
    assert.equal(invoice.currency,'cash');
    assert.equal(invoice.expectedAmount,10000000);
    assert.equal(invoice.entitlementMonths,1);
    assert.equal(invoice.state,'PENDING');
    assert.equal(invoice.createdAt.toISOString(),'2026-08-30T12:00:00.000Z');
    assert.equal(invoice.expiresAt.toISOString(),'2026-08-31T12:00:00.000Z');
  });
});

test('creating a replacement invoice cancels the previous pending invoice atomically', async () => {
  await withDisposableDatabase('pro_invoice_replace', async pool => {
    const userId=await insertUser(pool,920002,'Replacement User');
    const repo=createProInvoiceRepository(pool);
    const first=await repo.createInvoice({userId,tornId:920002,planId:'monthly',currency:'xanax',now:new Date('2026-08-30T12:00:00Z')});
    const second=await repo.createInvoice({userId,tornId:920002,planId:'yearly',currency:'cash',now:new Date('2026-08-30T12:05:00Z')});
    assert.notEqual(second.id,first.id);
    assert.equal(second.expectedAmount,100000000);
    const firstReloaded=await repo.getInvoiceForUser({invoiceId:first.id,userId});
    assert.equal(firstReloaded.state,'CANCELLED');
    const pending=await repo.listPending(new Date('2026-08-30T12:06:00Z'));
    assert.deepEqual(pending.map(row=>row.id),[second.id]);
    const count=await pool.query(`SELECT count(*)::int AS count FROM pro_invoices WHERE user_id=$1 AND state='PENDING'`,[userId]);
    assert.equal(count.rows[0].count,1);
  });
});

test('invoice ownership, expiry and cancellation are server scoped', async () => {
  await withDisposableDatabase('pro_invoice_scope', async pool => {
    const userId=await insertUser(pool,920003,'Owner');
    const otherId=await insertUser(pool,920004,'Other');
    const repo=createProInvoiceRepository(pool);
    const now=new Date('2026-08-30T12:00:00Z');
    const invoice=await repo.createInvoice({userId,tornId:920003,planId:'six_months',currency:'xanax',now});
    assert.equal(await repo.getInvoiceForUser({invoiceId:invoice.id,userId:otherId}),null);
    assert.equal((await repo.listPending(new Date('2026-08-31T11:59:59Z'))).length,1);
    assert.equal(await repo.expireDue(new Date('2026-08-31T12:00:00Z')),1);
    assert.equal((await repo.getInvoiceForUser({invoiceId:invoice.id,userId})).state,'EXPIRED');

    const replacement=await repo.createInvoice({userId,tornId:920003,planId:'monthly',currency:'cash',now:new Date('2026-09-01T12:00:00Z')});
    assert.equal(await repo.cancelOpenForUser(userId,new Date('2026-09-01T12:01:00Z')),1);
    assert.equal((await repo.getInvoiceForUser({invoiceId:replacement.id,userId})).state,'CANCELLED');
  });
});


test('matching payment evidence marks invoice paid and extends entitlement exactly once', async () => {
  await withDisposableDatabase('pro_invoice_paid', async pool => {
    const userId=await insertUser(pool,920005,'Paid Invoice User');
    const repo=createProInvoiceRepository(pool);
    const createdAt=new Date('2026-08-30T12:00:00Z');
    const invoice=await repo.createInvoice({userId,tornId:920005,planId:'monthly',currency:'cash',now:createdAt});
    const evidence={
      invoiceId:invoice.id,
      tornLogId:'money-log-920005-1',
      senderTornId:920005,
      currency:'cash',
      amount:10000000,
      evidenceAt:new Date('2026-08-30T12:01:00Z'),
      paidAt:new Date('2026-08-30T12:02:00Z')
    };

    const first=await repo.markPaidWithEvidence(evidence);
    assert.equal(first.paid,true);
    assert.equal(first.invoice.state,'PAID');
    assert.equal(first.invoice.matchedTornLogId,'money-log-920005-1');

    const entitlement=await pool.query('SELECT ever_paid,paid_until FROM pro_entitlements WHERE user_id=$1',[userId]);
    assert.equal(entitlement.rows[0].ever_paid,true);
    assert.equal(entitlement.rows[0].paid_until.toISOString(),'2026-09-30T12:02:00.000Z');
    const evidenceRows=await pool.query('SELECT count(*)::int AS count FROM pro_payment_evidence WHERE invoice_id=$1',[invoice.id]);
    assert.equal(evidenceRows.rows[0].count,1);

    const second=await repo.markPaidWithEvidence(evidence);
    assert.equal(second.paid,false);
    assert.equal(second.reason,'ALREADY_PAID');
    const entitlementAgain=await pool.query('SELECT paid_until FROM pro_entitlements WHERE user_id=$1',[userId]);
    assert.equal(entitlementAgain.rows[0].paid_until.toISOString(),'2026-09-30T12:02:00.000Z');
  });
});

test('payment evidence must exactly match invoice owner, currency, amount and 24-hour window', async () => {
  await withDisposableDatabase('pro_invoice_mismatch', async pool => {
    const userId=await insertUser(pool,920006,'Mismatch User');
    const repo=createProInvoiceRepository(pool);
    const invoice=await repo.createInvoice({userId,tornId:920006,planId:'monthly',currency:'xanax',now:new Date('2026-08-30T12:00:00Z')});
    const base={invoiceId:invoice.id,tornLogId:'bad-log',senderTornId:920006,currency:'xanax',amount:10,evidenceAt:new Date('2026-08-30T12:01:00Z'),paidAt:new Date('2026-08-30T12:02:00Z')};
    for (const patch of [
      {senderTornId:1},
      {currency:'cash'},
      {amount:9},
      {evidenceAt:new Date('2026-08-30T11:59:59Z')},
      {evidenceAt:new Date('2026-08-31T12:00:00.001Z')}
    ]) {
      const result=await repo.markPaidWithEvidence({...base,...patch,tornLogId:`bad-${JSON.stringify(patch,(_,v)=>v instanceof Date?v.toISOString():v)}`});
      assert.equal(result.paid,false);
      assert.equal(result.reason,'EVIDENCE_MISMATCH');
    }
    assert.equal((await repo.getInvoiceForUser({invoiceId:invoice.id,userId})).state,'PENDING');
  });
});
