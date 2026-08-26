const { encryptSecret, decryptSecret } = require('../security/crypto');
const {
  TRANSACTION_CREDENTIAL_PURPOSE,
  publicCredentialStatus
} = require('../security/verification-credential');

function createVerificationCredentialRepository(pool, { encryptionKeyHex } = {}) {
  if (!pool) throw new Error('PostgreSQL pool is required');
  if (typeof encryptionKeyHex !== 'string' || !encryptionKeyHex) {
    throw new Error('Credential encryption key is required');
  }

  async function getActiveRow(userId) {
    const result = await pool.query(`
      SELECT *
      FROM api_credentials
      WHERE user_id = $1
        AND purpose = $2
        AND revoked_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `, [userId, TRANSACTION_CREDENTIAL_PURPOSE]);
    return result.rows[0] || null;
  }

  return {
    async getStatus(userId) {
      return publicCredentialStatus(await getActiveRow(userId));
    },

    async bind({ userId, plaintextKey, capability, accessScope, validatedAt = new Date() }) {
      if (typeof plaintextKey !== 'string' || !plaintextKey) throw new Error('Plaintext transaction credential is required');
      if (!(validatedAt instanceof Date) || Number.isNaN(validatedAt.getTime())) throw new Error('validatedAt must be a valid Date');
      const encrypted = encryptSecret(plaintextKey, encryptionKeyHex);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`
          UPDATE api_credentials
          SET revoked_at = $3,
              updated_at = $3
          WHERE user_id = $1
            AND purpose = $2
            AND revoked_at IS NULL
        `, [userId, TRANSACTION_CREDENTIAL_PURPOSE, validatedAt]);

        const inserted = await client.query(`
          INSERT INTO api_credentials (
            user_id, ciphertext, iv, auth_tag, access_scope, purpose,
            capability, last_validated_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$8)
          RETURNING *
        `, [
          userId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.tag,
          JSON.stringify(accessScope || {}),
          TRANSACTION_CREDENTIAL_PURPOSE,
          JSON.stringify(capability || {}),
          validatedAt
        ]);

        await client.query(`
          INSERT INTO audit_events (actor_type, actor_id, entity_type, entity_id, action, details, created_at)
          VALUES ('user',$1,'api_credential',$2,'verification_credential.bound',$3::jsonb,$4)
        `, [
          userId,
          inserted.rows[0].id,
          JSON.stringify({ purpose: TRANSACTION_CREDENTIAL_PURPOSE, capabilities: capability || {} }),
          validatedAt
        ]);
        await client.query('COMMIT');
        return publicCredentialStatus(inserted.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async markUnusable({ userId, reason, now = new Date() }) {
      const safeReason = String(reason || 'unusable').slice(0, 200);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(`
          UPDATE api_credentials
          SET unusable_at = $3,
              unusable_reason = $4,
              updated_at = $3
          WHERE user_id = $1
            AND purpose = $2
            AND revoked_at IS NULL
          RETURNING *
        `, [userId, TRANSACTION_CREDENTIAL_PURPOSE, now, safeReason]);
        if (result.rowCount === 1) {
          await client.query(`
            INSERT INTO audit_events (actor_type, actor_id, entity_type, entity_id, action, details, created_at)
            VALUES ('system',NULL,'api_credential',$1,'verification_credential.unusable',$2::jsonb,$3)
          `, [result.rows[0].id, JSON.stringify({ userId, reason: safeReason }), now]);
        }
        await client.query('COMMIT');
        return result.rowCount === 1 ? publicCredentialStatus(result.rows[0]) : null;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async revoke({ userId, reason = 'user_revoke', now = new Date() }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(`
          UPDATE api_credentials
          SET revoked_at = $3,
              updated_at = $3
          WHERE user_id = $1
            AND purpose = $2
            AND revoked_at IS NULL
          RETURNING id
        `, [userId, TRANSACTION_CREDENTIAL_PURPOSE, now]);
        if (result.rowCount === 1) {
          await client.query(`
            INSERT INTO audit_events (actor_type, actor_id, entity_type, entity_id, action, details, created_at)
            VALUES ('user',$1,'api_credential',$2,'verification_credential.revoked',$3::jsonb,$4)
          `, [userId, result.rows[0].id, JSON.stringify({ reason: String(reason).slice(0, 200) }), now]);
        }
        await client.query('COMMIT');
        return result.rowCount === 1;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async getDecryptedActiveForUser(userId) {
      const row = await getActiveRow(userId);
      if (!row || row.unusable_at) return null;
      return {
        plaintextKey: decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, tag: row.auth_tag }, encryptionKeyHex),
        status: publicCredentialStatus(row)
      };
    }
  };
}

module.exports = {
  createVerificationCredentialRepository
};
