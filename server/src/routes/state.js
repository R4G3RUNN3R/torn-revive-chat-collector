const crypto = require('node:crypto');
const { RATE_LIMITS, createSessionRateLimitHook } = require('../security/rate-limits');
const { publicProPlans } = require('../domain/pro-plans');
const { publicSubscriptionState, subscriptionRequiresEntitlement } = require('../domain/subscription-mode');
const { resolvePublicProStatus, hasActivePro } = require('../security/pro-access');

const STATE_POLL_MS = Object.freeze({ ACTIVE: 5000, REVIVER: 20000, IDLE: 60000 });

function computeStateVersion(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex').slice(0, 16);
}

function publicActiveRequest(request) {
  if (!request) return null;
  return {
    id: request.id,
    state: request.state,
    paymentMethod: request.paymentMethod,
    offerAmount: request.offerAmount,
    createdAt: request.createdAt,
    transactionId: request.transactionId || null
  };
}

const TRANSACTION_DEADLINE_FIELDS = Object.freeze(['paymentDeadline', 'reviveDeadline', 'retryResponseDeadline', 'refundDeadline']);

function nearestDeadlineMs(transaction) {
  let nearest = null;
  for (const field of TRANSACTION_DEADLINE_FIELDS) {
    const value = transaction[field];
    if (value == null) continue;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms)) continue;
    if (nearest === null || ms < nearest) nearest = ms;
  }
  return nearest;
}

function compareByNearestDeadline(a, b) {
  const da = nearestDeadlineMs(a);
  const db = nearestDeadlineMs(b);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  }
  const ia = String(a.id);
  const ib = String(b.id);
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

function ifNoneMatchMatches(header, etag) {
  if (typeof header !== 'string') return false;
  if (header.trim() === '*') return true;
  return header.split(',').some(entry => {
    const tag = entry.trim().replace(/^W\//, '');
    return tag === etag;
  });
}

function hasCredentialCapability(status, role) {
  return Boolean(status && status.usable && status.capabilities && status.capabilities[role] === true);
}

function publicVerification(status) {
  if (!status) return null;
  return {
    usable: Boolean(status.usable),
    requester: hasCredentialCapability(status, 'requester'),
    reviver: hasCredentialCapability(status, 'reviver')
  };
}

async function registerStateRoute(app, {
  requestRepository,
  transactionRepository,
  entitlementRepository = null,
  presenceRepository = null,
  verificationCredentialRepository = null,
  config = {},
  clock = () => new Date()
}) {
  if (typeof app.authenticate !== 'function') throw new Error('state route requires session authentication');
  if (!requestRepository || typeof requestRepository.getActiveRequest !== 'function') throw new Error('requestRepository is required');
  if (!transactionRepository ||
      typeof transactionRepository.listOpenTransactionIdsForUser !== 'function' ||
      typeof transactionRepository.getTransactionForUser !== 'function' ||
      typeof transactionRepository.countAvailableRequests !== 'function') {
    throw new Error('transactionRepository is required');
  }

  const subscription = publicSubscriptionState({
    mode: config.SUBSCRIPTION_MODE,
    receiverTornId: config.PRO_RECEIVER_TORN_ID,
    plans: publicProPlans()
  });
  const requireEntitlement = subscriptionRequiresEntitlement(config.SUBSCRIPTION_MODE);
  const ownerTornId = Number(config.PRO_RECEIVER_TORN_ID) || null;

  const sessionRateLimit = createSessionRateLimitHook(app, RATE_LIMITS.STATE);

  app.get('/v1/state', {
    config: { rateLimit: RATE_LIMITS.STATE_IP },
    preHandler: [app.authenticate, sessionRateLimit]
  }, async (request, reply) => {
    const user = request.reviveRelayUser;
    const now = clock();
    const isReviver = Array.isArray(user.roles) && user.roles.includes('reviver');

    const [activeRequest, openTransactionIds, closedTransactionIds, status, online, verificationStatus] = await Promise.all([
      requestRepository.getActiveRequest(user.userId),
      transactionRepository.listOpenTransactionIdsForUser(user.userId),
      typeof transactionRepository.listRecentlyClosedTransactionIdsForUser === 'function'
        ? transactionRepository.listRecentlyClosedTransactionIdsForUser(user.userId, { now })
        : [],
      entitlementRepository && typeof entitlementRepository.getStatus === 'function'
        ? entitlementRepository.getStatus(user.userId, now)
        : { state: 'NONE', trialEligible: true, trialStartedAt: null, validUntil: null },
      presenceRepository && typeof presenceRepository.countOnlineRevivers === 'function'
        ? presenceRepository.countOnlineRevivers({ now, requireEntitlement, ownerTornId })
        : null,
      verificationCredentialRepository && typeof verificationCredentialRepository.getStatus === 'function'
        ? verificationCredentialRepository.getStatus(user.userId)
        : null
    ]);
    const openTransactions = await Promise.all((openTransactionIds || []).map(transactionId =>
      transactionRepository.getTransactionForUser({ transactionId, userId: user.userId })
    ));
    const activeTransactions = openTransactions.filter(Boolean).sort(compareByNearestDeadline);
    // Newest closure first, as the repository returns them.
    const recentlyClosed = (await Promise.all((closedTransactionIds || []).map(transactionId =>
      transactionRepository.getTransactionForUser({ transactionId, userId: user.userId })
    ))).filter(Boolean);

    const pro = resolvePublicProStatus({ status, tornId: user.tornId, subscription });
    const hasQueueAccess = isReviver && (!requireEntitlement || hasActivePro(pro));
    const queueCount = hasQueueAccess ? await transactionRepository.countAvailableRequests() : null;

    const payload = {
      me: { tornId: user.tornId, name: user.name, roles: user.roles, verification: publicVerification(verificationStatus) },
      pro,
      activeRequest: publicActiveRequest(activeRequest),
      activeTransactions,
      recentlyClosed,
      revivers: { online: typeof online === 'number' ? online : null },
      queue: hasQueueAccess ? { count: queueCount } : null
    };
    const serialized = JSON.parse(JSON.stringify(payload));
    const stateVersion = computeStateVersion(serialized);
    const etag = `"${stateVersion}"`;

    let nextPollMs = STATE_POLL_MS.IDLE;
    if (serialized.activeRequest || serialized.activeTransactions.length > 0) nextPollMs = STATE_POLL_MS.ACTIVE;
    else if (isReviver) nextPollMs = STATE_POLL_MS.REVIVER;

    reply.header('ETag', etag);
    reply.header('Cache-Control', 'no-store');
    if (ifNoneMatchMatches(request.headers['if-none-match'], etag)) {
      return reply.code(304).send();
    }
    // serverTime lets the client correct its clock for countdowns and the 5 s "Revived" fade.
    // It is deliberately outside stateVersion, so an unchanged state still answers 304.
    return reply.code(200).send({ stateVersion, nextPollMs, serverTime: now.toISOString(), ...serialized });
  });
}

module.exports = {
  STATE_POLL_MS,
  computeStateVersion,
  registerStateRoute
};
