const { z } = require('zod');
const { validateTransactionCredential } = require('../torn/key-capabilities');
const { TornApiError } = require('../torn/client');

const bindSchema = z.object({
  apiKey: z.string().trim().min(1).max(512)
}).strict();

function accessScopeFromKeyInfo(keyInfo) {
  const log = keyInfo.access && keyInfo.access.log;
  return {
    selections: keyInfo.selections || {},
    log: log ? {
      customPermissions: Boolean(log.custom_permissions),
      categories: Array.isArray(log.available)
        ? log.available.map(entry => Number(entry.category_id)).filter(Number.isSafeInteger)
        : []
    } : null
  };
}

async function registerVerificationCredentialRoutes(app, {
  tornClient,
  verificationCredentialRepository,
  logMetadataResolver
}) {
  if (typeof app.authenticate !== 'function') throw new Error('verification credential routes require session authentication');
  if (!tornClient || typeof tornClient.getKeyInfo !== 'function') throw new Error('tornClient is required');
  if (!verificationCredentialRepository || typeof verificationCredentialRepository.getStatus !== 'function' ||
      typeof verificationCredentialRepository.bind !== 'function' || typeof verificationCredentialRepository.revoke !== 'function') {
    throw new Error('verificationCredentialRepository is required');
  }

  app.get('/v1/verification-credential', { preHandler: app.authenticate }, async (request, reply) => {
    const credential = await verificationCredentialRepository.getStatus(request.reviveRelayUser.userId);
    return reply.code(200).send({ credential });
  });

  app.post('/v1/verification-credential', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = bindSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(422).send({ error: 'VERIFICATION_CREDENTIAL_INVALID' });

    const apiKey = parsed.data.apiKey;
    try {
      const keyInfo = await tornClient.getKeyInfo(apiKey);
      const usesLog = Array.isArray(keyInfo.selections && keyInfo.selections.user) &&
        keyInfo.selections.user.map(value => String(value).toLowerCase()).includes('log');
      const logMetadata = usesLog
        ? await logMetadataResolver.get(apiKey)
        : { categories: {} };
      const capability = validateTransactionCredential({
        keyInfo,
        ownerTornId: request.reviveRelayUser.tornId,
        logMetadata
      });
      if (!capability.requester && !capability.reviver) {
        return reply.code(422).send({
          error: 'VERIFICATION_CREDENTIAL_INSUFFICIENT',
          missing: capability.missing
        });
      }

      const credential = await verificationCredentialRepository.bind({
        userId: request.reviveRelayUser.userId,
        plaintextKey: apiKey,
        capability,
        accessScope: accessScopeFromKeyInfo(keyInfo),
        validatedAt: new Date()
      });
      return reply.code(200).send({ credential });
    } catch (error) {
      if (error instanceof TornApiError && error.code === 'TORN_INVALID_KEY') {
        return reply.code(401).send({ error: 'VERIFICATION_CREDENTIAL_INVALID' });
      }
      if (error instanceof TornApiError && error.code === 'TORN_UNAVAILABLE') {
        return reply.code(503).send({ error: 'TORN_UNAVAILABLE' });
      }
      if (/credential|selection|namespace|permission|owner mismatch/i.test(String(error && error.message))) {
        return reply.code(422).send({ error: 'VERIFICATION_CREDENTIAL_INSUFFICIENT' });
      }
      throw error;
    }
  });

  app.delete('/v1/verification-credential', { preHandler: app.authenticate }, async (request, reply) => {
    const revoked = await verificationCredentialRepository.revoke({
      userId: request.reviveRelayUser.userId,
      reason: 'user_revoke',
      now: new Date()
    });
    return reply.code(200).send({ revoked });
  });
}

module.exports = {
  registerVerificationCredentialRoutes
};
