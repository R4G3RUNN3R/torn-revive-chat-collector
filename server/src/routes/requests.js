const { z } = require('zod');
const { validateOffer, RequestValidationError } = require('../domain/request');

const createSchema = z.object({
  paymentMethod: z.string(),
  offerAmount: z.number(),
  comment: z.string().nullable().optional()
}).strict();

const requestIdSchema = z.string().uuid();

async function registerRequestRoutes(app, { requestRepository = null } = {}) {
  app.post('/v1/requests', {
    preHandler: app.authenticateReviveRelay
  }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({
        ok: false,
        code: 'INVALID_REQUEST',
        message: 'Request payload is invalid'
      });
    }

    let offer;
    try {
      offer = validateOffer(parsed.data);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return reply.code(422).send({
          ok: false,
          code: error.code,
          message: error.message
        });
      }
      throw error;
    }

    if (!requestRepository || typeof requestRepository.createOrGetActive !== 'function') {
      return reply.code(503).send({
        ok: false,
        code: 'REQUEST_STORAGE_UNAVAILABLE',
        message: 'Request storage is not configured'
      });
    }

    const result = await requestRepository.createOrGetActive({
      requesterId: request.reviveRelayUser.userId,
      ...offer,
      now: new Date()
    });

    return reply.code(result.created ? 201 : 200).send({
      ok: true,
      created: result.created,
      request: result.request
    });
  });

  app.get('/v1/requests/active', {
    preHandler: app.authenticateReviveRelay
  }, async (request, reply) => {
    if (!requestRepository || typeof requestRepository.getActive !== 'function') {
      return reply.code(503).send({
        ok: false,
        code: 'REQUEST_STORAGE_UNAVAILABLE',
        message: 'Request storage is not configured'
      });
    }

    const active = await requestRepository.getActive(request.reviveRelayUser.userId);
    return reply.send({ ok: true, request: active });
  });

  app.post('/v1/requests/:id/cancel', {
    preHandler: app.authenticateReviveRelay
  }, async (request, reply) => {
    const parsedId = requestIdSchema.safeParse(request.params && request.params.id);
    if (!parsedId.success) {
      return reply.code(422).send({
        ok: false,
        code: 'INVALID_REQUEST_ID',
        message: 'Request ID is invalid'
      });
    }

    if (!requestRepository || typeof requestRepository.cancelAvailable !== 'function') {
      return reply.code(503).send({
        ok: false,
        code: 'REQUEST_STORAGE_UNAVAILABLE',
        message: 'Request storage is not configured'
      });
    }

    const cancelled = await requestRepository.cancelAvailable(
      parsedId.data,
      request.reviveRelayUser.userId,
      new Date()
    );

    if (!cancelled) {
      return reply.code(409).send({
        ok: false,
        code: 'REQUEST_NOT_CANCELLABLE',
        message: 'Request cannot be cancelled in its current state'
      });
    }

    return reply.send({ ok: true, request: cancelled });
  });
}

module.exports = {
  registerRequestRoutes
};
