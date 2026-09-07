function createIdentityRepository(pool) {
  if (!pool) throw new Error('PostgreSQL pool is required');

  return {
    async findByTornId(tornId) {
      const normalized=Number(tornId);
      if (!Number.isSafeInteger(normalized) || normalized<=0) return null;
      const result=await pool.query(`
        SELECT id AS user_id, torn_id, current_name
        FROM users
        WHERE torn_id=$1
        LIMIT 1
      `,[normalized]);
      if (result.rowCount!==1) return null;
      return {
        userId:result.rows[0].user_id,
        tornId:Number(result.rows[0].torn_id),
        name:result.rows[0].current_name
      };
    },
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
          DO UPDATE SET current_name = EXCLUDED.current_name,
                        account_state = 'active',
                        updated_at = now()
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
