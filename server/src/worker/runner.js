function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWorkerRunner({
  jobRepository,
  workerId,
  handlers,
  sleep = defaultSleep,
  now = () => new Date(),
  claimLimit = 10
}) {
  if (!jobRepository || typeof jobRepository.claimDueJobs !== 'function') {
    throw new TypeError('Job repository is required');
  }
  if (typeof workerId !== 'string' || !workerId.trim()) {
    throw new TypeError('workerId is required');
  }
  if (!handlers || typeof handlers !== 'object') {
    throw new TypeError('handlers map is required');
  }

  let stopped = false;

  async function runOnce() {
    const jobs = await jobRepository.claimDueJobs({
      limit: claimLimit,
      workerId
    });

    for (const job of jobs) {
      const handler = handlers[job.type];
      if (typeof handler !== 'function') {
        await jobRepository.markFailed(
          job.id,
          workerId,
          `Unknown job type: ${job.type}`,
          null
        );
        continue;
      }

      try {
        await handler(job);
        await jobRepository.markComplete(job.id, workerId);
      } catch (error) {
        const message = error && error.message ? error.message : 'Job handler failed';
        const retryAt = error && error.retryable === false
          ? null
          : new Date(now().getTime() + 30_000);
        await jobRepository.markFailed(job.id, workerId, message, retryAt);
      }
    }

    return jobs.length;
  }

  async function run() {
    while (!stopped) {
      const count = await runOnce();
      if (count === 0 && !stopped) {
        await sleep(1000);
      }
    }
  }

  function stop() {
    stopped = true;
  }

  return {
    runOnce,
    run,
    stop
  };
}

module.exports = {
  createWorkerRunner
};
