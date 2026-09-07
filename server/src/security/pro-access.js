const { normalizeSubscriptionMode, subscriptionRequiresEntitlement } = require('../domain/subscription-mode');

function hasActivePro(status) {
  return Boolean(status && (status.state === 'TRIAL' || status.state === 'ACTIVE'));
}

function publicProStatus(status) {
  const safe = status || {};
  return {
    state: typeof safe.state === 'string' ? safe.state : 'NONE',
    trialEligible: Boolean(safe.trialEligible),
    trialStartedAt: safe.trialStartedAt || null,
    validUntil: safe.validUntil || null
  };
}

function requireReviverSubscriptionAccess({ entitlementRepository, subscriptionMode } = {}) {
  const mode = normalizeSubscriptionMode(subscriptionMode);
  if (subscriptionRequiresEntitlement(mode) &&
      (!entitlementRepository || typeof entitlementRepository.getStatus !== 'function')) {
    throw new Error('entitlementRepository is required');
  }

  return async function subscriptionGuard(request, reply) {
    request.reviveRelaySubscriptionMode = mode;
    if (!subscriptionRequiresEntitlement(mode)) return;
    const status = await entitlementRepository.getStatus(request.reviveRelayUser.userId, new Date());
    if (!hasActivePro(status)) {
      return reply.code(403).send({ error:'REVIVER_PRO_REQUIRED' });
    }
    request.reviveRelayPro = status;
  };
}

function requireActivePro(entitlementRepository) {
  return requireReviverSubscriptionAccess({ entitlementRepository, subscriptionMode:'review' });
}

module.exports = {
  hasActivePro,
  publicProStatus,
  requireReviverSubscriptionAccess,
  requireActivePro
};
