const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createProEntitlementRepository } = require('../../src/db/pro-entitlements');

async function insertUser(pool, tornId, name) {
  const result = await pool.query(`
    INSERT INTO users (torn_id, current_name)
    VALUES ($1, $2)
    RETURNING id
  `, [tornId, name]);
  return result.rows[0].id;
}

test('new verified identity is trial eligible and trial can be used exactly once', async () => {
  await withDisposableDatabase('pro_trial', async pool => {
    const userId = await insertUser(pool, 910001, 'Trial User');
    const repo = createProEntitlementRepository(pool);
    const now = new Date('2026-08-30T12:00:00Z');

    assert.deepEqual(await repo.getStatus(userId, now), {
      state: 'NONE',
      trialEligible: true,
      trialStartedAt: null,
      validUntil: null
    });

    const trial = await repo.startTrial({ userId, now });
    assert.equal(trial.state, 'TRIAL');
    assert.equal(trial.trialEligible, false);
    assert.equal(trial.trialStartedAt.toISOString(), '2026-08-30T12:00:00.000Z');
    assert.equal(trial.validUntil.toISOString(), '2026-09-06T12:00:00.000Z');

    await assert.rejects(
      () => repo.startTrial({ userId, now: new Date('2026-08-31T12:00:00Z') }),
      /TRIAL_ALREADY_USED/
    );
  });
});

test('paid activation makes trial permanently ineligible and uses UTC calendar months', async () => {
  await withDisposableDatabase('pro_paid', async pool => {
    const userId = await insertUser(pool, 910002, 'Paid User');
    const repo = createProEntitlementRepository(pool);
    const paidAt = new Date('2026-08-30T12:00:00Z');

    const paid = await repo.activatePaid({
      userId,
      invoiceId: '11111111-1111-4111-8111-111111111111',
      months: 1,
      paidAt
    });

    assert.equal(paid.state, 'ACTIVE');
    assert.equal(paid.trialEligible, false);
    assert.equal(paid.validUntil.toISOString(), '2026-09-30T12:00:00.000Z');
    assert.equal(await repo.hasEverPaid(userId), true);
    await assert.rejects(() => repo.startTrial({ userId, now: paidAt }), /TRIAL_NOT_ELIGIBLE/);
  });
});

test('paid time stacks after remaining trial and then after remaining paid time', async () => {
  await withDisposableDatabase('pro_stack', async pool => {
    const userId = await insertUser(pool, 910003, 'Stack User');
    const repo = createProEntitlementRepository(pool);

    await repo.startTrial({ userId, now: new Date('2026-08-30T12:00:00Z') });
    const first = await repo.activatePaid({
      userId,
      invoiceId: '22222222-2222-4222-8222-222222222222',
      months: 1,
      paidAt: new Date('2026-09-01T12:00:00Z')
    });
    assert.equal(first.validUntil.toISOString(), '2026-10-06T12:00:00.000Z');

    const second = await repo.activatePaid({
      userId,
      invoiceId: '33333333-3333-4333-8333-333333333333',
      months: 1,
      paidAt: new Date('2026-09-10T12:00:00Z')
    });
    assert.equal(second.validUntil.toISOString(), '2026-11-06T12:00:00.000Z');
  });
});

test('revocation takes precedence over future paid validity', async () => {
  await withDisposableDatabase('pro_revoke', async pool => {
    const userId = await insertUser(pool, 910004, 'Revoked User');
    const repo = createProEntitlementRepository(pool);
    const now = new Date('2026-08-30T12:00:00Z');

    await repo.activatePaid({
      userId,
      invoiceId: '44444444-4444-4444-8444-444444444444',
      months: 12,
      paidAt: now
    });
    const revoked = await repo.revoke({ userId, reason: 'operator action', now: new Date('2026-09-01T12:00:00Z') });
    assert.equal(revoked.state, 'REVOKED');
    assert.equal(revoked.trialEligible, false);
    assert.equal(revoked.validUntil.toISOString(), '2027-08-30T12:00:00.000Z');
  });
});
