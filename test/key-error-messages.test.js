const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMain, RUNTIME } = require('./helpers/main-harness');

// 1.0.3: precise Torn API key error messages in the legacy panel.

const SIGNED_IN = Object.freeze({
  reviverelay_session_token: 'token-1001',
  reviverelay_public_identity: { tornId: 1001, name: 'Player1001' }
});
const GENERIC = 'Your Torn API key does not have the permissions required by ReviveRelay. Replace it with a correctly configured Torn API key.';
const HINT = 'Create a new key with the button below — it pre-selects everything ReviveRelay needs.';

function panelClient(response) {
  const { createPanelApiClient } = require('../src/panel-api-client');
  return createPanelApiClient({
    baseUrl: 'https://reviverelay.example',
    getToken: () => 'token',
    request: async () => response,
    clientVersion: '1.0.3',
    releaseChannel: 'review'
  });
}

test('the panel client attaches the failed key bind\'s reason and missing capabilities to the error', async () => {
  const missing = { requester: ['incoming_revives'], reviver: ['outgoing_revives', 'money_outgoing', 'item_outgoing'] };
  const error = await panelClient({ status: 422, responseText: JSON.stringify({ error: 'VERIFICATION_CREDENTIAL_INSUFFICIENT', reason: 'MISSING_PERMISSIONS', missing }) })
    .bindVerificationCredential('k').then(() => null, failure => failure);
  assert.equal(error.code, 'VERIFICATION_CREDENTIAL_INSUFFICIENT');
  assert.deepEqual(error.keyError, { reason: 'MISSING_PERMISSIONS', missing });

  const bare = await panelClient({ status: 422, responseText: 'not json' }).bindVerificationCredential('k').then(() => null, failure => failure);
  assert.deepEqual(bare.keyError, { reason: undefined, missing: undefined });
});

function keyFailure(body) {
  return harness => ({ method, url }) => {
    const route = `${method} ${new URL(url).pathname.replace(/^\/review/, '')}`;
    if (route === 'POST /v1/verification-credential') return { __status: 422, error: 'VERIFICATION_CREDENTIAL_INSUFFICIENT', ...body };
    if (route === 'GET /v1/me') return { user: { tornId: 1001, name: 'Player1001' }, roles: ['requester'], runtime: RUNTIME, pro: { state: 'NONE' } };
    if (route === 'GET /v1/pro/status') return { pro: { state: 'NONE' }, runtime: RUNTIME };
    if (route === 'GET /v1/verification-credential') return { credential: harness.credential || null };
    return {};
  };
}

async function bindFailure(body) {
  const harness = loadMain({ store: { ...SIGNED_IN }, respond: keyFailure(body) });
  harness.run();
  await harness.clock.flush();
  harness.main.handlePillActivate();
  await harness.clock.flush();
  harness.document.getElementById('rr-verification-key').value = 'S3cretKeyValue123';
  await harness.main.bindVerificationKey();
  await harness.clock.flush();
  const status = harness.document.getElementById('rr-status');
  return { harness, status };
}

test('MISSING_PERMISSIONS lists the missing Torn checkboxes in plain words, deduplicated, via textContent', async () => {
  const { status } = await bindFailure({
    reason: 'MISSING_PERMISSIONS',
    missing: { requester: ['incoming_revives'], reviver: ['outgoing_revives', 'money_outgoing', 'item_outgoing'] }
  });
  assert.equal(status.textContent, `This key is missing: Revives, Log: Money outgoing, Log: Items outgoing. ${HINT}`);
  assert.equal(status.innerHTML, '');
  assert.doesNotMatch(status.textContent, /S3cretKeyValue123/);
});

test('every capability maps to its Torn checkbox name; unknown names are never shown', async () => {
  const { status } = await bindFailure({
    reason: 'MISSING_PERMISSIONS',
    missing: { requester: ['incoming_revives', 'hospital_status', 'constructor', '__proto__', '<b>x</b>', 7], reviver: ['outgoing_revives', 'money_incoming', 'item_incoming', 'money_outgoing', 'item_outgoing'] }
  });
  assert.equal(status.textContent, `This key is missing: Revives, Profile, Log: Money incoming, Log: Items incoming, Log: Money outgoing, Log: Items outgoing. ${HINT}`);
});

test('OWNER_MISMATCH names the signed-in Torn account', async () => {
  const { status } = await bindFailure({ reason: 'OWNER_MISMATCH' });
  assert.equal(status.textContent, 'This key belongs to a different Torn account. Create the key while logged in to Torn as Player1001.');
});

test('NO_SELECTION_INFO, UNSUPPORTED_KEY or no reason keep the generic text plus the create-key hint', async () => {
  for (const body of [{ reason: 'NO_SELECTION_INFO' }, { reason: 'UNSUPPORTED_KEY' }, {}, { reason: 'MISSING_PERMISSIONS', missing: { requester: ['<b>x</b>'] } }]) {
    const { status } = await bindFailure(body);
    assert.equal(status.textContent, `${GENERIC} ${HINT}`);
  }
});

test('the first-connect flow shows the same precise message', async () => {
  const harness = loadMain({ store: {}, respond: harness => {
    const inner = keyFailure({ reason: 'MISSING_PERMISSIONS', missing: { requester: [], reviver: ['money_incoming'] } })(harness);
    return input => (input.url.endsWith('/v1/auth/bind') ? { token: 'token-1001', user: { tornId: 1001, name: 'Player1001' } } : inner(input));
  } });
  harness.run();
  await harness.clock.flush();
  harness.main.handlePillActivate();
  await harness.clock.flush();
  harness.document.getElementById('rr-api-key').value = 'S3cretKeyValue123';
  await harness.main.connectIdentity();
  assert.equal(harness.document.getElementById('rr-status').textContent, `This key is missing: Log: Money incoming. ${HINT}`);
});

test('the create-key button stays in the Torn API key settings next to the message', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');
  const start = source.indexOf('function renderVerificationSettings()');
  const render = source.slice(start, source.indexOf('function renderProPanel()', start));
  assert.match(render, /<button id="rr-create-api-key" type="button">/);
});

test('"Reviver access: Not ready" lists the reviver capabilities a requester-only key still lacks', async () => {
  const harness = loadMain({ store: { ...SIGNED_IN }, respond: keyFailure({}) });
  harness.credential = {
    usable: true, capabilities: { requester: true, reviver: false },
    missing: { requester: [], reviver: ['money_outgoing', 'item_outgoing', 'not_a_capability<script>'] }
  };
  harness.run();
  await harness.clock.flush();
  harness.main.handlePillActivate();
  await harness.clock.flush();
  harness.main.state.verificationCredential = harness.credential;
  harness.main.state.settingsOpen = true;
  harness.main.renderSettingsDrawer();
  const markup = harness.document.getElementById('rr-settings-drawer-content').innerHTML;
  assert.match(markup, /<span>Reviver access<\/span><strong>Not ready — missing: Log: Money outgoing, Log: Items outgoing<\/strong>/);
  assert.doesNotMatch(markup, /not_a_capability|<script>/);

  harness.main.state.verificationCredential = { usable: true, capabilities: { requester: false, reviver: false }, missing: { requester: ['incoming_revives'], reviver: ['money_outgoing'] } };
  harness.main.renderSettingsDrawer();
  assert.match(harness.document.getElementById('rr-settings-drawer-content').innerHTML, /<span>Reviver access<\/span><strong>Not ready<\/strong>/);
});
