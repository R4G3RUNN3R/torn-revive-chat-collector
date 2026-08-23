const { z } = require('zod');
const { encryptSecret } = require('../security/crypto');
const { newSessionToken, hashSessionToken } = require('../security/sessions');

const bindSchema = z.object({
  apiKey: z.string().min(1).max(256),
  clientVersion: z.string().min(1).max(64)
}).strict();

function errorStatus(code) {
  switch (code) {
    case 'TORN_INVALID_KEY': return 401;
    case 'TORN_KEY_ACCESS': return 422;
    case 'TORN_UNAVAILABLE': return 503;
    case 'TORN_RESPONSE_INVALID': return 502;
    default: return 500;
  }
}

async function registerAuthRoutes(app, { config, tornClient, userRepository }) {
  app.post('/v1/auth/bind', async (request, reply) => {
    const parsed = bindSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({
        ok: false,
        code: 'INVALID_REQUEST',
        message: 'A Torn API key and client version are required'
      });
    }

    const { apiKey, clientVersion } = parsed.data;

    let identity;
    try {
      identity = await tornClient.getKeyInfo(apiKey);
    } catch (error) {
      const code = error && error.code ? error.code : 'TORN_API_ERROR';
      return reply.code(errorStatus(code)).send({
        ok: false,
        code,
        message: code === 'TORN_INVALID_KEY'
          ? 'Torn rejected the API key'
          : code === 'TORN_KEY_ACCESS'
            ? 'The Torn API key is missing a required selection'
            : 'Torn API verification is temporarily unavailable'
      });
    }

    const encryptedCredential = encryptSecret(apiKey, config.API_KEY_ENCRYPTION_KEY);
    const token = newSessionToken();
    const tokenHash = hashSessionToken(token, config.SESSION_TOKEN_PEPPER);

    await userRepository.bindIdentity({
      tornId: identity.tornId,
      name: identity.name,
      encryptedCredential,
      keyAccess: identity.access,
      tokenHash,
      clientVersion
    });

    return reply.send({
      ok: true,
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
  registerAuthRoutes
};
