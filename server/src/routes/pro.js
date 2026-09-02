const { PRO_PLANS } = require('../domain/pro-plans');
const { publicProStatus } = require('../security/pro-access');

const PLAN_LABELS = Object.freeze({
  monthly:'Monthly',
  six_months:'6 Months',
  yearly:'Yearly'
});

function publicPlans() {
  return Object.values(PRO_PLANS).map(plan => ({
    id:plan.id,
    label:PLAN_LABELS[plan.id],
    months:plan.months,
    xanax:plan.xanax,
    cash:plan.cash
  }));
}

async function registerProRoutes(app, { entitlementRepository }) {
  if (typeof app.authenticate !== 'function') throw new Error('Pro routes require session authentication');
  if (!entitlementRepository ||
      typeof entitlementRepository.getStatus !== 'function' ||
      typeof entitlementRepository.startTrial !== 'function') {
    throw new Error('entitlementRepository is required');
  }

  app.get('/v1/pro/status', { preHandler:app.authenticate }, async (request, reply) => {
    const status = await entitlementRepository.getStatus(request.reviveRelayUser.userId, new Date());
    return reply.code(200).send({ pro:publicProStatus(status) });
  });

  app.get('/v1/pro/plans', { preHandler:app.authenticate }, async (_request, reply) => {
    return reply.code(200).send({ plans:publicPlans() });
  });

  app.post('/v1/pro/trial', { preHandler:app.authenticate }, async (request, reply) => {
    try {
      const status = await entitlementRepository.startTrial({
        userId:request.reviveRelayUser.userId,
        now:new Date()
      });
      return reply.code(200).send({ pro:publicProStatus(status) });
    } catch (error) {
      if (error && (error.message === 'TRIAL_NOT_ELIGIBLE' || error.message === 'TRIAL_ALREADY_USED')) {
        return reply.code(409).send({ error:error.message });
      }
      throw error;
    }
  });
}

module.exports = {
  publicPlans,
  registerProRoutes
};
