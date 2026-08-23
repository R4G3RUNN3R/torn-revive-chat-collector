const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createIdentityRepository } = require('./db/users');
const { createTornClient } = require('./torn/client');
const { buildApp } = require('./app');

async function start() {
  const config = loadConfig(process.env);
  const pool = createPool(config.DATABASE_URL);
  const tornClient = createTornClient({ baseUrl: config.TORN_API_BASE_URL });
  const identityRepository = createIdentityRepository(pool);
  const app = buildApp({
    config,
    tornClient,
    identityRepository,
    logger: true
  });

  const close = async signal => {
    try {
      await app.close();
      await pool.end();
    } finally {
      if (signal) process.exit(0);
    }
  };

  process.once('SIGINT', () => close('SIGINT'));
  process.once('SIGTERM', () => close('SIGTERM'));

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (error) {
    await close();
    throw error;
  }
}

if (require.main === module) {
  start().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  start
};
