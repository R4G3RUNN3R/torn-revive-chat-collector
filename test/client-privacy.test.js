const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolvePublicChat,
  acceptsPublicChat
} = require('../src/client-chat-policy');

function makeChat({ id = '', attrs = {} } = {}) {
  return {
    id,
    getAttribute(name) {
      return attrs[name] || null;
    }
  };
}

test('client chat policy positively resolves only supported public channel ids', () => {
  const global = resolvePublicChat(makeChat({ id: 'public_global' }));
  assert.equal(global?.id, 'public_global');
  assert.equal(global?.type, 'global');

  assert.equal(acceptsPublicChat(makeChat({ id: 'public_trade' })), true);
  assert.equal(acceptsPublicChat(makeChat({ id: 'public_hospital' })), true);
  assert.equal(acceptsPublicChat(makeChat({ id: 'faction-123' })), false);
  assert.equal(acceptsPublicChat(makeChat({ id: 'company-123' })), false);
  assert.equal(acceptsPublicChat(makeChat({ id: 'private-123' })), false);
  assert.equal(acceptsPublicChat(makeChat({ id: 'public_totally_unknown' })), false);
});

test('explicit non-public id cannot be overridden by a public-looking display name', () => {
  const privateChat = makeChat({ id: 'private-123' });
  assert.equal(resolvePublicChat(privateChat, { getName: () => 'Global' }), null);
});

test('legacy id-less chat may resolve only from an exact allowlisted public name', () => {
  const idlessChat = makeChat();
  assert.equal(resolvePublicChat(idlessChat, { getName: () => 'Hospital' })?.id, 'public_hospital');
  assert.equal(resolvePublicChat(idlessChat, { getName: () => 'Faction' }), null);
  assert.equal(resolvePublicChat(idlessChat, { getName: () => 'Mystery Room' }), null);
});

test('production main runtime never imports or invokes chat discovery/classification modules', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');
  for (const token of [
    'TornReviveChatDom',
    'TornRevivePublicChannels',
    'TornReviveClientChatPolicy',
    'ReviveRelayCandidatePipeline',
    'discoverChats(',
    'handlePublicMessage(',
    '/v1/candidates'
  ]) assert.equal(source.includes(token), false, token);
});

test('production source uses direct API/sidebar modules without wildcard network permission', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');
  assert.match(source, /ReviveRelayDirectApiClient/);
  assert.doesNotMatch(source, /ReviveRelayApiClient/);
  assert.match(source, /ReviveRelayRequestPreset/);
  assert.match(source, /ReviveRelaySidebarAction/);
  assert.doesNotMatch(source, /ReviveRelayProClient|createProClient|state\.proApi/);
  assert.doesNotMatch(source, /@connect\s+\*/);
});

test('update manifests fail closed on off-origin release URLs', () => {
  const { validateManifest } = require('../src/update-manager');
  const manifest = {
    latestVersion: '0.6.6',
    minimumVersion: '0.6.5',
    buildTimestamp: '2026-09-11T18:20:00.000Z',
    releaseNotes: 'Security hardening.',
    gitCommit: 'a'.repeat(40),
    releaseChannel: 'review',
    sha256: 'b'.repeat(64),
    apiCompatibility: { minimum: 1, current: 1 },
    install: {
      installUrl: 'https://evil.example/releases/review/0.6.6/ReviveRelay-0.6.6.user.js',
      metaUrl: 'https://evil.example/releases/review/0.6.6/ReviveRelay-0.6.6.meta.js'
    },
    mandatory: false
  };
  assert.throws(() => validateManifest(manifest, 'review'), /Invalid manifest/);
});

test('review client pins its API origin and contains no server-only credential material', () => {
  const pkg = require('../package.json');
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');
  const artifact = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'review', `ReviveRelay-${pkg.version}.user.js`), 'utf8');
  for (const text of [source, artifact]) {
    assert.match(text, /const API_BASE = 'https:\/\/reviverelay\.voidsmithindustries\.com\/review'/);
    assert.doesNotMatch(text, /PRO_RECEIVER_API_KEY|ADMIN_API_TOKEN|SHEETS_MIRROR_TOKEN|x-reviverelay-admin-token/i);
  }
});

test('one-time identity bootstrap key is cleared and never persisted client-side', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');
  const start = source.indexOf('async function connectIdentity()');
  const end = source.indexOf('async function restoreSession()', start);
  const connect = start >= 0 && end > start ? source.slice(start, end) : '';
  assert.ok(connect.length > 0);
  assert.match(connect, /state\.api\.bind\(apiKey/);
  assert.match(connect, /apiKeyInput\.value\s*=\s*''/);
  assert.match(connect, /GM_setValue\(KEYS\.sessionToken/);
  assert.doesNotMatch(connect, /GM_setValue\([^\n]*(?:apiKey|api_key|identityKey|identity_key)/i);
});

test('client telemetry sanitizes API keys, bearer tokens, cookies and unsafe context fields', () => {
  const { sanitizeClientEnvelope } = require('../src/telemetry-client');
  const apiKey = 'abcdefghijklmnopqrstuvwx1234567890';
  const bearer = 'Bearer eyJabcdefghijk.abcdefghijklmnop.qrstuvwxyz123456';
  const cookie = 'session=super-secret-cookie';
  const envelope = sanitizeClientEnvelope({
    message: `api_key=${apiKey} Authorization: ${bearer} Cookie: ${cookie}`,
    stack: `Error: token=${apiKey}\nAuthorization: ${bearer}`,
    context: {
      operation: 'privacy-test',
      route: `https://reviverelay.voidsmithindustries.com/review/v1/me?token=${apiKey}`,
      payload: `must-not-survive-${apiKey}`
    }
  });
  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes(apiKey), false);
  assert.equal(serialized.includes('super-secret-cookie'), false);
  assert.equal(serialized.includes('payload'), false);
  assert.match(serialized, /\[REDACTED\]/);
});
