const { z } = require('zod');
const { RATE_LIMITS } = require('../security/rate-limits');
const { assertCredentialCapability } = require('../security/verification-credential');

const requestIdSchema = z.string().uuid();

async function registerReviverQueueRoutes(app, { transactionRepository, verificationCredentialRepository }) {
  if (!transactionRepository ||
      typeof transactionRepository.listAvailableRequests !== 'function' ||
      typeof transactionRepository.acceptRequest !== 'function') {
    throw new Error('transactionRepository is required');
  }
  if (typeof app.authenticate !== 'function') {
    throw new Error('reviver queue routes require session authentication');
  }
  if (!verificationCredentialRepository || typeof verificationCredentialRepository.getStatus !== 'function') {
    throw new Error('reviver queue routes require verificationCredentialRepository');
  }

  async function requireReviver(request, reply) {
    const user = request.reviveRelayUser;
    if (!user || !Array.isArray(user.roles) || !user.roles.includes('reviver')) {
      return reply.code(403).send({ error: 'REVIVER_REQUIRED' });
    }
  }

  async function requireReviverCredential(request, reply) {
    try {
      const status = await verificationCredentialRepository.getStatus(request.reviveRelayUser.userId);
      assertCredentialCapability(status, 'reviver');
    } catch (error) {
      const code = error && error.code;
      if (['VERIFICATION_CREDENTIAL_REQUIRED','VERIFICATION_CREDENTIAL_INSUFFICIENT','VERIFICATION_CREDENTIAL_INVALID'].includes(code)) {
        return reply.code(409).send({ error: code });
      }
      throw error;
    }
  }

  app.get('/v1/reviver/queue', {
    preHandler: [app.authenticate, requireReviver, requireReviverCredential],
    config: {
      rateLimit: RATE_LIMITS.REVIVER_QUEUE
    }
  }, async (request, reply) => {
    const requests = await transactionRepository.listAvailableRequests();
    return reply.code(200).send({ requests });
  });

  app.post('/v1/requests/:id/accept', {
    preHandler: [app.authenticate, requireReviver, requireReviverCredential],
    config: {
      rateLimit: RATE_LIMITS.ACCEPT
    }
  }, async (request, reply) => {
    const parsedId = requestIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      return reply.code(422).send({ error: 'INVALID_REQUEST_ID' });
    }

    const result = await transactionRepository.acceptRequest({
      requestId: parsedId.data,
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
