const { z } = require('zod');
const { validateOffer } = require('../domain/request');
const { RATE_LIMITS } = require('../security/rate-limits');

const requestIdSchema = z.string().uuid();

async function registerRequestRoutes(app, { requestRepository }) {
  if (!requestRepository ||
      typeof requestRepository.createRequest !== 'function' ||
      typeof requestRepository.getActiveRequest !== 'function' ||
      typeof requestRepository.cancelRequest !== 'function') {
    throw new Error('requestRepository is required');
  }
  if (typeof app.authenticate !== 'function') {
    throw new Error('request routes require session authentication');
  }

  app.post('/v1/requests', {
    preHandler: app.authenticate,
    config: {
      rateLimit: RATE_LIMITS.REQUEST_WRITE
    }
  }, async (request, reply) => {
    let offer;
    try {
      offer = validateOffer(request.body || {});
    } catch (error) {
      return reply.code(422).send({ error: 'INVALID_OFFER' });
    }

    const result = await requestRepository.createRequest({
      requesterId: request.reviveRelayUser.userId,
      ...offer
    });

    if (result.reason === 'REQUEST_COMMITTED') {
      return reply.code(409).send({
        error: 'REQUEST_COMMITTED',
        request: result.request
      });
    }

    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.get('/v1/requests/active', { preHandler: app.authenticate }, async (request, reply) => {
    const active = await requestRepository.getActiveRequest(
      request.reviveRelayUser.userId
    );
    return reply.code(200).send({ request: active });
  });

  app.post('/v1/requests/:id/cancel', {
    preHandler: app.authenticate,
    config: {
      rateLimit: RATE_LIMITS.REQUEST_WRITE
    }
  }, async (request, reply) => {
    const parsedId = requestIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      return reply.code(422).send({ error: 'INVALID_REQUEST_ID' });
    }

    const result = await requestRepository.cancelRequest({
      requestId: parsedId.data,
      requesterId: request.reviveRelayUser.userId,
      now: new Date()
    });

    if (result.cancelled) {
      return reply.code(200).send(result);
    }
    if (result.reason === 'NOT_FOUND') {
      return reply.code(404).send({ error: 'REQUEST_NOT_FOUND' });
    }
    if (result.reason === 'PAYMENT_COMMITTED') {
      return reply.code(409).send({ error: 'PAYMENT_COMMITTED' });
    }
    if (result.reason === 'REQUEST_COMMITTED') {
      return reply.code(409).send({ error: 'REQUEST_COMMITTED' });
    }

    return reply.code(409).send({ error: 'REQUEST_NOT_CANCELLABLE' });
  });
}

module.exports = {
  registerRequestRoutes
};
