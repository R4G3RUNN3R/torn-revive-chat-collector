function createSessionRepository(pool) {
  if (!pool) throw new Error('PostgreSQL pool is required');

  return {
    async findByTokenHash(tokenHash) {
      const result = await pool.query(`
        SELECT
          s.id AS session_id,
          s.user_id,
          u.torn_id,
          s.expires_at,
          s.revoked_at,
          r.standing AS reviver_standing,
          EXISTS (
            SELECT 1
            FROM bans b
            WHERE b.reviver_id = s.user_id
              AND b.active = true
          ) AS active_ban
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN revivers r ON r.user_id = s.user_id
        WHERE s.token_hash = $1
        LIMIT 1
      `, [tokenHash]);

      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      return {
        sessionId: row.session_id,
        userId: row.user_id,
        tornId: Number(row.torn_id),
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        reviverStanding: row.reviver_standing,
        activeBan: row.active_ban
      };
    }
  };
}

module.exports = {
  createSessionRepository
};
