const Fastify = require('fastify');
const { registerAuthRoute } = require('./routes/auth');

function buildApp({
  config,
  tornClient,
  identityRepository,
  logger = false
}) {
  if (!config) throw new Error('config is required');
  if (!tornClient) throw new Error('tornClient is required');
  if (!identityRepository) throw new Error('identityRepository is required');

  const app = Fastify({ logger });

  app.get('/health', async () => ({ ok: true }));

  app.register(async instance => {
    await registerAuthRoute(instance, {
      config,
      tornClient,
      identityRepository
    });
  });

  return app;
}

module.exports = {
  buildApp
};
