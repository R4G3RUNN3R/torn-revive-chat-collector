const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createUserRepository } = require('./db/users');
const { createSessionRepository } = require('./db/sessions');
const { upsertCandidate } = require('./db/candidates');
const { createRequestRepository } = require('./db/requests');
const { createTransactionRepository } = require('./db/transactions');
const { createTornClient } = require('./torn/client');
const { createApp } = require('./app');

function createRuntime({ config, pool = null, tornClient = null, logger = false } = {}) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('ReviveRelay runtime config is required');
  }

  const runtimePool = pool || createPool(config.DATABASE_URL);
  const runtimeTornClient = tornClient || createTornClient({ baseUrl: config.TORN_API_BASE_URL });
  const userRepository = createUserRepository(runtimePool);
  const sessionRepository = createSessionRepository(runtimePool);
  const requestRepository = createRequestRepository(runtimePool);
  const transactionRepository = createTransactionRepository(runtimePool);
  const candidateRepository = {
    async acceptCandidate(candidate) {
      const result = await upsertCandidate(runtimePool, candidate, new Date());
      return {
        id: result.candidate.id,
        duplicate: result.duplicate
      };
    }
  };

  const app = createApp({
    config,
    tornClient: runtimeTornClient,
    userRepository,
    sessionRepository,
    candidateRepository,
    requestRepository,
    transactionRepository,
    logger
  });

  return {
    app,
    pool: runtimePool,
    repositories: {
      userRepository,
      sessionRepository,
      candidateRepository,
      requestRepository,
      transactionRepository
    }
  };
}

async function start() {
  const config = loadConfig(process.env);
  const runtime = createRuntime({ config, logger: true });
  const { app, pool } = runtime;

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

  return runtime;
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createRuntime,
  start
};
