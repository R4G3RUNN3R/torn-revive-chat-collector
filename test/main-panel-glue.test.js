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
  harness.main.state.activeTransaction = { id: 't1', state: 'FAILED_ATTEMPT_CHOICE', participantRole: 'requester' };
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

test('a failed init is reported and retried on the next visible visibilitychange or pageshow, until it starts', async () => {
  let attempts = 0;
  const harness = loadMain({
    store: { ...SIGNED_IN },
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
  assert.equal(harness.window.count('error'), 0, '1.0.1 sends no diagnostics, so it installs no global error hooks');
});

// ---- tab switch loads data ---------------------------------------------------

test('switching Reviver -> Request loads the active request and shows the request button', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'reviver-queue' };
  await openPanel(harness);
  assert.equal(harness.main.state.panelTab, 'reviver');
  assert.equal(harness.count('GET /v1/requests/active'), 0);
  assert.doesNotMatch(requesterMarkup(harness), /rr-request-revive/);
  harness.main.activatePanelTab('request');
  await harness.clock.flush();
  assert.equal(harness.count('GET /v1/requests/active'), 1);
  assert.match(requesterMarkup(harness), /id="rr-request-revive"/);
});

test('switching Request -> Reviver fetches the queue', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'requester' };
  await openPanel(harness);
  assert.equal(harness.count('GET /v1/reviver/queue'), 0);
  harness.main.activatePanelTab('reviver');
  await harness.clock.flush();
  assert.equal(harness.count('GET /v1/reviver/queue'), 1);
  assert.deepEqual(slowCounts(harness), [1, 1, 1], 'the 60 s throttle for slow data still holds');
});

// ---- stale-session guards ----------------------------------------------------

function switchAccountElsewhere(harness) {
  harness.store.reviverelay_session_token = 'token-2002';
  harness.store.reviverelay_public_identity = { tornId: 2002, name: 'Player2002' };
}

test('runTransactionAction on a stale session sends nothing', async () => {
  const harness = await bootMain();
  await openPanel(harness);
  harness.main.state.activeTransaction = { id: 't1', state: 'FAILED_ATTEMPT_CHOICE', participantRole: 'requester' };
  switchAccountElsewhere(harness);
  const before = harness.requests.length;
  await harness.main.runTransactionAction('check-payment');
  await harness.clock.flush();
  assert.equal(harness.requests.length, before);
});

test('the panel click handler on a stale session sends nothing', async () => {
  const harness = await bootMain();
  await openPanel(harness);
  switchAccountElsewhere(harness);
  const before = harness.requests.length;
  const target = { id: 'rr-refresh-queue', closest: () => null };
  harness.main.panel.listeners.get('click')({ target });
  await harness.clock.flush();
  assert.equal(harness.requests.length, before);
  assert.equal(harness.main.state.identity.tornId, 2002, 'the panel followed the shared session instead');
});

test('handlePillActivate on a stale session never renders the old account', async () => {
  const harness = await bootMain();
  await openPanel(harness);
  harness.main.handlePillActivate(); // close
  harness.main.state.activeRequest = { id: 'old', state: 'OPEN', paymentMethod: 'cash', offerAmount: 1 };
  switchAccountElsewhere(harness);
  harness.main.handlePillActivate();
  // Synchronously, before any await: the old session is already gone.
  assert.equal(harness.main.state.sessionToken, 'token-2002');
  assert.equal(harness.main.state.identity.tornId, 2002);
  assert.equal(harness.main.state.activeRequest, null);
  assert.doesNotMatch(requesterMarkup(harness), /Player1001/);
});

// ---- Pro / role changes reset the slow-refresh throttle ----------------------

test('a Pro or role change between renders lets the next refresh reload slow data inside 60 s', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'reviver-queue' };
  await openPanel(harness);
  const render = (stateVersion, pro, roles) => harness.main.handlePillRender({ snapshot: { stateVersion, pro, me: { roles } } });
  render('v1', { state: 'NONE' }, ['requester']);
  await harness.clock.flush();
  assert.deepEqual(slowCounts(harness), [1, 1, 1]);
  render('v2', { state: 'NONE' }, ['requester']);
  await harness.clock.flush();
  assert.deepEqual(slowCounts(harness), [1, 1, 1], 'no change: throttled');
  render('v3', { state: 'ACTIVE' }, ['requester']);
  await harness.clock.flush();
  assert.deepEqual(slowCounts(harness), [2, 2, 2], 'Pro change reloads');
  render('v4', { state: 'ACTIVE' }, ['requester', 'reviver']);
  await harness.clock.flush();
  assert.deepEqual(slowCounts(harness), [3, 3, 3], 'role change reloads');
});

test('a tab switch during an in-flight refresh loads the newly selected tab once afterwards', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'reviver-queue' };
  await openPanel(harness);
  let release;
  harness.pending = new Promise(resolve => { release = resolve; });
  // Slow data is throttled, so this Reviver refresh is held on its queue request, after the tab was read.
  harness.main.handlePillRender({ snapshot: { stateVersion: 'next' } });
  await harness.clock.flush();
  assert.equal(harness.main.state.panelTab, 'reviver');
  harness.main.activatePanelTab('request');
  harness.main.activatePanelTab('reviver');
  harness.main.activatePanelTab('request');
  harness.pending = null;
  release();
  await harness.clock.flush();
  assert.equal(harness.count('GET /v1/requests/active'), 1);
  assert.match(requesterMarkup(harness), /id="rr-request-revive"/);
});

// ---- transaction actions follow the server's states and roles ----------------

// server/src/routes/transactions.js: retry/refund requests are the requester's, the retry answer
// is the reviver's, and payment/refund checks are open to either participant in their states.
const TX_ACTIONS = [
  ['requester', 'WAITING_FOR_PAYMENT', ['check-payment']],
  ['requester', 'PAYMENT_RECONCILING', ['check-payment']],
  ['reviver', 'WAITING_FOR_PAYMENT', ['check-payment']],
  ['requester', 'WAITING_FOR_REVIVE', []],
  ['requester', 'FAILED_ATTEMPT_CHOICE', ['retry-request', 'refund-request']],
  ['reviver', 'FAILED_ATTEMPT_CHOICE', []],
  ['reviver', 'RETRY_OFFERED', ['retry-accept', 'retry-decline']],
  ['requester', 'RETRY_OFFERED', []],
  ['requester', 'REFUND_REQUIRED', ['check-refund']],
  ['reviver', 'REFUND_RECONCILING', ['check-refund']],
  ['requester', 'REFUNDED', []],
  ['requester', 'REPORTABLE_MISSING_REFUND', []],
  ['requester', 'COMPLETED', []]
];
const TX_CALLS = {
  'check-payment': ['POST /v1/transactions/tx-1/check-payment', undefined],
  'retry-request': ['POST /v1/transactions/tx-1/retry-request', undefined],
  'retry-accept': ['POST /v1/transactions/tx-1/retry-response', { decision: 'accept' }],
  'retry-decline': ['POST /v1/transactions/tx-1/retry-response', { decision: 'decline' }],
  'refund-request': ['POST /v1/transactions/tx-1/request-refund', undefined],
  'check-refund': ['POST /v1/transactions/tx-1/check-refund', undefined]
};

test('each transaction state and role renders the server\'s actions, and each click calls its API', async () => {
  for (const [role, txState, expected] of TX_ACTIONS) {
    const harness = await bootMain();
    await openPanel(harness);
    harness.main.state.activeTransaction = { id: 'tx-1', state: txState, participantRole: role };
    harness.main.renderAll();
    const rendered = [...requesterMarkup(harness).matchAll(/data-rr-tx-action="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(rendered, expected, `${role} ${txState}`);
    for (const action of rendered) {
      const before = harness.requests.length;
      const button = { dataset: { rrTxAction: action } };
      harness.main.panel.listeners.get('click')({ target: { closest: selector => (selector === '[data-rr-tx-action]' ? button : null) } });
      await harness.clock.flush();
      const sent = harness.requests[before];
      const [route, body] = TX_CALLS[action];
      assert.equal(`${sent.method} ${new URL(sent.url).pathname.replace(/^\/review/, '')}`, route, action);
      assert.deepEqual(sent.body, body, action);
      harness.main.state.activeTransaction = { id: 'tx-1', state: txState, participantRole: role };
    }
  }
});

// ---- the panel follows the pill's transaction ---------------------------------

const reviverMarkup = harness => harness.document.getElementById('rr-reviver-content').innerHTML;
const REVIVING = Object.freeze({ id: 'tx-7', state: 'WAITING_FOR_REVIVE', participantRole: 'reviver', requester: { tornId: 3003, name: 'Patient3003' } });

test('a fresh page whose pill shows a reviver transaction fetches and renders it when the pill opens', async () => {
  const harness = await bootMain();
  harness.transactions['tx-7'] = REVIVING;
  harness.view = { role: 'reviver', state: 'WAITING_FOR_REVIVE', transactionId: 'tx-7', sheet: 'reviver-revive-now' };
  await openPanel(harness);
  assert.equal(harness.count('GET /v1/transactions/tx-7'), 1);
  assert.equal(harness.main.state.activeTransaction.id, 'tx-7');
  assert.match(reviverMarkup(harness), /Accepted revive/);
  assert.match(reviverMarkup(harness), /Patient3003/);
  assert.doesNotMatch(reviverMarkup(harness), /No accepted revive transaction/);
});

test('a new transaction id from /v1/state reaches the open panel and is kept current without duplicate fetches', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'reviver-queue' };
  await openPanel(harness);
  assert.equal(harness.main.state.activeTransaction, null);
  harness.transactions['tx-7'] = REVIVING;
  harness.view = { role: 'reviver', state: 'WAITING_FOR_REVIVE', transactionId: 'tx-7', sheet: 'reviver-revive-now' };
  harness.main.handlePillRender({ snapshot: { stateVersion: 'accepted-elsewhere' } });
  await harness.clock.flush();
  assert.equal(harness.count('GET /v1/transactions/tx-7'), 1);
  assert.match(reviverMarkup(harness), /Patient3003/);
  harness.main.handlePillRender({ snapshot: { stateVersion: 'next' } });
  await harness.clock.flush();
  assert.equal(harness.count('GET /v1/transactions/tx-7'), 2, 'the reviver-side refresh keeps it current');
});

// ---- "Needs attention" explains itself ------------------------------------------

const statusLine = harness => harness.document.getElementById('rr-status').textContent;

test('opening the pill on a reportable transaction shows a one-line status saying what happened and whom to tell', async () => {
  const cases = [
    ['REPORTABLE_NO_ATTEMPT', 'requester', /no revive attempt was made/i],
    ['REPORTABLE_MISSING_REFUND', 'requester', /refund was not verified/i],
    ['REPORTABLE_NO_ATTEMPT', 'reviver', /no revive attempt was made/i]
  ];
  for (const [txState, role, what] of cases) {
    const harness = await bootMain();
    harness.view = { role, state: txState, transactionId: 'tx-9', sheet: `${role === 'reviver' ? 'reviver' : 'request'}-report` };
    await openPanel(harness);
    assert.match(statusLine(harness), what, txState);
    assert.match(statusLine(harness), /^Needs attention: .+ Report it to the ReviveRelay operator\.$/, txState);
    assert.equal(harness.document.getElementById('rr-status').innerHTML, '', 'written with textContent');
  }
  const idle = await bootMain();
  idle.view = { role: 'requester', state: null, transactionId: null, sheet: 'request' };
  await openPanel(idle);
  assert.doesNotMatch(statusLine(idle), /Needs attention/);
});

// ---- a failed init stays visible and retryable ----------------------------------

test('a failed init mounts a "tap to retry" pill; taps and every visible return retry until init starts', async () => {
  let attempts = 0;
  let failing = true;
  const harness = loadMain({
    store: { ...SIGNED_IN },
    initialize: async real => {
      attempts += 1;
      if (failing) throw new Error('TORNPDA_STORAGE_TIMEOUT');
      return real.initialize();
    }
  });
  harness.run();
  await harness.clock.flush();
  assert.equal(attempts, 1);
  assert.equal(harness.pills.length, 1, 'a retry pill is visible');
  const pill = harness.pills[0];
  const shown = pill.views[pill.views.length - 1];
  assert.equal(shown.text, 'ReviveRelay · tap to retry');
  assert.equal(shown.tone, 'attention');

  pill.options.onActivate();
  await harness.clock.flush();
  assert.equal(attempts, 2, 'a tap retries init');
  assert.equal(pill.destroyed, false, 'a second failure keeps the retry pill');
  assert.equal(harness.pills.filter(entry => !entry.destroyed).length, 1);

  harness.setVisibility('hidden');
  harness.setVisibility('visible');
  await harness.clock.flush();
  assert.equal(attempts, 3, 'every return to visible retries, not just the first');
  harness.window.dispatch('pageshow', { persisted: false });
  await harness.clock.flush();
  assert.equal(attempts, 4);
  assert.equal(harness.clock.pending(), 0, 'no timers');

  failing = false;
  pill.options.onActivate();
  await harness.clock.flush();
  assert.equal(attempts, 5);
  assert.equal(harness.boots.length, 1);
  assert.equal(pill.destroyed, true, 'the Lite pill replaces the retry pill');
  assert.equal(harness.document.count('visibilitychange'), 0);
  assert.equal(harness.window.count('pageshow'), 0);
  pill.options.onActivate();
  await harness.clock.flush();
  assert.equal(attempts, 5, 'a stale tap after the start does nothing');
});

// ---- Plan 3b: notification settings, update notice, invoice expiry, carry-over fixes ----

const plain = value => JSON.parse(JSON.stringify(value));
const changeEvent = target => ({ type: 'change', target: { dataset: {}, ...target } });

test('boot seeds the Lite notification settings once from the 0.7 desktop toggle, so the notifier honours it', async () => {
  const off = await bootMain({ store: { reviverelay_desktop_notifications_enabled: false } });
  assert.deepEqual(plain(off.store.reviverelay_notification_settings_v1), { enabled: false });
  const on = await bootMain();
  assert.deepEqual(plain(on.store.reviverelay_notification_settings_v1), { enabled: true });
  const kept = await bootMain({ store: { reviverelay_desktop_notifications_enabled: false, reviverelay_notification_settings_v1: { enabled: true, sound: false } } });
  assert.deepEqual(plain(kept.store.reviverelay_notification_settings_v1), { enabled: true, sound: false }, 'never overwrites saved settings');
});

test('Settings saves the Lite notification, per-type and badge settings', async () => {
  const harness = await bootMain({ store: { reviverelay_desktop_notifications_enabled: false } });
  harness.view = { sheet: 'request' };
  await openPanel(harness);
  const onChange = harness.main.panel.listeners.get('change');
  onChange(changeEvent({ type: 'checkbox', checked: false, dataset: { rrNotify: 'sound' } }));
  assert.deepEqual(plain(harness.store.reviverelay_notification_settings_v1), { enabled: false, sound: false });
  onChange(changeEvent({ type: 'checkbox', checked: true, dataset: { rrNotify: 'enabled' } }));
  onChange(changeEvent({ type: 'checkbox', checked: true, dataset: { rrNotify: 'type:newRequest' } }));
  onChange(changeEvent({ type: 'checkbox', checked: false, dataset: { rrNotify: 'type:accepted' } }));
  onChange(changeEvent({ type: 'select-one', value: '22', dataset: { rrNotify: 'quietFrom' } }));
  onChange(changeEvent({ type: 'select-one', value: '', dataset: { rrNotify: 'quietTo' } }));
  assert.deepEqual(plain(harness.store.reviverelay_notification_settings_v1), { enabled: true, sound: false, types: { newRequest: true, accepted: false }, quietFrom: 22, quietTo: null });
  onChange(changeEvent({ type: 'checkbox', checked: false, dataset: { rrBadges: '' } }));
  assert.equal(harness.store.reviverelay_badges_enabled, false);
});
test('a background update check announces a new version once, from the leader tab only', async () => {
  for (const leader of [true, false]) {
    const harness = loadMain({ store: { ...SIGNED_IN } });
    harness.leader = leader;
    harness.context.ReviveRelayUpdateManager = { createUpdateManager: () => ({ check: async () => ({ updateAvailable: true, latestVersion: '1.0.2' }), openUpdate: () => false }) };
    harness.run();
    await harness.clock.flush();
    assert.deepEqual(harness.boot.notifier.notes.map(([id]) => id), leader ? ['update:1.0.2'] : [], `leader=${leader}`);
    if (leader) assert.match(harness.boot.notifier.notes[0][1], /1\.0\.2 is available/);
  }
});

test('Minor 2: an update found by a non-leader tab is announced once when that tab becomes leader', async () => {
  const harness = loadMain({ store: { ...SIGNED_IN } });
  harness.leader = false;
  harness.context.ReviveRelayUpdateManager = { createUpdateManager: () => ({ check: async () => ({ updateAvailable: true, latestVersion: '1.0.2' }), openUpdate: () => false }) };
  harness.run();
  await harness.clock.flush();
  harness.main.handlePillRender({ snapshot: {} });
  assert.deepEqual(harness.boot.notifier.notes, [], 'never from a non-leader tab');
  harness.leader = true;
  harness.main.handlePillRender({ snapshot: {} });
  harness.main.handlePillRender({ snapshot: {} });
  assert.deepEqual(harness.boot.notifier.notes.map(([id]) => id), ['update:1.0.2']);
});

test('Minor 2: a throttled (skipped) check still lets the leader announce a known update', async () => {
  const harness = loadMain({ store: { ...SIGNED_IN } });
  harness.context.ReviveRelayUpdateManager = { createUpdateManager: () => ({ check: async () => ({ updateAvailable: true, latestVersion: '1.0.2', skipped: true }), openUpdate: () => false }) };
  harness.run();
  await harness.clock.flush();
  assert.deepEqual(harness.boot.notifier.notes.map(([id]) => id), ['update:1.0.2']);
});

test('account deletion clears the Lite notification and badge storage', async () => {
  const harness = await bootMain({ store: { ...SIGNED_IN, reviverelay_notified_events_v1: { ids: ['tx1:COMPLETED'] }, reviverelay_badge_cache_v1: [['42', {}]] } });
  harness.view = { sheet: 'request' };
  await openPanel(harness);
  await harness.main.deleteReviveRelayAccount();
  await harness.clock.flush();
  assert.equal(harness.count('POST /v1/account/delete'), 1);
  assert.equal(harness.store.reviverelay_notified_events_v1, null);
  assert.equal(harness.store.reviverelay_badge_cache_v1, null);
  assert.equal(harness.store.reviverelay_notification_settings_v1, null);
});

test('an open panel re-checks a PENDING invoice once when its expiry passes', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'reviver-pro' };
  await openPanel(harness);
  harness.main.state.currentInvoice = { id: 'inv-1', state: 'PENDING', expiresAt: new Date(harness.clock.now() - 1000).toISOString() };
  harness.main.handlePillRender({ snapshot: {} });
  await harness.clock.flush();
  harness.main.handlePillRender({ snapshot: {} });
  await harness.clock.flush();
  assert.equal(harness.count('GET /v1/pro/invoices/inv-1'), 1);
});

test('I-1: an open, visible panel keeps re-checking an expired PENDING invoice (throttled, bounded) until the server flips it', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'reviver-pro' };
  await openPanel(harness);
  // The server marks invoices EXPIRED only in its 60 s worker scan: it still answers PENDING for a while.
  harness.invoice = { id: 'inv-1', state: 'PENDING', expiresAt: new Date(harness.clock.now() - 1000).toISOString() };
  harness.main.state.currentInvoice = { ...harness.invoice };
  const tick = async seconds => {
    for (let i = 0; i < seconds; i += 1) {
      harness.main.handlePillRender({ snapshot: {} });
      await harness.clock.advance(1000);
    }
  };
  await tick(10);
  assert.equal(harness.count('GET /v1/pro/invoices/inv-1'), 1, 'throttled: one check in the first 10 s');
  await tick(50);
  const checks = harness.count('GET /v1/pro/invoices/inv-1');
  assert.ok(checks >= 3 && checks <= 4, `re-checks every 15-20 s while still PENDING (got ${checks})`);
  // Hidden tab or closed panel: no re-checks.
  harness.setVisibility('hidden');
  await tick(40);
  harness.setVisibility('visible');
  harness.main.setPanelOpen(false);
  await tick(40);
  assert.equal(harness.count('GET /v1/pro/invoices/inv-1'), checks, 'no re-check while hidden or closed');
  harness.main.setPanelOpen(true);
  harness.invoice = { ...harness.invoice, state: 'EXPIRED' };
  await tick(20);
  assert.equal(harness.main.state.currentInvoice.state, 'EXPIRED');
  const settled = harness.count('GET /v1/pro/invoices/inv-1');
  await tick(60);
  assert.equal(harness.count('GET /v1/pro/invoices/inv-1'), settled, 'stops once EXPIRED');
});

test('I-1: re-checks of a PENDING invoice give up about 3 minutes past expiry', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'reviver-pro' };
  await openPanel(harness);
  harness.invoice = { id: 'inv-2', state: 'PENDING', expiresAt: new Date(harness.clock.now() - 1000).toISOString() };
  harness.main.state.currentInvoice = { ...harness.invoice };
  for (let i = 0; i < 300; i += 1) {
    harness.main.handlePillRender({ snapshot: {} });
    await harness.clock.advance(1000);
  }
  const checks = harness.count('GET /v1/pro/invoices/inv-2');
  assert.ok(checks >= 9 && checks <= 13, `bounded re-checks (got ${checks})`);
  assert.equal(harness.main.state.currentInvoice.state, 'PENDING');
});

test('M2: a closed reviver transaction the pill no longer shows is dropped, not refetched', async () => {
  const harness = await bootMain();
  harness.view = { sheet: 'reviver-queue' };
  await openPanel(harness);
  harness.main.state.activeTransaction = { id: 'tx-7', participantRole: 'reviver', state: 'COMPLETED' };
  harness.main.handlePillRender({ snapshot: { stateVersion: 'queue-changed' } });
  await harness.clock.flush();
  assert.equal(harness.count('GET /v1/transactions/tx-7'), 0);
  assert.equal(harness.main.state.activeTransaction, null);
});

test('M4: reopening the pill on an idle state clears a stale "Needs attention" line', async () => {
  const harness = await bootMain();
  harness.view = { role: 'requester', state: 'REPORTABLE_NO_ATTEMPT', transactionId: 'tx-9', sheet: 'request-report' };
  await openPanel(harness);
  assert.match(statusLine(harness), /Needs attention/);
  harness.main.handlePillActivate();
  harness.view = { role: 'requester', state: null, transactionId: null, sheet: 'request' };
  await openPanel(harness);
  assert.doesNotMatch(statusLine(harness), /Needs attention/);
});

test('M5/M6: once the Lite boot runs, the retry path never mounts over it, and the engine pill replaces the retry pill', async () => {
  const harness = await bootMain();
  const before = harness.pills.length;
  harness.main.retryInitWhenShown();
  assert.equal(harness.pills.length, before, 'no retry pill over a live engine');
  assert.equal(harness.document.count('visibilitychange'), 0);
});

// ---- 1.0.1 smoke Bug 1: TornPDA toast styles before the panel is ever opened ----

test('Bug 1: the TornPDA toast styles are installed once at init, before the panel is ever opened', async () => {
  const harness = loadMain({ store: { ...SIGNED_IN } });
  const styles = [];
  harness.context.GM_addStyle = css => { styles.push(String(css)); return null; };
  harness.run();
  await harness.clock.flush();
  const toastStyles = () => styles.filter(css => css.includes('.rr-pda-toast-stack{position:fixed'));
  assert.equal(harness.main.panel, null, 'the panel has not been opened');
  assert.equal(toastStyles().length, 1, 'toast CSS is present before any toast can show');
  assert.match(toastStyles()[0], /\.rr-pda-toast\{position:relative/);
  await openPanel(harness);
  assert.ok(harness.main.panel);
  assert.equal(toastStyles().length, 1, 'opening the panel does not install the toast CSS again');
});
