const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createIdentityRepository } = require('../../src/db/users');
const { createProEntitlementRepository } = require('../../src/db/pro-entitlements');
const { createVerificationCredentialRepository } = require('../../src/db/verification-credentials');
const { createAccountDeletionService } = require('../../src/db/account-deletion');

const TORN_ID = 910061;
const ENCRYPTION_KEY = '61'.repeat(32);

function bindInput(tokenHash) {
  return {
    tornId:TORN_ID,
    name:'Same Torn User',
    access:{type:'Custom'},
    tokenHash,
    clientVersion:'0.6.1'
  };
}

async function entitlementRow(pool, userId) {
  const result=await pool.query(`
    SELECT trial_started_at, trial_ends_at
    FROM pro_entitlements
    WHERE user_id=$1
  `,[userId]);
  assert.equal(result.rowCount,1);
  return result.rows[0];
}

test('one-time Pro trial survives reinstall, new session, credential replacement, account delete/reactivate, and repository restart', async () => {
  await withDisposableDatabase('pro_trial_persistence', async pool => {
    const identities=createIdentityRepository(pool);
    const entitlements=createProEntitlementRepository(pool);
    const credentials=createVerificationCredentialRepository(pool,{encryptionKeyHex:ENCRYPTION_KEY});
    const deletion=createAccountDeletionService(pool);

    const firstIdentity=await identities.bindIdentity(bindInput('session-hash-first'));
    const userId=firstIdentity.userId;
    await credentials.bind({
      userId,
      plaintextKey:'first-verification-key',
      capability:{requester:true,reviver:true},
      accessScope:{user:['basic','profile','revives','perks','log']},
      validatedAt:new Date('2026-09-07T11:55:00Z')
    });

    const t0=new Date('2026-09-07T12:00:00Z');
    const first=await entitlements.startTrial({userId,now:t0});
    assert.equal(first.state,'TRIAL');
    assert.equal(first.validUntil.toISOString(),'2026-09-14T12:00:00.000Z');
    const before=await entitlementRow(pool,userId);

    // New userscript/session state cannot affect the entitlement row.
    await pool.query('DELETE FROM sessions WHERE user_id=$1',[userId]);
    await credentials.bind({
      userId,
      plaintextKey:'replacement-verification-key',
      capability:{requester:true,reviver:true},
      accessScope:{user:['basic','profile','revives','perks','log']},
      validatedAt:new Date('2026-09-08T09:00:00Z')
    });

    // Supported account deletion removes operational data but retains canonical identity/billing history.
    await deletion.deleteAccount({userId,now:new Date('2026-09-08T12:00:00Z')});
    const rebound=await identities.bindIdentity(bindInput('session-hash-reinstalled'));
    assert.equal(rebound.userId,userId);

    await assert.rejects(
      () => entitlements.startTrial({userId:rebound.userId,now:new Date('2026-09-09T12:00:00Z')}),
      /TRIAL_ALREADY_USED/
    );

    const after=await entitlementRow(pool,userId);
    assert.equal(after.trial_started_at.toISOString(),before.trial_started_at.toISOString());
    assert.equal(after.trial_ends_at.toISOString(),before.trial_ends_at.toISOString());
    assert.equal(after.trial_started_at.toISOString(),'2026-09-07T12:00:00.000Z');
    assert.equal(after.trial_ends_at.toISOString(),'2026-09-14T12:00:00.000Z');

    const expired=await entitlements.getStatus(userId,new Date('2026-09-15T12:00:00Z'));
    assert.equal(expired.state,'EXPIRED');
    assert.equal(expired.trialStartedAt.toISOString(),'2026-09-07T12:00:00.000Z');
    assert.equal(expired.validUntil.toISOString(),'2026-09-14T12:00:00.000Z');

    // Recreating repository objects simulates an application-process restart against persisted DB state.
    const restartedEntitlements=createProEntitlementRepository(pool);
    const restarted=await restartedEntitlements.getStatus(userId,new Date('2026-09-15T12:00:01Z'));
    assert.equal(restarted.state,'EXPIRED');
    assert.equal(restarted.trialStartedAt.toISOString(),'2026-09-07T12:00:00.000Z');
    assert.equal(restarted.validUntil.toISOString(),'2026-09-14T12:00:00.000Z');
  });
});
