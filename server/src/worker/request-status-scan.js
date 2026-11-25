const { TornApiError } = require('../torn/client');
const { deriveRequesterStatus } = require('../torn/requester-status');

const REQUEST_STATUS_INTERVAL_MS = 60 * 1000;
const REQUEST_STATUS_BATCH = 25;
const TORN_PROFILE_TIMEOUT_MS = 5000;
const REQUEST_STATUS_TIME_BUDGET_MS = 15000;

function createRequestStatusScanHandler({ requestRepository, verificationCredentialRepository, tornClient, clock = () => new Date() }) {
  if (!requestRepository ||
      typeof requestRepository.listRequestsNeedingStatus !== 'function' ||
      typeof requestRepository.recordRequesterStatus !== 'function') {
    throw new Error('requestRepository status methods are required');
  }
  if (!verificationCredentialRepository || typeof verificationCredentialRepository.getDecryptedActiveForUser !== 'function') {
    throw new Error('verificationCredentialRepository is required');
  }
  if (!tornClient || typeof tornClient.getUserProfile !== 'function') throw new Error('tornClient.getUserProfile is required');

  return async function requestStatusScanHandler() {
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('clock returned an invalid date');

    const due = await requestRepository.listRequestsNeedingStatus({ now, limit: REQUEST_STATUS_BATCH });
    let checked = 0;
    let refreshed = 0;
    for (const row of due) {
      const elapsed = clock().getTime() - now.getTime();
      if (!(elapsed < REQUEST_STATUS_TIME_BUDGET_MS)) break;

      let status = null;
      try {
        const credential = await verificationCredentialRepository.getDecryptedActiveForUser(row.requesterId);
        if (credential) {
          status = deriveRequesterStatus(await tornClient.getUserProfile(credential.plaintextKey, { timeoutMs: TORN_PROFILE_TIMEOUT_MS }));
          refreshed += 1;
        }
      } catch (error) {
        if (error instanceof TornApiError && error.code === 'TORN_INVALID_KEY' &&
            typeof verificationCredentialRepository.markUnusable === 'function') {
          try {
            await verificationCredentialRepository.markUnusable({ userId: row.requesterId, reason: 'TORN_INVALID_KEY', now });
          } catch (_) {
            // Marking the key unusable is retried on the next read; keep scanning the batch.
          }
        }
      }
      await requestRepository.recordRequesterStatus({ requestId: row.id, status, checkedAt: now });
      checked += 1;
    }

    return {
      status: 'reschedule',
      runAt: new Date(now.getTime() + REQUEST_STATUS_INTERVAL_MS),
      checked,
      refreshed
    };
  };
}

module.exports = {
  REQUEST_STATUS_INTERVAL_MS,
  REQUEST_STATUS_BATCH,
  TORN_PROFILE_TIMEOUT_MS,
  REQUEST_STATUS_TIME_BUDGET_MS,
  createRequestStatusScanHandler
};
