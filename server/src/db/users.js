function createUserRepository(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('PostgreSQL pool is required');
  }

  async function bindIdentity({
    tornId,
    name,
    encryptedCredential,
    keyAccess,
    tokenHash,
    clientVersion
  }) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const userResult = await client.query(`
        INSERT INTO users (torn_id, display_name)
        VALUES ($1, $2)
        ON CONFLICT (torn_id)
        DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
        RETURNING id
      `, [tornId, name]);
      const userId = userResult.rows[0].id;

      await client.query(`
        UPDATE api_credentials
        SET revoked_at = now(), updated_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL
      `, [userId]);

      await client.query(`
        INSERT INTO api_credentials (
          user_id, ciphertext, iv, auth_tag, key_access
        ) VALUES ($1, $2, $3, $4, $5::jsonb)
      `, [
        userId,
        encryptedCredential.ciphertext,
        encryptedCredential.iv,
        encryptedCredential.tag,
        JSON.stringify(keyAccess)
      ]);

      const sessionResult = await client.query(`
        INSERT INTO sessions (user_id, token_hash, client_version)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [userId, tokenHash, clientVersion || null]);
      const sessionId = sessionResult.rows[0].id;

      await client.query(`
        INSERT INTO audit_events (
          actor_type, actor_id, entity_type, entity_id, action, details
        ) VALUES ('user', $1, 'user', $2, 'identity.bound', $3::jsonb)
      `, [
        String(tornId),
        userId,
        JSON.stringify({ clientVersion: clientVersion || null })
      ]);

      await client.query('COMMIT');
      return { userId, sessionId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    bindIdentity
  };
}

module.exports = {
  createUserRepository
};
