function rowToReviver(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    standing: row.standing,
    memberSince: row.member_since,
    trialStartedAt: row.trial_started_at,
    proUntil: row.pro_until,
    updatedAt: row.updated_at
  };
}

function createReviverRepository(pool) {
  if (!pool) throw new Error('PostgreSQL pool is required');

  return {
    async register({ userId, now = new Date() }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(`
          INSERT INTO revivers (user_id, standing, member_since, updated_at)
          VALUES ($1, 'active', $2, $2)
          ON CONFLICT (user_id) DO UPDATE
          SET updated_at = EXCLUDED.updated_at
          RETURNING *
        `, [userId, now]);
        const row = result.rows[0];
        const ban = await client.query(`
          SELECT 1 FROM bans
          WHERE reviver_id = $1 AND active = true
          LIMIT 1
        `, [userId]);
        const eligible = row.standing === 'active' && ban.rowCount === 0;
        if (eligible) {
          await client.query(`
            INSERT INTO audit_events (actor_type, actor_id, entity_type, entity_id, action, details, created_at)
            VALUES ('user',$1,'reviver',$1,'reviver.registered','{}'::jsonb,$2)
          `, [userId, now]);
        }
        await client.query('COMMIT');
        return {
          registered: eligible,
          ...(eligible ? {} : { reason: 'REVIVER_NOT_ELIGIBLE' }),
          reviver: rowToReviver(row)
        };
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
  createReviverRepository
};
