const os = require('node:os');
const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createJobRepository } = require('./db/jobs');
const { createWorkerRunner } = require('./worker/runner');

const REGISTERED_JOB_TYPES = Object.freeze([
  'payment.verify',
  'revive.verify',
  'refund.verify',
  'subscription.scan',
  'sheets.mirror'
]);

function createPendingHandlers(types = REGISTERED_JOB_TYPES) {
  return Object.fromEntries(types.map((type) => [type, async () => {
    const error = new Error(`${type} handler is not implemented in Stage 1`);
    error.code = 'HANDLER_NOT_IMPLEMENTED';
    error.retryable = false;
    throw error;
  }]));
}

async function startWorker({
  env = process.env,
  handlers = createPendingHandlers(),
  workerId = `${os.hostname()}:${process.pid}`
} = {}) {
  const config = loadConfig(env);
  const pool = createPool(config.DATABASE_URL);
  const jobRepository = createJobRepository(pool);
  const runner = createWorkerRunner({
    jobRepository,
    handlers,
    workerId
  });

  const stop = () => runner.stop();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  try {
    await runner.run();
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await pool.end();
  }
}

if (require.main === module) {
  startWorker().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  REGISTERED_JOB_TYPES,
  createPendingHandlers,
  startWorker
};
