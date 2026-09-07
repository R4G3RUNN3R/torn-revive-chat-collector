const test=require('node:test');
const assert=require('node:assert/strict');
const {withDisposableDatabase}=require('../../test-support/database');
const {createProEntitlementRepository}=require('../../src/db/pro-entitlements');
const {createProBillingAdjustmentRepository}=require('../../src/db/pro-billing-adjustments');

async function insertUser(pool,tornId,name) {
  const result=await pool.query('INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id',[tornId,name]);
  return result.rows[0].id;
}

test('complimentary grant and entitlement correction create immutable audited billing adjustments',async()=>{
  await withDisposableDatabase('pro_billing_adjustments',async pool=>{
    const userId=await insertUser(pool,930001,'Adjustment User');
    const entitlements=createProEntitlementRepository(pool);
    const adjustments=createProBillingAdjustmentRepository(pool);
    const grantAt=new Date('2026-09-07T10:00:00Z');

    const granted=await entitlements.grantManual({
      userId,
      months:2,
      reason:'approved complimentary access',
      operatorTornId:3877028,
      now:grantAt
    });
    assert.equal(granted.state,'ACTIVE');

    const correctedUntil=new Date('2026-12-15T10:00:00Z');
    const corrected=await entitlements.correctExpiry({
      userId,
      validUntil:correctedUntil,
      reason:'approved entitlement correction',
      operatorTornId:3877028,
      now:new Date('2026-09-07T10:05:00Z')
    });
    assert.equal(corrected.state,'ACTIVE');

    const rows=await adjustments.listForUser(userId);
    assert.equal(rows.length,2);
    assert.equal(rows[0].adjustmentType,'COMPLIMENTARY_GRANT');
    assert.equal(rows[0].invoiceId,null);
    assert.equal(rows[0].currency,null);
    assert.equal(rows[0].amount,null);
    assert.equal(rows[0].reason,'approved complimentary access');
    assert.equal(rows[0].actorType,'operator');
    assert.equal(rows[0].actorTornId,3877028);
    assert.equal(rows[0].previousState,'NONE');
    assert.equal(rows[0].newState,'ACTIVE');
    assert.equal(rows[0].previousValidUntil,null);
    assert.ok(rows[0].newValidUntil instanceof Date);

    assert.equal(rows[1].adjustmentType,'ENTITLEMENT_CORRECTION');
    assert.equal(rows[1].invoiceId,null);
    assert.equal(rows[1].currency,null);
    assert.equal(rows[1].amount,null);
    assert.equal(rows[1].reason,'approved entitlement correction');
    assert.equal(rows[1].actorTornId,3877028);
    assert.equal(rows[1].previousState,'ACTIVE');
    assert.equal(rows[1].newState,'ACTIVE');
    assert.equal(rows[1].newValidUntil.toISOString(),correctedUntil.toISOString());

    await assert.rejects(
      ()=>pool.query('UPDATE pro_billing_adjustments SET reason=$2 WHERE id=$1',[rows[0].id,'tampered']),
      /immutable|cannot update|billing adjustment/i
    );
    await assert.rejects(
      ()=>pool.query('DELETE FROM pro_billing_adjustments WHERE id=$1',[rows[0].id]),
      /immutable|cannot delete|billing adjustment/i
    );
  });
});
