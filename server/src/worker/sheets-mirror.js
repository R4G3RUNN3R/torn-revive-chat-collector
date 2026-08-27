const MIRROR_INTERVAL_MS = 15 * 60 * 1000;

function createSheetsMirrorHandler({ telemetryRepository, sheetsClient, telemetryReporter = null, clock = () => new Date() }) {
  if (!telemetryRepository || typeof telemetryRepository.listGroupsForMirror !== 'function' || typeof telemetryRepository.markMirrored !== 'function') {
    throw new Error('telemetryRepository is required');
  }
  if (!sheetsClient || typeof sheetsClient.syncGroups !== 'function') throw new Error('sheetsClient is required');
  if (typeof clock !== 'function') throw new Error('clock is required');

  return async function sheetsMirrorHandler() {
    const nowValue = clock();
    const now = nowValue instanceof Date ? new Date(nowValue) : new Date(nowValue);
    const runAt = new Date(now.getTime() + MIRROR_INTERVAL_MS);
    try {
      const groups = await telemetryRepository.listGroupsForMirror();
      if (!groups.length) return { status: 'reschedule', runAt };
      await sheetsClient.syncGroups(groups, now);
      await telemetryRepository.markMirrored(groups.map(group => group.id), now);
      return { status: 'reschedule', runAt };
    } catch (error) {
      if (telemetryReporter && typeof telemetryReporter.report === 'function') {
        try {
          await telemetryReporter.report(error, { component: 'worker', operation: 'sheets.mirror' });
        } catch (_) {}
      }
      return { status: 'reschedule', runAt };
    }
  };
}

module.exports = {
  MIRROR_INTERVAL_MS,
  createSheetsMirrorHandler
};
