const { createPool } = require('./db/pool');
const { createJobRepository, JOB_TYPES } = require('./db/jobs');
const { createWorkerRunner } = require('./worker/runner');

function buildStageOneHandlers() {
  return Object.fromEntries(JOB_TYPES.map(type => [
    type,
    async job => {
      throw new Error(`${job.type} handler is not implemented in Stage 1`);
    }
  ]));
}

async function start() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = createPool(connectionString);
  const jobRepository = createJobRepository(pool);
  const runner = createWorkerRunner({
    workerId: process.env.REVIVERELAY_WORKER_ID || `worker-${process.pid}`,
    jobRepository,
    handlers: buildStageOneHandlers(),
    logger: console
  });

  const requestStop = signal => {
    console.info(`ReviveRelay worker received ${signal}; finishing current work before exit.`);
    runner.stop();
  };

  process.once('SIGINT', () => requestStop('SIGINT'));
  process.once('SIGTERM', () => requestStop('SIGTERM'));

  try {
    await runner.run();
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  start().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildStageOneHandlers,
  start
};
