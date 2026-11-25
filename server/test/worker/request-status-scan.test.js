const test = require('node:test');
const assert = require('node:assert/strict');
const { TornApiError } = require('../../src/torn/client');
const { createRequestStatusScanHandler, REQUEST_STATUS_INTERVAL_MS } = require('../../src/worker/request-status-scan');

const NOW = new Date('2026-11-25T12:00:00Z');

function setup({ due, credentials = {}, profiles = {}, profileErrors = {} }) {
  const recorded = [];
  const unusable = [];
  const profileCalls = [];
  const handler = createRequestStatusScanHandler({
    requestRepository: {
      async listRequestsNeedingStatus(input) { assert.deepEqual(input, { now: NOW, limit: 25 }); return due; },
      async recordRequesterStatus(input) { recorded.push(input); return true; }
    },
    verificationCredentialRepository: {
      async getDecryptedActiveForUser(userId) { return credentials[userId] ? { plaintextKey: credentials[userId] } : null; },
      async markUnusable(input) { unusable.push(input); }
    },
    tornClient: {
      async getUserProfile(key) {
        profileCalls.push(key);
        if (profileErrors[key]) throw profileErrors[key];
        return profiles[key];
      }
    },
    clock: () => NOW
  });
  return { handler, recorded, unusable, profileCalls };
}

test('refreshes status with the requester key and reschedules in one minute', async () => {
  const s = setup({
    due: [{ id: 'req-1', requesterId: 'user-1' }],
    credentials: { 'user-1': 'key-1' },
    profiles: { 'key-1': { status: { state: 'Hospital', until: 1795612800, description: 'In a Mexican hospital for 1 hr' } } }
  });
  const result = await s.handler();
  assert.deepEqual(s.profileCalls, ['key-1']);
  assert.deepEqual(s.recorded, [{ requestId: 'req-1', status: { hospitalUntil: new Date(1795612800 * 1000), abroad: true }, checkedAt: NOW }]);
  assert.deepEqual(result, { status: 'reschedule', runAt: new Date(NOW.getTime() + REQUEST_STATUS_INTERVAL_MS), checked: 1, refreshed: 1 });
});

test('missing credential or Torn failure only marks the request checked', async () => {
  const s = setup({
    due: [{ id: 'req-1', requesterId: 'user-1' }, { id: 'req-2', requesterId: 'user-2' }],
    credentials: { 'user-2': 'key-2' },
    profileErrors: { 'key-2': new Error('network') }
  });
  const result = await s.handler();
  assert.deepEqual(s.recorded, [
    { requestId: 'req-1', status: null, checkedAt: NOW },
    { requestId: 'req-2', status: null, checkedAt: NOW }
  ]);
  assert.equal(result.refreshed, 0);
  assert.deepEqual(s.unusable, []);
});

test('an invalid Torn key marks the credential unusable', async () => {
  const s = setup({
    due: [{ id: 'req-1', requesterId: 'user-1' }],
    credentials: { 'user-1': 'key-1' },
    profileErrors: { 'key-1': new TornApiError('TORN_INVALID_KEY', 'Incorrect key') }
  });
  await s.handler();
  assert.deepEqual(s.unusable, [{ userId: 'user-1', reason: 'TORN_INVALID_KEY', now: NOW }]);
  assert.deepEqual(s.recorded, [{ requestId: 'req-1', status: null, checkedAt: NOW }]);
});
