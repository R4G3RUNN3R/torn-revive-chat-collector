const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

function functionSlice(name, nextName) {
  const prefixes = [`async function ${name}`, `function ${name}`];
  const starts = prefixes.map(prefix => source.indexOf(prefix)).filter(index => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = nextName
    ? Math.min(...[`function ${nextName}`, `async function ${nextName}`].map(prefix => source.indexOf(prefix, start + 1)).filter(index => index >= 0))
    : -1;
  return start >= 0 ? source.slice(start, end > start ? end : undefined) : '';
}

function buildAcceptHarness({ acceptRequest, queue, requestId = 'req-1', gate = {}, refreshReviverQueue = null }) {
  const body = functionSlice('isValidTornProfileId', 'runTransactionAction');
  assert.ok(body.length > 0, 'isValidTornProfileId/tornProfileNavigationUrl/acceptMarketplaceRequest must be defined together');

  const navigations = [];
  const statuses = [];
  const failures = [];
  const state = {
    reviverQueue: queue,
    activeTransaction: null
  };
  const window = {
    location: {
      set href(value) { navigations.push(value); },
      get href() { return navigations.at(-1) || ''; }
    }
  };

  const acceptMarketplaceRequest = new Function(
    'state', 'window',
    'hasReviverSubscriptionAccess', 'hasRole', 'hasCredentialCapability', 'hasConfirmedReviveAbility',
    'runMutation', 'setStatus', 'renderAll', 'handleApiFailure', 'refreshReviverQueue',
    `${body}; return acceptMarketplaceRequest;`
  )(
    state, window,
    () => gate.subscription !== false,
    () => gate.role !== false,
    () => gate.credential !== false,
    () => gate.ability !== false,
    async (_key, operation) => operation(),
    (message, isError) => statuses.push({ message, isError: Boolean(isError) }),
    () => {},
    (error, operation, fallback) => failures.push({ error, operation, fallback }),
    refreshReviverQueue || (async () => {
      const removedId = String(requestId);
      state.reviverQueue = state.reviverQueue.filter(request => String(request.id) !== removedId);
    })
  );

  state.api = { acceptRequest };
  return { acceptMarketplaceRequest, state, navigations, statuses, failures };
}

test('accepting a request with a valid requester Torn ID navigates the same tab to their Torn profile only after acceptance succeeds', async () => {
  const queue = [{ id: 'req-1', requesterTornId: 4821001, requesterName: 'Player' }];
  const { acceptMarketplaceRequest, navigations, statuses } = buildAcceptHarness({
    acceptRequest: async () => ({ transaction: { id: 'tx-1' } }),
    queue
  });

  assert.deepEqual(navigations, [], 'must not navigate before accept resolves');
  await acceptMarketplaceRequest('req-1');
  assert.deepEqual(navigations, ['https://www.torn.com/profiles.php?XID=4821001']);
  assert.ok(statuses.some(entry => !entry.isError), 'a success status should be shown');
});

test('the target requester Torn ID is captured before acceptance can mutate the queue item', async () => {
  const queue = [{ id: 'req-1', requesterTornId: 998877, requesterName: 'Player' }];
  const { acceptMarketplaceRequest, navigations, state } = buildAcceptHarness({
    acceptRequest: async () => {
      queue.splice(0, queue.length);
      return { transaction: { id: 'tx-1' } };
    },
    queue
  });

  await acceptMarketplaceRequest('req-1');
  assert.deepEqual(state.reviverQueue, [], 'the queue may change as acceptance completes');
  assert.deepEqual(navigations, ['https://www.torn.com/profiles.php?XID=998877'], 'navigation must still use the captured id');
});

test('a successful accept redirects immediately without waiting for a queue refresh', async () => {
  const queue = [{ id: 'req-1', requesterTornId: 4821001, requesterName: 'Player' }];
  let refreshCalls = 0;
  const { acceptMarketplaceRequest, navigations } = buildAcceptHarness({
    acceptRequest: async () => ({ transaction: { id: 'tx-1' } }),
    queue,
    refreshReviverQueue: async () => {
      refreshCalls += 1;
      throw new Error('queue refresh should not block profile navigation');
    }
  });

  await acceptMarketplaceRequest('req-1');
  assert.deepEqual(navigations, ['https://www.torn.com/profiles.php?XID=4821001']);
  assert.equal(refreshCalls, 0, 'valid accepted requests should navigate immediately instead of refreshing a queue the browser is leaving');
});

test('a failed accept never navigates the tab', async () => {
  const queue = [{ id: 'req-1', requesterTornId: 4821001, requesterName: 'Player' }];
  const { acceptMarketplaceRequest, navigations, failures } = buildAcceptHarness({
    acceptRequest: async () => { throw new Error('accept failed'); },
    queue
  });

  await acceptMarketplaceRequest('req-1');
  assert.deepEqual(navigations, []);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].operation, 'reviver.accept');
});

test('a missing or invalid requester Torn ID never constructs a navigation URL, and shows a clear error instead', async () => {
  for (const badId of [undefined, null, '', 'not-a-number', 0, -5, 'javascript:alert(1)']) {
    const queue = [{ id: 'req-1', requesterTornId: badId, requesterName: 'Player' }];
    const { acceptMarketplaceRequest, navigations, statuses, state } = buildAcceptHarness({
      acceptRequest: async () => ({ transaction: { id: 'tx-1' } }),
      queue
    });

    await acceptMarketplaceRequest('req-1');
    assert.deepEqual(navigations, [], `must not navigate for requesterTornId=${JSON.stringify(badId)}`);
    assert.equal(state.activeTransaction?.id, 'tx-1', 'accept must still be recorded as successful');
    assert.ok(statuses.some(entry => entry.isError), 'an error status must be shown when navigation is skipped');
  }
});

test('acceptMarketplaceRequest still respects existing reviver eligibility gating before mutating anything', async () => {
  const queue = [{ id: 'req-1', requesterTornId: 4821001 }];
  const { acceptMarketplaceRequest, navigations, state } = buildAcceptHarness({
    acceptRequest: async () => ({ transaction: { id: 'tx-1' } }),
    queue,
    gate: { credential: false }
  });

  await acceptMarketplaceRequest('req-1');
  assert.deepEqual(navigations, []);
  assert.equal(state.activeTransaction, null);
});

test('ReviveRelay never performs the Torn revive action itself, only navigation', () => {
  const body = functionSlice('isValidTornProfileId', 'runTransactionAction');
  assert.doesNotMatch(body, /revive1\.php|reviveUser|action=revive/i);
  assert.match(body, /torn\.com\/profiles\.php\?XID=/);
});
