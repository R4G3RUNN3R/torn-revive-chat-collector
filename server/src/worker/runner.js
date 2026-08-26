const { setTimeout: defaultSleep } = require('node:timers/promises');

function createWorkerRunner({
  workerId,
  jobRepository,
  handlers,
  sleep = defaultSleep,
  logger = console,
  claimLimit = 10,
  idleMs = 1000
}) {
  if (typeof workerId !== 'string' || !workerId.trim()) {
    throw new Error('workerId is required');
  }
  if (!jobRepository ||
      typeof jobRepository.claimDueJobs !== 'function' ||
      typeof jobRepository.completeJob !== 'function' ||
      typeof jobRepository.failJob !== 'function') {
    throw new Error('jobRepository is required');
  }

  const registry = handlers || {};
  let stopping = false;

  async function runOnce() {
    if (stopping) return 0;

    const jobs = await jobRepository.claimDueJobs({
      limit: claimLimit,
      workerId: workerId.trim(),
      now: new Date()
    });

    for (const job of jobs) {
      const handler = registry[job.type];
      if (typeof handler !== 'function') {
        const message = `Unknown job type: ${job.type}`;
        if (logger && typeof logger.error === 'function') {
          logger.error(message);
        }
        await jobRepository.failJob(job.id, message, { terminal: true });
        continue;
      }

      try {
        const outcome = await handler(job);
        if (outcome && outcome.status === 'reschedule') {
          if (typeof jobRepository.rescheduleJob !== 'function') {
            throw new Error('jobRepository.rescheduleJob is required for reschedule outcomes');
          }
          if (!(outcome.runAt instanceof Date) || Number.isNaN(outcome.runAt.getTime())) {
            throw new Error('Reschedule outcome requires a valid runAt date');
          }
          await jobRepository.rescheduleJob(job.id, { runAt: outcome.runAt, now: new Date() });
        } else {
          await jobRepository.completeJob(job.id);
        }
      } catch (error) {
        const message = String(error && error.message || error || 'Job handler failed');
        if (logger && typeof logger.error === 'function') {
          logger.error(`Job ${job.id} failed: ${message}`);
        }
        await jobRepository.failJob(job.id, message, { terminal: false });
      }
    }

    return jobs.length;
  }

  async function run() {
    while (!stopping) {
      const count = await runOnce();
      if (count === 0 && !stopping) {
        await sleep(idleMs);
      }
    }
  }

  function stop() {
    stopping = true;
  }

  return {
    run,
    runOnce,
    stop,
    get stopping() {
      return stopping;
    }
  };
}

module.exports = {
  createWorkerRunner
};
