const { assertCredentialCapability } = require('../security/verification-credential');

function sendCredentialError(reply, error) {
  const code = error && error.code;
  if (['VERIFICATION_CREDENTIAL_REQUIRED','VERIFICATION_CREDENTIAL_INSUFFICIENT','VERIFICATION_CREDENTIAL_INVALID'].includes(code)) {
    return reply.code(409).send({ error: code });
  }
  throw error;
}

async function registerReviverRoutes(app, { verificationCredentialRepository, reviverRepository }) {
  if (typeof app.authenticate !== 'function') throw new Error('reviver routes require session authentication');
  if (!verificationCredentialRepository || typeof verificationCredentialRepository.getStatus !== 'function') {
    throw new Error('verificationCredentialRepository is required');
  }
  if (!reviverRepository || typeof reviverRepository.register !== 'function') throw new Error('reviverRepository is required');

  app.post('/v1/reviver/register', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const status = await verificationCredentialRepository.getStatus(request.reviveRelayUser.userId);
      assertCredentialCapability(status, 'reviver');
    } catch (error) {
      return sendCredentialError(reply, error);
    }

    const result = await reviverRepository.register({ userId: request.reviveRelayUser.userId, now: new Date() });
    if (!result.registered) {
      return reply.code(403).send({ error: result.reason || 'REVIVER_NOT_ELIGIBLE', reviver: result.reviver || null });
    }
    return reply.code(200).send(result);
  });
}

module.exports = {
  registerReviverRoutes
};
