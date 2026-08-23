const { z } = require('zod');

const requestIdSchema = z.string().uuid();

function requireReviver(request, reply) {
  if (!request.reviveRelayUser || !request.reviveRelayUser.roles.includes('reviver')) {
    reply.code(403).send({
      ok: false,
      code: 'REVIVER_REQUIRED',
      message: 'Active reviver access is required'
    });
    return false;
  }
  return true;
}

async function registerReviverQueueRoutes(app, { transactionRepository = null } = {}) {
  app.get('/v1/reviver/queue', {
    preHandler: app.authenticateReviveRelay
  }, async (request, reply) => {
    if (!requireReviver(request, reply)) return;
    if (!transactionRepository || typeof transactionRepository.listAvailable !== 'function') {
      return reply.code(503).send({
        ok: false,
        code: 'MARKETPLACE_STORAGE_UNAVAILABLE',
        message: 'Marketplace storage is not configured'
      });
    }

    return reply.send({
      ok: true,
      requests: await transactionRepository.listAvailable()
    });
  });

  app.post('/v1/requests/:id/accept', {
    preHandler: app.authenticateReviveRelay
  }, async (request, reply) => {
    if (!requireReviver(request, reply)) return;

    const parsedId = requestIdSchema.safeParse(request.params && request.params.id);
    if (!parsedId.success) {
      return reply.code(422).send({
        ok: false,
        code: 'INVALID_REQUEST_ID',
        message: 'Request ID is invalid'
      });
    }

    if (!transactionRepository || typeof transactionRepository.acceptRequest !== 'function') {
      return reply.code(503).send({
        ok: false,
        code: 'MARKETPLACE_STORAGE_UNAVAILABLE',
        message: 'Marketplace storage is not configured'
      });
    }

    try {
      const transaction = await transactionRepository.acceptRequest({
        requestId: parsedId.data,
        reviverId: request.reviveRelayUser.userId,
        now: new Date()
      });
      return reply.code(201).send({ ok: true, transaction });
    } catch (error) {
      if (error && error.code === 'REQUEST_NOT_AVAILABLE') {
        return reply.code(409).send({
          ok: false,
          code: error.code,
          message: 'Request is no longer available'
        });
      }
      if (error && error.code === 'REVIVER_NOT_ELIGIBLE') {
        return reply.code(403).send({
          ok: false,
          code: error.code,
          message: 'Reviver is not eligible to accept requests'
        });
      }
      throw error;
    }
  });
}

module.exports = {
  registerReviverQueueRoutes
};
