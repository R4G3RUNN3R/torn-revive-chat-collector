const { TRANSACTION_CREDENTIAL_PURPOSE } = require('../security/verification-credential');

const ONLINE_WINDOW_SECONDS = 300;

async function countOnlineRevivers(pool, { now = new Date(), requireEntitlement = false, ownerTornId = null } = {}) {
  const result = await pool.query(`
    SELECT count(DISTINCT u.id)::int AS online
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.account_state = 'active'
    JOIN revivers r ON r.user_id = u.id AND r.standing = 'active'
    LEFT JOIN pro_entitlements pe ON pe.user_id = u.id
    WHERE s.revoked_at IS NULL
      AND (s.expires_at IS NULL OR s.expires_at > $1)
      AND s.last_seen_at >= $1::timestamptz - make_interval(secs => $2::double precision)
      AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.reviver_id = u.id AND b.active = true)
      AND EXISTS (
        SELECT 1 FROM api_credentials c
        WHERE c.user_id = u.id
          AND c.purpose = $3
          AND c.revoked_at IS NULL
          AND c.unusable_at IS NULL
          AND c.capability @> '{"reviver":true}'::jsonb
      )
      AND (
        NOT $4::boolean
        OR u.torn_id = $5::bigint
        OR (pe.revoked_at IS NULL AND (pe.paid_until > $1 OR pe.trial_ends_at > $1))
      )
  `, [now, ONLINE_WINDOW_SECONDS, TRANSACTION_CREDENTIAL_PURPOSE, Boolean(requireEntitlement), ownerTornId]);
  return result.rows[0].online;
}

async function getPlayerBadge(pool, tornId) {
  const result = await pool.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM api_credentials c
        WHERE c.user_id = u.id AND c.purpose = $2 AND c.revoked_at IS NULL AND c.unusable_at IS NULL
          AND c.capability @> '{"requester":true}'::jsonb
      ) AS requester_verified,
      COALESCE(r.standing = 'active', false)
        AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.reviver_id = u.id AND b.active = true)
        AND EXISTS (
          SELECT 1 FROM api_credentials c
          WHERE c.user_id = u.id AND c.purpose = $2 AND c.revoked_at IS NULL AND c.unusable_at IS NULL
            AND c.capability @> '{"reviver":true}'::jsonb
        ) AS reviver_verified
    FROM users u
    LEFT JOIN revivers r ON r.user_id = u.id
    WHERE u.torn_id = $1 AND u.account_state = 'active'
  `, [tornId, TRANSACTION_CREDENTIAL_PURPOSE]);
  const row = result.rows[0];
  return {
    tornId,
    requesterVerified: Boolean(row && row.requester_verified),
    reviverVerified: Boolean(row && row.reviver_verified)
  };
}

function createPresenceRepository(pool) {
  if (!pool || typeof pool.query !== 'function') throw new Error('PostgreSQL pool is required');
  return {
    countOnlineRevivers(input) {
      return countOnlineRevivers(pool, input);
    },
    getPlayerBadge(tornId) {
      return getPlayerBadge(pool, tornId);
    }
  };
}

module.exports = {
  ONLINE_WINDOW_SECONDS,
  countOnlineRevivers,
  getPlayerBadge,
  createPresenceRepository
};
