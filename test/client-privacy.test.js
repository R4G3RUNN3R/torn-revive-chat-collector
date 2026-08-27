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

test('installable userscript declares and uses the shared public-channel policy', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

  assert.match(source, /@require\s+https:\/\/raw\.githubusercontent\.com\/R4G3RUNN3R\/torn-revive-chat-collector\/__REVIVERELAY_GIT_COMMIT__\/src\/public-channels\.js/);
  assert.match(source, /@require\s+https:\/\/raw\.githubusercontent\.com\/R4G3RUNN3R\/torn-revive-chat-collector\/__REVIVERELAY_GIT_COMMIT__\/src\/client-chat-policy\.js/);
  assert.match(source, /TornRevivePublicChannels/);
  assert.match(source, /TornReviveClientChatPolicy/);
  assert.match(source, /findChatContexts\(document,\s*\{[\s\S]*acceptChat/);
});

test('install artifact declares the ReviveRelay API client without wildcard network permission', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');
  assert.match(source, /@require\s+https:\/\/raw\.githubusercontent\.com\/R4G3RUNN3R\/torn-revive-chat-collector\/__REVIVERELAY_GIT_COMMIT__\/src\/api-client\.js/);
  assert.match(source, /ReviveRelayApiClient/);
  assert.doesNotMatch(source, /@connect\s+\*/);
});

test('build verifies the userscript support modules exist', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'build.js'), 'utf8');
  assert.match(source, /public-channels\.js/);
  assert.match(source, /client-chat-policy\.js/);
  assert.match(source, /api-client\.js/);
});