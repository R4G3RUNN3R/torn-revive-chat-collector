const test=require('node:test');
const assert=require('node:assert/strict');
const {withDisposableDatabase}=require('../../test-support/database');
const {createIdentityRepository}=require('../../src/db/users');
const {createSessionRepository}=require('../../src/db/sessions');
const {createVerificationCredentialRepository}=require('../../src/db/verification-credentials');
const {createReviverRepository}=require('../../src/db/revivers');
const {createRequestRepository}=require('../../src/db/requests');
const {createProEntitlementRepository}=require('../../src/db/pro-entitlements');
const {createProInvoiceRepository}=require('../../src/db/pro-invoices');
const {createErrorTelemetryRepository}=require('../../src/db/error-telemetry');
const {createAccountDeletionService}=require('../../src/db/account-deletion');

const ENCRYPTION_KEY='ab'.repeat(32);
const USER_TORN_ID=940001;

async function count(pool,table,where='TRUE',params=[]) {
  const result=await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${where}`,params);
  return result.rows[0].count;
}

test('account deletion removes operational identity data while retaining minimal billing/security history',async()=>{
  await withDisposableDatabase('account_deletion',async pool=>{
    const identities=createIdentityRepository(pool);
    const first=await identities.bindIdentity({
      tornId:USER_TORN_ID,
      name:'Delete Me',
      access:{type:'Public Only'},
      tokenHash:'1'.repeat(64),
      clientVersion:'0.6.0'
    });
    await identities.bindIdentity({
      tornId:USER_TORN_ID,
      name:'Delete Me',
      access:{type:'Public Only'},
      tokenHash:'2'.repeat(64),
      clientVersion:'0.6.0'
    });
    const userId=first.userId;

    const credentials=createVerificationCredentialRepository(pool,{encryptionKeyHex:ENCRYPTION_KEY});
    await credentials.bind({
      userId,
      plaintextKey:'secret-reviver-verification-key',
      capability:{requester:true,reviver:true,broadAccess:false,accessLabel:'Limited Access'},
      accessScope:{broadAccess:false,accessType:'Limited Access',selections:{user:['basic','perks']},log:null},
      validatedAt:new Date('2026-09-07T09:00:00Z')
    });
    await createReviverRepository(pool).register({userId,now:new Date('2026-09-07T09:01:00Z')});

    const requests=createRequestRepository(pool);
    const request=await requests.createRequest({
      requesterId:userId,
      paymentMethod:'cash',
      offerAmount:500000,
      comment:'delete this open request'
    });
    assert.equal(request.created,true);

    const invoices=createProInvoiceRepository(pool);
    const paidInvoice=await invoices.createInvoice({
      userId,tornId:USER_TORN_ID,planId:'monthly',currency:'cash',now:new Date('2026-09-07T09:02:00Z')
    });
    const paid=await invoices.markPaidWithEvidence({
      invoiceId:paidInvoice.id,
      tornLogId:'account-delete-paid-evidence',
      senderTornId:USER_TORN_ID,
      currency:'cash',
      amount:10000000,
      evidenceAt:new Date('2026-09-07T09:03:00Z'),
      paidAt:new Date('2026-09-07T09:04:00Z')
    });
    assert.equal(paid.paid,true);

    const entitlements=createProEntitlementRepository(pool);
    await entitlements.correctExpiry({
      userId,
      validUntil:new Date('2026-11-07T09:04:00Z'),
      reason:'retain anti-reuse entitlement history',
      operatorTornId:3877028,
      now:new Date('2026-09-07T09:05:00Z')
    });
    const pendingInvoice=await invoices.createInvoice({
      userId,tornId:USER_TORN_ID,planId:'yearly',currency:'xanax',now:new Date('2026-09-07T09:06:00Z')
    });
    assert.equal(pendingInvoice.state,'PENDING');

    const telemetry=createErrorTelemetryRepository(pool);
    await telemetry.recordOccurrence({
      fingerprint:'account-delete-fixture',
      product:'reviverelay',component:'client',severity:'error',summary:'fixture',
      representativeStack:null,version:'0.6.0',buildCommit:null,userId,
      source:'client',context:{safe:'fixture'},occurredAt:new Date('2026-09-07T09:07:00Z')
    });

    const service=createAccountDeletionService(pool);
    const result=await service.deleteAccount({userId,now:new Date('2026-09-07T10:00:00Z')});
    assert.deepEqual(result,{
      deleted:true,
      retained:['billing_history','payment_reuse_protection','security_audit_history']
    });

    assert.equal(await count(pool,'sessions','user_id=$1',[userId]),0);
    assert.equal(await count(pool,'api_credentials','user_id=$1',[userId]),0);
    assert.equal(await count(pool,'revivers','user_id=$1',[userId]),0);
    assert.equal(await count(pool,'error_occurrences','user_id=$1',[userId]),0);

    const user=(await pool.query('SELECT torn_id,current_name,account_state FROM users WHERE id=$1',[userId])).rows[0];
    assert.deepEqual(user,{torn_id:String(USER_TORN_ID),current_name:'Deleted ReviveRelay account',account_state:'deleted'});

    const staleHash='4'.repeat(64);
    await pool.query('INSERT INTO sessions (user_id,token_hash,client_version) VALUES ($1,$2,$3)',[userId,staleHash,'0.6.0']);
    assert.equal(await createSessionRepository(pool).findByTokenHash(staleHash),null);
    await pool.query('DELETE FROM sessions WHERE token_hash=$1',[staleHash]);

    const closedRequest=(await pool.query('SELECT state,closed_at,cancelled_at FROM revive_requests WHERE id=$1',[request.request.id])).rows[0];
    assert.equal(closedRequest.state,'CANCELLED');
    assert.ok(closedRequest.closed_at instanceof Date);
    assert.ok(closedRequest.cancelled_at instanceof Date);

    const invoiceRows=await pool.query('SELECT id,state,matched_torn_log_id FROM pro_invoices WHERE user_id=$1 ORDER BY created_at',[userId]);
    assert.equal(invoiceRows.rows[0].id,paidInvoice.id);
    assert.equal(invoiceRows.rows[0].state,'PAID');
    assert.equal(invoiceRows.rows[0].matched_torn_log_id,'account-delete-paid-evidence');
    assert.equal(invoiceRows.rows[1].id,pendingInvoice.id);
    assert.equal(invoiceRows.rows[1].state,'CANCELLED');
    assert.equal(await count(pool,'pro_payment_evidence','invoice_id=$1',[paidInvoice.id]),1);
    assert.equal(await count(pool,'pro_billing_adjustments','user_id=$1',[userId]),1);

    const entitlementRow=(await pool.query('SELECT ever_paid,trial_started_at,paid_until,revoked_at FROM pro_entitlements WHERE user_id=$1',[userId])).rows[0];
    assert.equal(entitlementRow.ever_paid,true);
    assert.ok(entitlementRow.paid_until instanceof Date);
    assert.equal(entitlementRow.revoked_at,null);

    const audit=await pool.query(`SELECT actor_id,details FROM audit_events WHERE entity_id=$1 AND action='account.deleted' ORDER BY created_at DESC LIMIT 1`,[userId]);
    assert.equal(audit.rowCount,1);
    assert.equal(audit.rows[0].actor_id,null);
    assert.deepEqual(audit.rows[0].details.retained,['billing_history','payment_reuse_protection','security_audit_history']);
    assert.doesNotMatch(JSON.stringify(audit.rows[0].details),/Delete Me|secret-reviver-verification-key/);

    const reactivated=await identities.bindIdentity({
      tornId:USER_TORN_ID,
      name:'Returned User',
      access:{type:'Public Only'},
      tokenHash:'3'.repeat(64),
      clientVersion:'0.6.0'
    });
    assert.equal(reactivated.userId,userId);
    const activeUser=(await pool.query('SELECT current_name,account_state FROM users WHERE id=$1',[userId])).rows[0];
    assert.deepEqual(activeUser,{current_name:'Returned User',account_state:'active'});
    assert.equal(await count(pool,'sessions','user_id=$1',[userId]),1);
    assert.equal(await count(pool,'api_credentials','user_id=$1',[userId]),0);
    assert.equal((await entitlements.getStatus(userId,new Date('2026-09-07T10:01:00Z'))).trialEligible,false);
  });
});
