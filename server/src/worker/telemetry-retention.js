const RETENTION_DAYS = 30;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

function createTelemetryRetentionHandler({ telemetryRepository, clock = () => new Date() }) {
  if (!telemetryRepository || typeof telemetryRepository.purgeOccurrences !== 'function') {
    throw new Error('telemetryRepository is required');
  }
  if (typeof clock !== 'function') throw new Error('clock is required');

  return async function telemetryRetentionHandler() {
    const rawNow = clock();
    const now = rawNow instanceof Date ? new Date(rawNow) : new Date(rawNow);
    if (!Number.isFinite(now.getTime())) throw new Error('clock returned an invalid date');
    const before = new Date(now.getTime() - RETENTION_DAYS * RETENTION_INTERVAL_MS);
    const deletedOccurrences = await telemetryRepository.purgeOccurrences(before);
    return {
      status: 'reschedule',
      runAt: new Date(now.getTime() + RETENTION_INTERVAL_MS),
      deletedOccurrences
    };
  };
}

module.exports = {
  RETENTION_DAYS,
  RETENTION_INTERVAL_MS,
  createTelemetryRetentionHandler
};
