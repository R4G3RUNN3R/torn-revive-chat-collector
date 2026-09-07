const RATE_LIMITS = Object.freeze({
  AUTH_BIND: Object.freeze({ max: 10, timeWindow: '1 minute' }),
  CANDIDATE_INGEST: Object.freeze({ max: 120, timeWindow: '1 minute' }),
  REQUEST_WRITE: Object.freeze({ max: 20, timeWindow: '1 minute' }),
  REVIVER_QUEUE: Object.freeze({ max: 120, timeWindow: '1 minute' }),
  ACCEPT: Object.freeze({ max: 60, timeWindow: '1 minute' }),
  PRO_INVOICE_WRITE: Object.freeze({ max: 10, timeWindow: '10 minutes' }),
  PRO_INVOICE_READ: Object.freeze({ max: 60, timeWindow: '1 minute' }),
  ACCOUNT_DELETE: Object.freeze({ max: 3, timeWindow: '1 hour' })
});

module.exports = {
  RATE_LIMITS
};
