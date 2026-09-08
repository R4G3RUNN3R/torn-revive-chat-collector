const { publicProPlans } = require('../domain/pro-plans');
const { publicSubscriptionState } = require('../domain/subscription-mode');
const { createRuntimeContract } = require('../domain/runtime-contract');
const { resolvePublicProStatus } = require('../security/pro-access');

async function registerMeRoute(app, { entitlementRepository = null, config = {} } = {}) {
  if (typeof app.authenticate !== 'function') {
    throw new Error('me route requires session authentication');
  }

  const subscription = publicSubscriptionState({
    mode:config.SUBSCRIPTION_MODE,
    receiverTornId:config.PRO_RECEIVER_TORN_ID,
    plans:publicProPlans()
  });
  const runtime = createRuntimeContract({
    serverVersion:config.REVIVERELAY_SERVER_VERSION || '0.6.1',
    minimumClientVersion:config.REVIVERELAY_MINIMUM_CLIENT_VERSION || '0.6.1',
    releaseChannel:config.REVIVERELAY_RELEASE_CHANNEL || 'stable',
    subscription
  });

  app.get('/v1/me', {
    preHandler: app.authenticate
  }, async (request, reply) => {
    const status = entitlementRepository && typeof entitlementRepository.getStatus === 'function'
      ? await entitlementRepository.getStatus(request.reviveRelayUser.userId, new Date())
      : { state:'NONE', trialEligible:true, trialStartedAt:null, validUntil:null };
    return reply.code(200).send({
      user: {
        tornId: request.reviveRelayUser.tornId,
        name: request.reviveRelayUser.name
      },
      roles: request.reviveRelayUser.roles,
      pro: resolvePublicProStatus({status,tornId:request.reviveRelayUser.tornId,subscription}),
      subscription,
      runtime
    });
  });
}

module.exports = {
  registerMeRoute
};
