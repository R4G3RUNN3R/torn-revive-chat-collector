const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createVerificationCredentialRepository } = require('../../src/db/verification-credentials');

const encryptionKeyHex = '11'.repeat(32);

async function createUser(pool) {
  const result = await pool.query(`
    INSERT INTO users (torn_id, current_name)
    VALUES (123456, 'Credential Tester')
    RETURNING id
  `);
  return result.rows[0].id;
}

test('bind encrypts plaintext and atomically replaces prior active transaction credential', async () => {
  await withDisposableDatabase('reviverelay_verification_credentials', async pool => {
    const userId = await createUser(pool);
    const repo = createVerificationCredentialRepository(pool, { encryptionKeyHex });

    const first = await repo.bind({
      userId, plaintextKey: 'first-secret-key',
      capability: { requester: true, reviver: false },
      accessScope: { user: ['profile', 'revives'] },
      validatedAt: new Date('2026-08-26T10:00:00Z')
    });
    assert.equal(first.capabilities.requester, true);
    assert.equal(Object.hasOwn(first, 'ciphertext'), false);

    const rawFirst = await pool.query('SELECT * FROM api_credentials WHERE id = $1', [first.id]);
    assert.equal(rawFirst.rows[0].purpose, 'transaction_verification');
    assert.notEqual(rawFirst.rows[0].ciphertext, 'first-secret-key');
    assert.doesNotMatch(JSON.stringify(rawFirst.rows[0]), /first-secret-key/);

    const second = await repo.bind({
      userId, plaintextKey: 'second-secret-key',
      capability: { requester: true, reviver: true },
      accessScope: { user: ['profile', 'revives', 'log'] },
      validatedAt: new Date('2026-08-26T10:01:00Z')
    });
    assert.notEqual(second.id, first.id);

    const rows = await pool.query('SELECT id, revoked_at FROM api_credentials WHERE user_id = $1 ORDER BY created_at, id', [userId]);
    assert.equal(rows.rowCount, 2);
    assert.equal(rows.rows.filter(row => row.revoked_at === null).length, 1);
    assert.equal(rows.rows.find(row => row.id === first.id).revoked_at instanceof Date, true);

    const decrypted = await repo.getDecryptedActiveForUser(userId);
    assert.equal(decrypted.plaintextKey, 'second-secret-key');
    assert.equal(decrypted.status.capabilities.reviver, true);
  });
});

test('markUnusable and revoke change only status, never return plaintext', async () => {
  await withDisposableDatabase('reviverelay_verification_status', async pool => {
    const userId = await createUser(pool);
    const repo = createVerificationCredentialRepository(pool, { encryptionKeyHex });
    await repo.bind({
      userId, plaintextKey: 'secret-key', capability: { requester: true, reviver: false },
      accessScope: { user: ['profile', 'revives'] }, validatedAt: new Date('2026-08-26T10:00:00Z')
    });

    const unusable = await repo.markUnusable({ userId, reason: 'TORN_INVALID_KEY', now: new Date('2026-08-26T10:02:00Z') });
    assert.equal(unusable.usable, false);
    assert.equal(unusable.unusableReason, 'TORN_INVALID_KEY');
    assert.doesNotMatch(JSON.stringify(unusable), /secret-key/);
    const unusableAudit = await pool.query(`
      SELECT action, details FROM audit_events
      WHERE action = 'verification_credential.unusable'
    `);
    assert.equal(unusableAudit.rowCount, 1);
    assert.equal(unusableAudit.rows[0].details.reason, 'TORN_INVALID_KEY');
    assert.doesNotMatch(JSON.stringify(unusableAudit.rows[0]), /secret-key/);

    const revoked = await repo.revoke({ userId, reason: 'user_revoke', now: new Date('2026-08-26T10:03:00Z') });
    assert.equal(revoked, true);
    assert.equal(await repo.getStatus(userId), null);
    assert.equal(await repo.getDecryptedActiveForUser(userId), null);
  });
});
