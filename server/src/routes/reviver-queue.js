const { RATE_LIMITS } = require('../security/rate-limits');

async function registerReviverQueueRoutes(app, { transactionRepository }) {
  if (!transactionRepository ||
      typeof transactionRepository.listAvailableRequests !== 'function' ||
      typeof transactionRepository.acceptRequest !== 'function') {
    throw new Error('transactionRepository is required');
  }
  if (typeof app.authenticate !== 'function') {
    throw new Error('reviver queue routes require session authentication');
  }

  async function requireReviver(request, reply) {
    const user = request.reviveRelayUser;
    if (!user || !Array.isArray(user.roles) || !user.roles.includes('reviver')) {
      return reply.code(403).send({ error: 'REVIVER_REQUIRED' });
    }
  }

  app.get('/v1/reviver/queue', {
    preHandler: [app.authenticate, requireReviver],
    config: {
      rateLimit: RATE_LIMITS.REVIVER_QUEUE
    }
  }, async (request, reply) => {
    const requests = await transactionRepository.listAvailableRequests();
    return reply.code(200).send({ requests });
  });

  app.post('/v1/requests/:id/accept', {
    preHandler: [app.authenticate, requireReviver],
    config: {
      rateLimit: RATE_LIMITS.ACCEPT
    }
  }, async (request, reply) => {
    const result = await transactionRepository.acceptRequest({
      requestId: request.params.id,
      reviverId: request.reviveRelayUser.userId,
      now: new Date()
    });

    if (result.accepted) {
      return reply.code(200).send(result);
    }
    if (result.reason === 'REVIVER_NOT_ELIGIBLE') {
      return reply.code(403).send({ error: 'REVIVER_NOT_ELIGIBLE' });
    }
    if (result.reason === 'SELF_ACCEPT_NOT_ALLOWED') {
      return reply.code(409).send({ error: 'SELF_ACCEPT_NOT_ALLOWED' });
    }
    return reply.code(409).send({ error: 'REQUEST_UNAVAILABLE' });
  });
}

module.exports = {
  registerReviverQueueRoutes
};
