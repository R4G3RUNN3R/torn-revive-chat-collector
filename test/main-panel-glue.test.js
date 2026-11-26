const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./helpers/main-harness');

const SIGNED_IN = Object.freeze({
  reviverelay_session_token: 'token-1001',
  reviverelay_public_identity: { tornId: 1001, name: 'Player1001' },
  reviverelay_request_preset: { paymentMethod: 'cash', offerAmount: 500000, comment: null }
});

async function bootMain(options = {}) {
  const harness = loadMain({ store: { ...(options.signedIn === false ? {} : SIGNED_IN), ...(options.store || {}) }, ...options });
  harness.run();
  await harness.clock.flush();
  return harness;
}

async function openPanel(harness) {
  harness.main.handlePillActivate();
  await harness.clock.flush();
}

const SLOW_ROUTES = ['GET /v1/me', 'GET /v1/pro/status', 'GET /v1/reviver/eligibility'];
const slowCounts = harness => SLOW_ROUTES.map(route => harness.count(route));
const requesterMarkup = harness => harness.document.getElementById('rr-requester').innerHTML;

// ---- glue: pill → panel ------------------------------------------------------

test('panelTabForPill maps the pill sheet to the panel tab', async () => {
  const { main } = await bootMain();
  assert.equal(main.panelTabForPill({ sheet: 'reviver-pro' }), 'settings');
  assert.equal(main.panelTabForPill({ sheet: 'reviver-queue' }), 'reviver');
  assert.equal(main.panelTabForPill({ sheet: 'reviver-transaction' }), 'reviver');
  assert.equal(main.panelTabForPill({ sheet: 'requester-setup' }), 'request');
  assert.equal(main.panelTabForPill({ sheet: 'requester' }), 'request');
  assert.equal(main.panelTabForPill(null), 'request');
});

test('handlePillActivate creates the panel lazily, opens it on the pill tab, and toggles it closed', async () => {
  const harness = await bootMain();
  assert.equal(harness.main.panel, null);
  harness.view = { sheet: 'reviver-queue' };
  await openPanel(harness);
  assert.ok(harness.main.panel);
  assert.equal(harness.main.state.minimized, false);
  assert.equal(harness.main.panel.style.display, '');
  assert.equal(harness.main.state.panelTab, 'reviver');
  assert.deepEqual(harness.boot.calls.filter(call => call.startsWith('setPanelOpen')), ['setPanelOpen:true']);

  harness.main.handlePillActivate();
  assert.equal(harness.main.state.minimized, true);
  assert.equal(harness.main.panel.style.display, 'none');
  assert.deepEqual(harness.boot.calls.filter(call => call.startsWith('setPanelOpen')), ['setPanelOpen:true', 'setPanelOpen:false']);
});

test('requester-setup with a session opens Settings on the Torn API key section', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'requester-setup' };
  await openPanel(harness);
  assert.equal(harness.main.state.settingsOpen, true);
  assert.equal(harness.main.state.settingsSection, 'verification');
});

test('handlePillRender refreshes only while the panel is open and the stateVersion changed; otherwise live-only on tick', async () => {
  const harness = await bootMain();
  const { main } = harness;
  main.handlePillRender({ snapshot: { stateVersion: 'v1' } });
  await harness.clock.flush();
  assert.equal(harness.requests.length, 0, 'closed panel: no refresh');

  await openPanel(harness);
  const afterOpen = harness.requests.length;
  assert.ok(afterOpen > 0);
  main.handlePillRender({ snapshot: { stateVersion: 'v1' } });
  await harness.clock.flush();
  assert.equal(harness.requests.length, afterOpen, 'the version the panel opened on: no refresh');

  // A tick with an active transaction re-renders live sections without any request.
  main.state.activeTransaction = { id: 't1', state: 'WAITING_FOR_PAYMENT', participantRole: 'requester', paymentDeadline: new Date(harness.clock.now() + 90000).toISOString() };
  main.state.panelTab = 'request';
  harness.document.getElementById('rr-requester').innerHTML = '';
  main.handlePillRender({ snapshot: { stateVersion: 'v1' } });
  await harness.clock.flush();
  assert.equal(harness.requests.length, afterOpen);
  assert.match(requesterMarkup(harness), /1:30/);

  main.handlePillRender({ snapshot: { stateVersion: 'v2' } });
  await harness.clock.flush();
  assert.ok(harness.requests.length > afterOpen, 'a new version refreshes the open panel');
});

// ---- per-tab session -------------------------------------------------------

test('after another tab signs out, this tab\'s next panel action sends nothing and the panel shows signed out', async () => {
  const harness = await bootMain();
  await openPanel(harness);
  assert.equal(harness.main.connectionPill.textContent, 'CONNECTED');
  harness.main.state.activeRequest = { id: 'r1', state: 'OPEN' };
  harness.main.state.activeTransaction = { id: 't1', state: 'REVIVE_FAILED', participantRole: 'requester' };
  // Another tab disconnects: only shared storage changes.
  harness.store.reviverelay_session_token = '';
  harness.store.reviverelay_public_identity = null;
  const before = harness.requests.length;

  await harness.main.cancelActiveRequest();
  await harness.main.runTransactionAction('refund-request');
  await harness.main.requestRevive();
  harness.main.handlePillRender({ snapshot: { stateVersion: 'other' } });
  await harness.clock.flush();

  assert.equal(harness.requests.length, before);
  assert.equal(harness.main.state.sessionToken, '');
  assert.equal(harness.main.state.identity, null);
  assert.equal(harness.main.state.activeRequest, null);
  assert.equal(harness.main.connectionPill.textContent, 'OFFLINE');
  assert.match(requesterMarkup(harness), /Connect ReviveRelay/);
  // The other tab's sign-out is not this tab's to repeat: storage and the pill are left alone.
  assert.equal(harness.boot.calls.includes('resetSession'), false);
});

test('reopening the pill after another tab switched account shows the new account, never the old session', async () => {
  const harness = await bootMain();
  await openPanel(harness);
  harness.main.handlePillActivate();
  harness.store.reviverelay_session_token = 'token-2002';
  harness.store.reviverelay_public_identity = { tornId: 2002, name: 'Player2002' };
  const before = harness.requests.length;
  await openPanel(harness);
  const sent = harness.requests.slice(before);
  assert.ok(sent.length > 0);
  assert.ok(sent.every(request => request.headers.Authorization === 'Bearer token-2002'));
  assert.equal(harness.main.state.identity.tornId, 2002);
});

test('an account switch during an in-flight /me never writes the old user into the shared identity', async () => {
  const harness = await bootMain();
  let release;
  harness.pending = new Promise(resolve => { release = resolve; });
  harness.main.refreshMe().catch(() => {});
  await harness.clock.flush();
  // Another tab signs in as someone else while this tab's /me is in flight.
  harness.store.reviverelay_session_token = 'token-2002';
  harness.store.reviverelay_public_identity = { tornId: 2002, name: 'Player2002' };
  harness.pending = null;
  release();
  await harness.clock.flush();
  assert.deepEqual(harness.store.reviverelay_public_identity, { tornId: 2002, name: 'Player2002' });
});

// ---- refresh storm ---------------------------------------------------------

test('rapid stateVersion changes refresh Pro status, plans and eligibility at most once per 60 s', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'reviver-queue' };
  await openPanel(harness);
  assert.deepEqual(slowCounts(harness), [1, 1, 1]);
  for (let i = 0; i < 10; i += 1) {
    harness.main.handlePillRender({ snapshot: { stateVersion: `v${i}` } });
    await harness.clock.advance(5000);
  }
  assert.deepEqual(slowCounts(harness), [1, 1, 1]);
  assert.ok(harness.count('GET /v1/reviver/queue') >= 10, 'the visible Reviver tab still refreshes its queue');
  await harness.clock.advance(10000);
  harness.main.handlePillRender({ snapshot: { stateVersion: 'later' } });
  await harness.clock.flush();
  assert.deepEqual(slowCounts(harness), [2, 2, 2]);
});

test('the Request tab refreshes the request, not the reviver queue', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'requester' };
  await openPanel(harness);
  const queue = harness.count('GET /v1/reviver/queue');
  const requests = harness.count('GET /v1/requests/active');
  harness.main.handlePillRender({ snapshot: { stateVersion: 'next' } });
  await harness.clock.flush();
  assert.equal(harness.count('GET /v1/reviver/queue'), queue);
  assert.equal(harness.count('GET /v1/requests/active'), requests + 1);
});

test('a hidden tab makes no panel requests; it catches up once visible', async () => {
  const harness = await bootMain();
  await openPanel(harness);
  const before = harness.requests.length;
  harness.document.visibilityState = 'hidden';
  harness.document.hidden = true;
  for (let i = 0; i < 5; i += 1) harness.main.handlePillRender({ snapshot: { stateVersion: `hidden-${i}` } });
  await harness.clock.flush();
  assert.equal(harness.requests.length, before);
  harness.document.visibilityState = 'visible';
  harness.document.hidden = false;
  harness.main.handlePillRender({ snapshot: { stateVersion: 'hidden-4' } });
  await harness.clock.flush();
  assert.ok(harness.requests.length > before);
});

// ---- request button --------------------------------------------------------

test('"Request certified revive" shows only once the panel has loaded and there is no active request', async () => {
  const harness = await bootMain();
  harness.pending = new Promise(() => {});
  await openPanel(harness);
  // Opened from cache: compatible runtime not yet confirmed, request state unknown.
  harness.main.state.runtimeCompatibility = 'compatible';
  harness.main.renderAll();
  assert.doesNotMatch(requesterMarkup(harness), /rr-request-revive/);

  const loaded = await bootMain();
  await openPanel(loaded);
  assert.match(requesterMarkup(loaded), /id="rr-request-revive"/);

  const active = await bootMain();
  active.activeRequest = { id: 'r9', state: 'OPEN', paymentMethod: 'cash', offerAmount: 500000 };
  await openPanel(active);
  assert.doesNotMatch(requesterMarkup(active), /rr-request-revive/);

  const signedOut = await bootMain({ signedIn: false });
  await openPanel(signedOut);
  assert.doesNotMatch(requesterMarkup(signedOut), /rr-request-revive/);
});

// ---- failed init -----------------------------------------------------------

test('a failed init is reported and retried once on the next visible visibilitychange or pageshow', async () => {
  let attempts = 0;
  const harness = loadMain({
    store: { ...SIGNED_IN, reviverelay_client_diagnostics_enabled: true },
    initialize: async real => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('TORNPDA_STORAGE_TIMEOUT'), { code: 'TORNPDA_STORAGE_TIMEOUT' });
      return real.initialize();
    }
  });
  harness.run();
  await harness.clock.flush();
  assert.equal(attempts, 1);
  assert.equal(harness.boots.length, 0);
  assert.deepEqual(harness.telemetry.map(entry => entry.meta.operation), ['init']);
  assert.equal(harness.clock.pending(), 0, 'no retry timer');

  harness.setVisibility('hidden');
  await harness.clock.flush();
  assert.equal(attempts, 1, 'a hidden page does not retry');
  harness.setVisibility('visible');
  await harness.clock.flush();
  assert.equal(attempts, 2);
  assert.equal(harness.boots.length, 1);
  assert.deepEqual(harness.boot.calls, ['start']);

  harness.window.dispatch('pageshow', { persisted: true });
  harness.setVisibility('visible');
  await harness.clock.flush();
  assert.equal(attempts, 2, 'the retry runs once');
  assert.equal(harness.document.count('visibilitychange'), 0);
  assert.equal(harness.window.count('pageshow'), 0);
});

test('a Lite boot that throws is retried once on pageshow', async () => {
  const harness = loadMain({ store: { ...SIGNED_IN } });
  harness.bootThrows = true;
  harness.run();
  await harness.clock.flush();
  assert.equal(harness.boots.length, 1);
  harness.bootThrows = false;
  harness.window.dispatch('pageshow', { persisted: false });
  await harness.clock.flush();
  assert.equal(harness.boots.length, 2);
  assert.deepEqual(harness.boot.calls, ['start']);
  assert.equal(harness.window.count('error'), 1, 'global error hooks are installed once');
});
