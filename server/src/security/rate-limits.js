const RATE_LIMITS = Object.freeze({
  AUTH_BIND: Object.freeze({ max: 10, timeWindow: '1 minute' }),
  CANDIDATE_INGEST: Object.freeze({ max: 120, timeWindow: '1 minute' }),
  REQUEST_WRITE: Object.freeze({ max: 20, timeWindow: '1 minute' }),
  REVIVER_QUEUE: Object.freeze({ max: 120, timeWindow: '1 minute' }),
  ACCEPT: Object.freeze({ max: 60, timeWindow: '1 minute' }),
  PRO_INVOICE_WRITE: Object.freeze({ max: 10, timeWindow: '10 minutes' }),
  PRO_INVOICE_READ: Object.freeze({ max: 60, timeWindow: '1 minute' }),
  // Per verified session (checked after authentication).
  STATE: Object.freeze({ max: 30, timeWindow: '1 minute' }),
  PLAYER_BADGE: Object.freeze({ max: 60, timeWindow: '1 minute' }),
  // Per client IP ceiling (checked before authentication; stops fake-token floods).
  STATE_IP: Object.freeze({ max: 120, timeWindow: '1 minute' }),
  PLAYER_BADGE_IP: Object.freeze({ max: 120, timeWindow: '1 minute' }),
  ACCOUNT_DELETE: Object.freeze({ max: 3, timeWindow: '1 hour' })
});

// Per-session limiter for use as a preHandler AFTER app.authenticate.
// Uses createRateLimit (not app.rateLimit) because the plugin's per-request
// "already ran" flag would make a second route limiter a silent no-op.
function createSessionRateLimitHook(app, { max, timeWindow }) {
  const check = app.createRateLimit({
    max,
    timeWindow,
    keyGenerator: request => request.reviveRelayUser.sessionId
  });
  return async function sessionRateLimit(request, reply) {
    const limit = await check(request);
    if (limit.isAllowed || !limit.isExceeded) return;
    reply.header('retry-after', limit.ttlInSeconds);
    // Same error the plugin's default response builder throws.
    const error = new Error(`Rate limit exceeded, retry in ${Math.ceil(limit.ttl / 1000)} seconds`);
    error.statusCode = 429;
    throw error;
  };
}

module.exports = {
  RATE_LIMITS,
  createSessionRateLimitHook
};
