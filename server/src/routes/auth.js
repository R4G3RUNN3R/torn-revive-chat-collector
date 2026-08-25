const { z } = require('zod');
const { RATE_LIMITS } = require('../security/rate-limits');
const { newSessionToken, hashSessionToken } = require('../security/sessions');
const { TornApiError } = require('../torn/client');

const bindSchema = z.object({
  apiKey: z.string().min(1).max(128),
  clientVersion: z.string().min(1).max(50)
}).strict();

async function registerAuthRoute(app, {
  config,
  tornClient,
  identityRepository
}) {
  app.post('/v1/auth/bind', {
    config: {
      rateLimit: RATE_LIMITS.AUTH_BIND
    }
  }, async (request, reply) => {
    const parsed = bindSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({
        error: 'INVALID_REQUEST',
        message: 'A Torn API key and client version are required.'
      });
    }

    const { apiKey, clientVersion } = parsed.data;

    let identity;
    try {
      identity = await tornClient.getKeyInfo(apiKey);
    } catch (error) {
      if (error instanceof TornApiError && error.code === 'TORN_INVALID_KEY') {
        return reply.code(401).send({ error: 'TORN_INVALID_KEY' });
      }
      if (error instanceof TornApiError && error.code === 'TORN_UNAVAILABLE') {
        return reply.code(503).send({ error: 'TORN_UNAVAILABLE' });
      }
      throw error;
    }

    const token = newSessionToken();
    const tokenHash = hashSessionToken(token, config.SESSION_TOKEN_PEPPER);

    await identityRepository.bindIdentity({
      tornId: identity.tornId,
      name: identity.name,
      access: identity.access,
      tokenHash,
      clientVersion
    });

    return reply.code(200).send({
      token,
      user: {
        tornId: identity.tornId,
        name: identity.name
      },
      keyAccess: identity.access
    });
  });
}

module.exports = {
  registerAuthRoute
};
