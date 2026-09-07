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
