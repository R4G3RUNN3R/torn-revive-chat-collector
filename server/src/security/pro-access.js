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

function requireActivePro(entitlementRepository) {
  if (!entitlementRepository || typeof entitlementRepository.getStatus !== 'function') {
    throw new Error('entitlementRepository is required');
  }
  return async function proGuard(request, reply) {
    const status = await entitlementRepository.getStatus(request.reviveRelayUser.userId, new Date());
    if (!hasActivePro(status)) {
      return reply.code(403).send({ error:'REVIVER_PRO_REQUIRED' });
    }
    request.reviveRelayPro = status;
  };
}

module.exports = {
  hasActivePro,
  publicProStatus,
  requireActivePro
};
