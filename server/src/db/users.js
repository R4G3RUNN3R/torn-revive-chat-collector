function createIdentityRepository(pool) {
  if (!pool) throw new Error('PostgreSQL pool is required');

  return {
    async bindIdentity({
      tornId,
      name,
      access,
      tokenHash,
      clientVersion
    }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const userResult = await client.query(`
          INSERT INTO users (torn_id, current_name)
          VALUES ($1, $2)
          ON CONFLICT (torn_id)
          DO UPDATE SET current_name = EXCLUDED.current_name, updated_at = now()
          RETURNING id
        `, [tornId, name]);
        const userId = userResult.rows[0].id;

        await client.query(`
          INSERT INTO sessions (user_id, token_hash, client_version)
          VALUES ($1, $2, $3)
        `, [userId, tokenHash, clientVersion || null]);

        await client.query(`
          INSERT INTO audit_events
            (actor_type, actor_id, entity_type, entity_id, action, details)
          VALUES ('user', $1, 'user', $1, 'identity.bound', $2::jsonb)
        `, [userId, JSON.stringify({
          clientVersion: clientVersion || null,
          keyAccess: access || null,
          identityKeyPersisted: false
        })]);

        await client.query('COMMIT');
        return { userId };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

module.exports = {
  createIdentityRepository
};
