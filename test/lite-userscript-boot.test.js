const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createFakeDocument, createFakeWindow } = require('./helpers/fake-dom');

const version = require('../package.json').version;
const bundle = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'review', `ReviveRelay-${version}.user.js`), 'utf8');

function stateBody(tornId) {
  return {
    stateVersion: '0123456789abcdef',
    nextPollMs: 60000,
    serverTime: new Date().toISOString(),
    me: { tornId, name: 'Patient', roles: ['requester'], verification: { usable: true, requester: true, reviver: false } },
    pro: { state: 'NONE' },
    activeRequest: null,
    activeTransactions: [],
    recentlyClosed: [],
    revivers: { online: 3 },
    queue: null
  };
}

// Runs the real built userscript against fake GM, DOM and timers (no browser).
function bootUserscript({ values = {}, stateStatus = 200 } = {}) {
  const clock = createFakeTimers();
  const document = createFakeDocument();
  const window = createFakeWindow();
  const requests = [];
  const intervals = [];
  const store = { ...values };
  const context = vm.createContext({
    window,
    document,
    console: { log() {}, warn() {}, error() {} },
    URL,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: (...args) => { intervals.push(args); return 0; },
    clearInterval: () => {},
    GM_getValue: (key, fallback) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback),
    GM_setValue: (key, value) => { store[key] = value; },
    GM_addStyle: () => null,
    GM_notification: () => {},
    GM_xmlhttpRequest: details => {
      requests.push(details);
      const isState = details.url.endsWith('/v1/state');
      const status = isState ? stateStatus : 404;
      const body = isState && status === 200 ? stateBody(1001) : { error: status === 401 ? 'AUTH_REQUIRED' : 'NOT_FOUND' };
      Promise.resolve().then(() => details.onload({ status, responseText: JSON.stringify(body) }));
      return { abort() {} };
    }
  });
  vm.runInContext(bundle, context, { filename: `ReviveRelay-${version}.user.js` });
  return { clock, document, window, requests, intervals, store };
}

const pillHost = document => document.getElementById('reviverelay-lite-root');
const pillLabel = document => pillHost(document).attachedShadow.querySelector('.rr-label').textContent;

test('the built 1.0 userscript boots to the header pill from /v1/state with no setInterval and no panel', async () => {
  const { clock, document, requests, intervals, store } = bootUserscript({
    values: { reviverelay_session_token: 'session-token', reviverelay_public_identity: { tornId: 1001, name: 'Patient' } }
  });
  await clock.advance(0);
  assert.equal(intervals.length, 0);
  const state = requests.filter(request => request.url.endsWith('/v1/state'));
  assert.equal(state.length, 1);
  assert.equal(state[0].url, 'https://reviverelay.voidsmithindustries.com/review/v1/state');
  assert.equal(state[0].headers.Authorization, 'Bearer session-token');
  assert.equal(state[0].headers['X-ReviveRelay-Version'], version);
  assert.equal(pillLabel(document), 'Revive me');
  assert.equal(document.getElementById('rr-panel'), null);
  assert.equal(store.reviverelay_state_snapshot_v1.data.me.tornId, 1001);
  // Only /v1/state and the boot-time update check reach the network.
  assert.deepEqual([...new Set(requests.map(request => new URL(request.url).pathname.split('/').pop()))].sort(), ['ReviveRelay.meta.js', 'state']);
});

test('without a session the built userscript paints "Set up revives" and makes no /v1/state request', async () => {
  const { clock, document, requests } = bootUserscript();
  await clock.advance(120000);
  assert.equal(pillLabel(document), 'Set up revives');
  assert.equal(requests.filter(request => request.url.endsWith('/v1/state')).length, 0);
});

test('an expired session renders "Sign in again" and stops polling', async () => {
  const { clock, document, requests } = bootUserscript({
    stateStatus: 401,
    values: { reviverelay_session_token: 'stale', reviverelay_public_identity: { tornId: 1001, name: 'Patient' } }
  });
  await clock.advance(0);
  assert.equal(pillLabel(document), 'Sign in again');
  await clock.advance(600000);
  assert.equal(requests.filter(request => request.url.endsWith('/v1/state')).length, 1);
});

test('a cached snapshot of another Torn user is never painted', async () => {
  const other = { stateVersion: 'ffffffffffffffff', fetchedAt: Date.now(), data: { ...stateBody(2002), revivers: { online: 9 } } };
  const { clock, document, store } = bootUserscript({
    values: { reviverelay_session_token: 'token', reviverelay_public_identity: { tornId: 1001, name: 'Patient' }, reviverelay_state_snapshot_v1: other }
  });
  await clock.flush();
  assert.equal(pillLabel(document), 'ReviveRelay');
  assert.equal(store.reviverelay_state_snapshot_v1, null);
  await clock.advance(0);
  assert.equal(pillLabel(document), 'Revive me');
});

test('the engine reads the session from shared storage: another tab signing in or out is seen', async () => {
  const { clock, document, requests, store } = bootUserscript({
    values: { reviverelay_session_token: 'session-token', reviverelay_public_identity: { tornId: 1001, name: 'Patient' } }
  });
  await clock.advance(0);
  assert.equal(pillLabel(document), 'Revive me');
  const stateRequests = () => requests.filter(request => request.url.endsWith('/v1/state'));

  // Another tab signs in as a different Torn user (direct storage writes, no call into this
  // tab's MAIN): on returning to this tab the engine re-reads the session and polls with the new token.
  store.reviverelay_session_token = 'other-token';
  store.reviverelay_public_identity = { tornId: 2002, name: 'Other' };
  document.setVisibility('hidden');
  document.setVisibility('visible');
  await clock.advance(0);
  assert.equal(stateRequests().length, 2);
  assert.equal(stateRequests()[1].headers.Authorization, 'Bearer other-token');

  // Another tab signs out (direct storage write, no call into this tab's MAIN).
  store.reviverelay_session_token = '';
  store.reviverelay_public_identity = null;
  document.setVisibility('hidden');
  document.setVisibility('visible');
  await clock.advance(0);
  assert.equal(pillLabel(document), 'Set up revives');
  await clock.advance(600000);
  assert.equal(stateRequests().length, 2);
});
