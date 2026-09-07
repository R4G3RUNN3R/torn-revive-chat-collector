const { assertCredentialCapability } = require('../security/verification-credential');
const { requireReviverSubscriptionAccess } = require('../security/pro-access');
const { createReviveEligibilityService } = require('../torn/revive-eligibility');

const CREDENTIAL_ERRORS = new Set([
  'VERIFICATION_CREDENTIAL_REQUIRED',
  'VERIFICATION_CREDENTIAL_INSUFFICIENT',
  'VERIFICATION_CREDENTIAL_INVALID'
]);

function sendCredentialError(reply, error) {
  const code = error && error.code;
  if (CREDENTIAL_ERRORS.has(code)) return reply.code(409).send({ error: code });
  throw error;
}

async function registerReviverRoutes(app, {
  tornClient,
  verificationCredentialRepository,
  reviverRepository,
  entitlementRepository,
  config = {}
}) {
  if (typeof app.authenticate !== 'function') throw new Error('reviver routes require session authentication');
  if (!verificationCredentialRepository || typeof verificationCredentialRepository.getStatus !== 'function') {
    throw new Error('verificationCredentialRepository is required');
  }
  if (!reviverRepository || typeof reviverRepository.register !== 'function') throw new Error('reviverRepository is required');
  const requireSubscriptionAccess = requireReviverSubscriptionAccess({
    entitlementRepository,
    subscriptionMode:config.SUBSCRIPTION_MODE
  });
  const eligibilityService = createReviveEligibilityService({ tornClient, verificationCredentialRepository });

  async function assertReviverCredential(userId) {
    const status = await verificationCredentialRepository.getStatus(userId);
    assertCredentialCapability(status, 'reviver');
  }

  app.get('/v1/reviver/eligibility', { preHandler: [app.authenticate, requireSubscriptionAccess] }, async (request, reply) => {
    const userId = request.reviveRelayUser.userId;
    try {
      await assertReviverCredential(userId);
    } catch (error) {
      if (CREDENTIAL_ERRORS.has(error && error.code)) {
        return reply.code(200).send({ eligibility: { status: 'VERIFICATION_REQUIRED', canRevive: null } });
      }
      throw error;
    }

    try {
      return reply.code(200).send({ eligibility: await eligibilityService.check(userId) });
    } catch (error) {
      if (error && error.code === 'REVIVE_ABILITY_PERMISSION_REQUIRED') {
        return reply.code(200).send({ eligibility: { status: 'PERMISSION_REQUIRED', canRevive: null } });
      }
      if (CREDENTIAL_ERRORS.has(error && error.code)) {
        return reply.code(200).send({ eligibility: { status: 'VERIFICATION_REQUIRED', canRevive: null } });
      }
      throw error;
    }
  });

  app.post('/v1/reviver/register', { preHandler: [app.authenticate, requireSubscriptionAccess] }, async (request, reply) => {
    const userId = request.reviveRelayUser.userId;
    try {
      await assertReviverCredential(userId);
    } catch (error) {
      return sendCredentialError(reply, error);
    }

    let eligibility;
    try {
      eligibility = await eligibilityService.check(userId);
    } catch (error) {
      if (error && error.code === 'REVIVE_ABILITY_PERMISSION_REQUIRED') {
        return reply.code(409).send({ error: 'REVIVE_ABILITY_PERMISSION_REQUIRED' });
      }
      return sendCredentialError(reply, error);
    }

    if (!eligibility.canRevive) {
      return reply.code(403).send({ error: 'REVIVE_ABILITY_NOT_UNLOCKED' });
    }

    const result = await reviverRepository.register({ userId, now: new Date() });
    if (!result.registered) {
      return reply.code(403).send({ error: result.reason || 'REVIVER_NOT_ELIGIBLE', reviver: result.reviver || null });
    }
    return reply.code(200).send(result);
  });
}

module.exports = {
  registerReviverRoutes
};
