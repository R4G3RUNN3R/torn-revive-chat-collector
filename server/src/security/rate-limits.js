const crypto = require('node:crypto');

// Keys authenticated polling routes by session token so users behind one IP
// do not share a bucket. Only a SHA-256 digest of the token is ever used.
function bearerTokenRateLimitKey(request) {
  const header = request && request.headers && request.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match && match[1]) {
      return crypto.createHash('sha256').update(match[1], 'utf8').digest('hex');
    }
  }
  return request.ip;
}

const RATE_LIMITS = Object.freeze({
  AUTH_BIND: Object.freeze({ max: 10, timeWindow: '1 minute' }),
  CANDIDATE_INGEST: Object.freeze({ max: 120, timeWindow: '1 minute' }),
  REQUEST_WRITE: Object.freeze({ max: 20, timeWindow: '1 minute' }),
  REVIVER_QUEUE: Object.freeze({ max: 120, timeWindow: '1 minute' }),
  ACCEPT: Object.freeze({ max: 60, timeWindow: '1 minute' }),
  PRO_INVOICE_WRITE: Object.freeze({ max: 10, timeWindow: '10 minutes' }),
  PRO_INVOICE_READ: Object.freeze({ max: 60, timeWindow: '1 minute' }),
  STATE: Object.freeze({ max: 30, timeWindow: '1 minute', keyGenerator: bearerTokenRateLimitKey }),
  PLAYER_BADGE: Object.freeze({ max: 60, timeWindow: '1 minute', keyGenerator: bearerTokenRateLimitKey }),
  ACCOUNT_DELETE: Object.freeze({ max: 3, timeWindow: '1 hour' })
});

module.exports = {
  RATE_LIMITS,
  bearerTokenRateLimitKey
};
