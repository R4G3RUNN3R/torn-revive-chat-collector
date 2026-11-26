const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiteBoot, RELAYOUT_DELAYS_MS } = require('../src/lite/boot');
const { HOST_ID } = require('../src/lite/pill-view');
const { createFakeTimers } = require('./helpers/fake-timers');
const { createFakeDocument, createFakeWindow } = require('./helpers/fake-dom');

const BASE_URL = 'https://reviverelay.voidsmithindustries.com/review';

function stateBody(overrides = {}) {
  return {
    stateVersion: '0123456789abcdef',
    nextPollMs: 60000,
    me: { tornId: 1001, name: 'Patient', roles: ['requester'], verification: { usable: true, requester: true, reviver: false } },
    pro: { state: 'NONE' },
    activeRequest: null,
    activeTransactions: [],
    recentlyClosed: [],
    revivers: { online: 4 },
    queue: null,
    ...overrides
  };
}

function fakePlatform({ status = 200, body = stateBody() } = {}) {
  const values = {};
  const requests = [];
  return {
    requests,
    values,
    runtime: { isTornPda: false },
    storage: {
      get: (key, fallback) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback),
      set: (key, value) => { values[key] = value; }
    },
    async request(input) {
      requests.push(input);
      return { status, body };
    }
  };
}

function setup({ platform = fakePlatform(), session = { signedIn: true, tornId: 1001 }, token = 'session-token' } = {}) {
  const clock = createFakeTimers();
  const document = createFakeDocument();
  const window = createFakeWindow();
  const activations = [];
  const renders = [];
  const boot = createLiteBoot({
    platform,
    window,
    document,
    baseUrl: BASE_URL,
    clientVersion: '1.0.0',
    releaseChannel: 'review',
    getToken: () => token,
    getSession: () => session,
    onActivate: () => activations.push(1),
    onRender: event => renders.push(event),
    clock,
    headerSelectors: ['#rr-test-header']
  });
  return { boot, clock, document, window, platform, activations, renders };
}

function addHeader(document) {
  const slot = document.createElement('div');
  slot.setAttribute('id', 'rr-test-header');
  slot.rect.width = 300;
  document.body.appendChild(slot);
  return slot;
}

test('start polls /v1/state through the platform transport with the session token and paints the pill', async () => {
  const { boot, clock, document, platform } = setup();
  boot.start();
  await clock.advance(0);
  assert.equal(platform.requests.length, 1);
  assert.equal(platform.requests[0].method, 'GET');
  assert.equal(platform.requests[0].url, `${BASE_URL}/v1/state`);
  assert.equal(platform.requests[0].headers.Authorization, 'Bearer session-token');
  assert.equal(platform.requests[0].headers['X-ReviveRelay-Version'], '1.0.0');
  assert.equal(boot.engine.viewModel().text, 'Revive me · 4 online');
  assert.ok(document.getElementById(HOST_ID));
  assert.ok(platform.values.reviverelay_state_snapshot_v1);
  boot.stop();
});

test('clicking the pill calls onActivate, and onRender sees each render', async () => {
  const { boot, clock, document, activations, renders } = setup();
  boot.start();
  await clock.advance(0);
  const host = document.getElementById(HOST_ID);
  host.attachedShadow.querySelector('.rr-pill').click();
  assert.equal(activations.length, 1);
  assert.equal(renders[renders.length - 1].view.text, 'Revive me · 4 online');
  boot.stop();
});

test('the pill moves into Torn\'s header when it renders after boot, without any interval', async () => {
  const { boot, clock, document } = setup();
  boot.start();
  const host = document.getElementById(HOST_ID);
  assert.equal(host.getAttribute('data-rr-placement'), 'launcher');
  addHeader(document);
  await clock.advance(RELAYOUT_DELAYS_MS[0]);
  assert.equal(host.getAttribute('data-rr-placement'), 'header');
  await clock.advance(RELAYOUT_DELAYS_MS[RELAYOUT_DELAYS_MS.length - 1]);
  boot.stop();
  assert.equal(clock.pending(), 0);
});

test('SPA navigation (popstate, hashchange) re-places the pill after Torn re-renders its header', async () => {
  const { boot, clock, document, window } = setup();
  const first = addHeader(document);
  boot.start();
  await clock.advance(5000);
  const host = document.getElementById(HOST_ID);
  assert.equal(host.parentNode, first);
  first.remove();
  const second = addHeader(document);
  window.dispatch('popstate');
  await clock.advance(RELAYOUT_DELAYS_MS[0]);
  assert.equal(host.parentNode, second);
  second.remove();
  const third = addHeader(document);
  window.dispatch('hashchange');
  await clock.advance(RELAYOUT_DELAYS_MS[0]);
  assert.equal(host.parentNode, third);
  boot.stop();
});

test('pagehide stops the engine; a BFCache pageshow restarts it with the same tab id', async () => {
  const { boot, clock, document, window, platform } = setup();
  const tabId = boot.tabId;
  boot.start();
  await clock.advance(0);
  window.dispatch('pagehide', { persisted: true });
  assert.equal(boot.engine.isStarted(), false);
  assert.equal(document.getElementById(HOST_ID), null);
  assert.equal(clock.pending(), 0);
  window.dispatch('pageshow', { persisted: false });
  assert.equal(boot.engine.isStarted(), false);
  window.dispatch('pageshow', { persisted: true });
  assert.equal(boot.engine.isStarted(), true);
  assert.ok(document.getElementById(HOST_ID));
  assert.equal(boot.tabId, tabId);
  await clock.advance(60000);
  assert.ok(platform.requests.length >= 2);
  boot.stop();
});

test('each boot gets its own tab id', () => {
  assert.notEqual(setup().boot.tabId, setup().boot.tabId);
});

test('start and stop are idempotent and stop removes every listener and timer', async () => {
  const { boot, clock, window, document } = setup();
  boot.start();
  boot.start();
  assert.equal(window.listenerCount('pagehide'), 1);
  assert.equal(document.listenerCount('visibilitychange'), 2, 'the engine and the badge re-scan');
  await clock.advance(0);
  boot.stop();
  boot.stop();
  for (const type of ['pagehide', 'pageshow', 'popstate', 'hashchange', 'flutterInAppWebViewPlatformReady', 'resize']) {
    assert.equal(window.listenerCount(type), 0, type);
  }
  assert.equal(document.listenerCount('visibilitychange'), 0);
  assert.equal(clock.pending(), 0);
});

test('setPanelOpen drives the 1 s tick and resetSession re-polls with a clean client', async () => {
  const { boot, clock, platform } = setup();
  boot.start();
  await clock.advance(5000);
  boot.setPanelOpen(true);
  await clock.advance(0);
  assert.equal(clock.nextDelay(), 1000);
  boot.setPanelOpen(false);
  boot.resetSession();
  await clock.advance(0);
  assert.equal(platform.requests.length, 2);
  assert.equal(platform.requests[1].headers['If-None-Match'], undefined);
  boot.stop();
});

test('a signed-out boot makes no request', async () => {
  const { boot, clock, platform } = setup({ session: { signedIn: false, tornId: null }, token: '' });
  boot.start();
  await clock.advance(120000);
  assert.equal(platform.requests.length, 0);
  assert.equal(boot.engine.viewModel().text, 'Set up revives');
  boot.stop();
});

test('a 401 from /v1/state renders "Sign in again" and stops polling', async () => {
  const { boot, clock, platform } = setup({ platform: fakePlatform({ status: 401, body: { error: 'AUTH_REQUIRED' } }) });
  boot.start();
  await clock.advance(0);
  assert.equal(boot.engine.viewModel().text, 'Sign in again');
  await clock.advance(600000);
  assert.equal(platform.requests.length, 1);
  boot.stop();
});

test('constructor validation', () => {
  assert.throws(() => createLiteBoot({}), /platform/);
  assert.throws(() => createLiteBoot({ platform: fakePlatform() }), /window/);
});


test('getSession from MAIN is used as given: a sign-out written to shared storage is seen on the next visibility change', async () => {
  const platform = fakePlatform();
  platform.values.token = 'session-token';
  platform.values.tornId = 1001;
  let calls = 0;
  const getSession = () => {
    calls += 1;
    return { signedIn: Boolean(platform.storage.get('token', '')), tornId: platform.storage.get('tornId', null) };
  };
  const clock = createFakeTimers();
  const document = createFakeDocument();
  const window = createFakeWindow();
  const boot = createLiteBoot({
    platform, window, document, baseUrl: BASE_URL, getToken: () => platform.storage.get('token', ''), getSession, clock, headerSelectors: ['#rr-test-header']
  });
  boot.start();
  await clock.advance(0);
  assert.equal(boot.engine.viewModel().text, 'Revive me · 4 online');
  const before = calls;
  platform.values.token = '';
  platform.values.tornId = null;
  document.setVisibility('visible');
  assert.ok(calls > before);
  assert.equal(boot.engine.viewModel().text, 'Set up revives');
  boot.stop();
});

function profilePage(platform) {
  const stateRequest = platform.request;
  platform.request = async input => (input.url.endsWith('/badge')
    ? (platform.requests.push(input), { status: 200, body: { tornId: 42, requesterVerified: true, reviverVerified: false } })
    : stateRequest(input));
}

function profileTitle(document) {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('class', 'content-title');
  wrapper.appendChild(document.createElement('h4'));
  document.body.appendChild(wrapper);
  return wrapper;
}

const badgeRequests = platform => platform.requests.filter(request => request.url.endsWith('/v1/players/42/badge')).length;

test('profile badges are scanned on the relayout timers, not on an interval', async () => {
  const platform = fakePlatform();
  profilePage(platform);
  const { boot, clock, document, window } = setup({ platform });
  window.location = { href: 'https://www.torn.com/profiles.php?XID=42' };
  const wrapper = profileTitle(document);
  boot.start();
  await clock.advance(3000);
  assert.equal(badgeRequests(platform), 1, 'three scans, one request (then cached)');
  assert.equal(wrapper.querySelectorAll('[data-rr-badge]').length, 1);
  boot.stop();
});

test('a profile opened in a background tab gets its badge once the tab becomes visible', async () => {
  const platform = fakePlatform();
  profilePage(platform);
  const { boot, clock, document, window } = setup({ platform });
  window.location = { href: 'https://www.torn.com/profiles.php?XID=42' };
  const wrapper = profileTitle(document);
  document.visibilityState = 'hidden';
  boot.start();
  await clock.advance(3000);
  assert.equal(badgeRequests(platform), 0, 'hidden: no lookup');
  document.setVisibility('visible');
  await clock.advance(0);
  assert.equal(badgeRequests(platform), 1);
  assert.equal(wrapper.querySelectorAll('[data-rr-badge]').length, 1);
  boot.stop();
});

test('a signed-out boot never looks up a badge', async () => {
  const platform = fakePlatform();
  profilePage(platform);
  const { boot, clock, document, window } = setup({ platform, session: { signedIn: false, tornId: null }, token: '' });
  window.location = { href: 'https://www.torn.com/profiles.php?XID=42' };
  profileTitle(document);
  boot.start();
  await clock.advance(3000);
  document.setVisibility('hidden');
  document.setVisibility('visible');
  await clock.advance(0);
  assert.equal(badgeRequests(platform), 0);
  boot.stop();
});
