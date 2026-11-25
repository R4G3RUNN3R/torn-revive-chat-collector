const crypto = require('node:crypto');
const { RATE_LIMITS } = require('../security/rate-limits');
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

async function registerStateRoute(app, {
  requestRepository,
  transactionRepository,
  entitlementRepository = null,
  presenceRepository = null,
  config = {},
  clock = () => new Date()
}) {
  if (typeof app.authenticate !== 'function') throw new Error('state route requires session authentication');
  if (!requestRepository || typeof requestRepository.getActiveRequest !== 'function') throw new Error('requestRepository is required');
  if (!transactionRepository ||
      typeof transactionRepository.findOpenTransactionIdForUser !== 'function' ||
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

  app.get('/v1/state', {
    preHandler: app.authenticate,
    config: { rateLimit: RATE_LIMITS.STATE }
  }, async (request, reply) => {
    const user = request.reviveRelayUser;
    const now = clock();
    const isReviver = Array.isArray(user.roles) && user.roles.includes('reviver');

    const [activeRequest, openTransactionId, status, online] = await Promise.all([
      requestRepository.getActiveRequest(user.userId),
      transactionRepository.findOpenTransactionIdForUser(user.userId),
      entitlementRepository && typeof entitlementRepository.getStatus === 'function'
        ? entitlementRepository.getStatus(user.userId, now)
        : { state: 'NONE', trialEligible: true, trialStartedAt: null, validUntil: null },
      presenceRepository && typeof presenceRepository.countOnlineRevivers === 'function'
        ? presenceRepository.countOnlineRevivers({ now, requireEntitlement, ownerTornId })
        : null
    ]);
    const activeTransaction = openTransactionId
      ? await transactionRepository.getTransactionForUser({ transactionId: openTransactionId, userId: user.userId })
      : null;

    const pro = resolvePublicProStatus({ status, tornId: user.tornId, subscription });
    const hasQueueAccess = isReviver && (!requireEntitlement || hasActivePro(pro));
    const queueCount = hasQueueAccess ? await transactionRepository.countAvailableRequests() : null;

    const payload = {
      me: { tornId: user.tornId, name: user.name, roles: user.roles },
      pro,
      activeRequest: publicActiveRequest(activeRequest),
      activeTransaction: activeTransaction || null,
      revivers: { online: typeof online === 'number' ? online : null },
      queue: hasQueueAccess ? { count: queueCount } : null
    };
    const serialized = JSON.parse(JSON.stringify(payload));
    const stateVersion = computeStateVersion(serialized);
    const etag = `"${stateVersion}"`;

    let nextPollMs = STATE_POLL_MS.IDLE;
    if (serialized.activeRequest || serialized.activeTransaction) nextPollMs = STATE_POLL_MS.ACTIVE;
    else if (isReviver) nextPollMs = STATE_POLL_MS.REVIVER;

    reply.header('ETag', etag);
    reply.header('Cache-Control', 'no-store');
    if (request.headers['if-none-match'] === etag) {
      return reply.code(304).send();
    }
    return reply.code(200).send({ stateVersion, nextPollMs, ...serialized });
  });
}

module.exports = {
  STATE_POLL_MS,
  computeStateVersion,
  registerStateRoute
};
