const Fastify = require('fastify');
const { registerAuthRoutes } = require('./routes/auth');

function createApp({ config, tornClient, userRepository, logger = false }) {
  if (!config || !tornClient || !userRepository) {
    throw new TypeError('config, tornClient and userRepository are required');
  }

  const app = Fastify({ logger });

  app.get('/health', async () => ({ ok: true }));

  registerAuthRoutes(app, {
    config,
    tornClient,
    userRepository
  });

  return app;
}

module.exports = {
  createApp
};
