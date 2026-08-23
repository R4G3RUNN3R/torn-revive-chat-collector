const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createUserRepository } = require('./db/users');
const { createTornClient } = require('./torn/client');
const { createApp } = require('./app');

async function start() {
  const config = loadConfig(process.env);
  const pool = createPool(config.DATABASE_URL);
  const tornClient = createTornClient({ baseUrl: config.TORN_API_BASE_URL });
  const userRepository = createUserRepository(pool);
  const app = createApp({
    config,
    tornClient,
    userRepository,
    logger: true
  });

  const shutdown = async (signal) => {
    app.log.info({ signal }, 'shutting down ReviveRelay API');
    try {
      await app.close();
    } finally {
      await pool.end();
    }
  };

  process.once('SIGTERM', () => {
    shutdown('SIGTERM').catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
  process.once('SIGINT', () => {
    shutdown('SIGINT').catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (error) {
    await pool.end();
    throw error;
  }

  return { app, pool };
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  start
};
