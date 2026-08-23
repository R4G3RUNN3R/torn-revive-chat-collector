function createSessionRepository(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('PostgreSQL pool is required');
  }

  async function findByTokenHash(tokenHash) {
    const result = await pool.query(`
      SELECT
        s.id AS session_id,
        s.user_id,
        u.torn_id,
        s.revoked_at AS session_revoked_at,
        s.expires_at,
        u.account_state,
        (r.user_id IS NOT NULL) AS is_reviver,
        r.standing AS reviver_standing,
        EXISTS (
          SELECT 1
          FROM bans b
          WHERE b.reviver_id = u.id
            AND b.revoked_at IS NULL
        ) AS active_ban
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN revivers r ON r.user_id = u.id
      WHERE s.token_hash = $1
      LIMIT 1
    `, [tokenHash]);

    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      tornId: Number(row.torn_id),
      sessionRevokedAt: row.session_revoked_at,
      expiresAt: row.expires_at,
      accountState: row.account_state,
      isReviver: Boolean(row.is_reviver),
      reviverStanding: row.reviver_standing,
      activeBan: Boolean(row.active_ban)
    };
  }

  return {
    findByTokenHash
  };
}

module.exports = {
  createSessionRepository
};
