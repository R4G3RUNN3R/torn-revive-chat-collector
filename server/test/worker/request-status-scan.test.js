const test = require('node:test');
const assert = require('node:assert/strict');
const { TornApiError } = require('../../src/torn/client');
const {
  createRequestStatusScanHandler,
  REQUEST_STATUS_INTERVAL_MS,
  REQUEST_STATUS_TIME_BUDGET_MS,
  TORN_PROFILE_TIMEOUT_MS
} = require('../../src/worker/request-status-scan');

const NOW = new Date('2026-11-25T12:00:00Z');

function setup({ due, credentials = {}, profiles = {}, profileErrors = {}, clock = () => NOW, onProfile = () => {}, markUnusableError = null }) {
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
      async markUnusable(input) { unusable.push(input); if (markUnusableError) throw markUnusableError; }
    },
    tornClient: {
      async getUserProfile(key, options) {
        assert.deepEqual(options, { timeoutMs: TORN_PROFILE_TIMEOUT_MS });
        profileCalls.push(key);
        onProfile(key);
        if (profileErrors[key]) throw profileErrors[key];
        return profiles[key];
      }
    },
    clock
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

test('Torn profile reads use a 5 second timeout and the batch stops after a 15 second budget', async () => {
  assert.equal(TORN_PROFILE_TIMEOUT_MS, 5000);
  assert.equal(REQUEST_STATUS_TIME_BUDGET_MS, 15000);
  let elapsed = 0;
  const due = ['1', '2', '3', '4', '5'].map(n => ({ id: `req-${n}`, requesterId: `user-${n}` }));
  const credentials = Object.fromEntries(due.map((row, index) => [row.requesterId, `key-${index + 1}`]));
  const profiles = Object.fromEntries(Object.values(credentials).map(key => [key, { status: { state: 'Okay', until: 0, description: 'Okay' } }]));
  const s = setup({
    due,
    credentials,
    profiles,
    clock: () => new Date(NOW.getTime() + elapsed),
    onProfile: () => { elapsed += 6000; }
  });
  const result = await s.handler();
  assert.deepEqual(s.profileCalls, ['key-1', 'key-2', 'key-3']);
  assert.deepEqual(s.recorded.map(entry => entry.requestId), ['req-1', 'req-2', 'req-3']);
  assert.ok(s.recorded.every(entry => entry.checkedAt.getTime() === NOW.getTime()));
  assert.equal(result.checked, 3);
  assert.equal(result.refreshed, 3);
  assert.deepEqual(result.runAt, new Date(NOW.getTime() + REQUEST_STATUS_INTERVAL_MS));
});

test('a markUnusable failure does not abort the batch', async () => {
  const s = setup({
    due: [{ id: 'req-1', requesterId: 'user-1' }, { id: 'req-2', requesterId: 'user-2' }],
    credentials: { 'user-1': 'key-1', 'user-2': 'key-2' },
    profiles: { 'key-2': { status: { state: 'Okay', until: 0, description: 'Okay' } } },
    profileErrors: { 'key-1': new TornApiError('TORN_INVALID_KEY', 'Incorrect key') },
    markUnusableError: new Error('database unavailable')
  });
  const result = await s.handler();
  assert.deepEqual(s.unusable, [{ userId: 'user-1', reason: 'TORN_INVALID_KEY', now: NOW }]);
  assert.deepEqual(s.recorded.map(entry => [entry.requestId, entry.status === null]), [['req-1', true], ['req-2', false]]);
  assert.equal(result.checked, 2);
  assert.equal(result.refreshed, 1);
});
