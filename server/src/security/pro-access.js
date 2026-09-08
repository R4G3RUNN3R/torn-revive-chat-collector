const {
  normalizeSubscriptionMode,
  subscriptionRequiresEntitlement,
  isCanonicalOwner,
  PRO_MERCHANT_NAME,
  PRO_MERCHANT_TORN_ID
} = require('../domain/subscription-mode');

const STORED_PRO_STATES = Object.freeze(['NONE','TRIAL','ACTIVE','EXPIRED','REVOKED']);

function hasActivePro(status) {
  return Boolean(status && ['TRIAL','ACTIVE','OWNER'].includes(status.state));
}

function publicProStatus(status) {
  const safe = status || {};
  const state = STORED_PRO_STATES.includes(safe.state) ? safe.state : 'NONE';
  return {
    state,
    trialEligible: Boolean(safe.trialEligible),
    trialStartedAt: safe.trialStartedAt || null,
    validUntil: safe.validUntil || null
  };
}

function resolvePublicProStatus({ status, tornId, subscription } = {}) {
  if (isCanonicalOwner({ tornId, subscription })) {
    return {
      state:'OWNER',
      trialEligible:false,
      trialStartedAt:null,
      validUntil:null
    };
  }
  return publicProStatus(status);
}

function subscriptionIdentityContext(mode, receiverTornId) {
  const merchantId = Number(receiverTornId);
  return {
    mode,
    merchant: Number.isSafeInteger(merchantId) && merchantId > 0
      ? { tornId:merchantId, name:PRO_MERCHANT_NAME }
      : null
  };
}

function requireReviverSubscriptionAccess({ entitlementRepository, subscriptionMode, receiverTornId = null } = {}) {
  const mode = normalizeSubscriptionMode(subscriptionMode);
  if (subscriptionRequiresEntitlement(mode) &&
      (!entitlementRepository || typeof entitlementRepository.getStatus !== 'function')) {
    throw new Error('entitlementRepository is required');
  }
  const subscription = subscriptionIdentityContext(mode, receiverTornId);

  return async function subscriptionGuard(request, reply) {
    request.reviveRelaySubscriptionMode = mode;
    if (!subscriptionRequiresEntitlement(mode)) return;
    const status = await entitlementRepository.getStatus(request.reviveRelayUser.userId, new Date());
    const resolved = resolvePublicProStatus({
      status,
      tornId:request.reviveRelayUser.tornId,
      subscription
    });
    if (!hasActivePro(resolved)) {
      return reply.code(403).send({ error:'REVIVER_PRO_REQUIRED' });
    }
    request.reviveRelayPro = resolved;
  };
}

function requireActivePro(entitlementRepository) {
  return requireReviverSubscriptionAccess({
    entitlementRepository,
    subscriptionMode:'review',
    receiverTornId:PRO_MERCHANT_TORN_ID
  });
}

module.exports = {
  hasActivePro,
  publicProStatus,
  resolvePublicProStatus,
  requireReviverSubscriptionAccess,
  requireActivePro
};
