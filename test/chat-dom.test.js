const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SELECTORS,
  findChatContexts,
  findMessageContainer,
  isRecentlyInteracted,
  conversationNameFromId
} = require('../src/chat-dom');

function makeElement({ name = '', matches = {}, queries = {}, closest = {} } = {}) {
  return {
    name,
    querySelector(selector) {
      return queries[selector] || null;
    },
    querySelectorAll(selector) {
      return queries[selector] || [];
    },
    closest(selector) {
      return closest[selector] || null;
    }
  };
}

test('selectors include stable textarea, legacy Chat 2.0 classes, current virtualized chat classes, and public chat ids', () => {
  assert.match(SELECTORS.chatTextarea, /Type your message here/);
  assert.match(SELECTORS.chatWrapper, /group-chat-box/);
  assert.match(SELECTORS.chatBody, /chat-box-body/);
  assert.match(SELECTORS.chatRootWrapper, /root/);
  assert.match(SELECTORS.chatRootWrapper, /public_/);
  assert.match(SELECTORS.chatRootWrapper, /private-/);
  assert.match(SELECTORS.messageContainer, /scrollWrapper/);
  assert.match(SELECTORS.messageContainer, /\[class\^="list"\]/);
  assert.match(SELECTORS.messageItem, /box__/);
  assert.match(SELECTORS.messageItem, /virtualItem__/);
  assert.match(SELECTORS.sender, /chat-box-message__sender/);
  assert.match(SELECTORS.sender, /senderContainer__/);
  assert.match(SELECTORS.messageText, /chat-box-message__message/);
  assert.match(SELECTORS.messageText, /body__/);
});

test('conversationNameFromId understands current Torn public chat ids generically', () => {
  assert.equal(conversationNameFromId('public_global'), 'Global');
  assert.equal(conversationNameFromId('public_trade'), 'Trade');
  assert.equal(conversationNameFromId('public_hospital'), 'Hospital');
  assert.equal(conversationNameFromId('public_jail'), 'Jail');
  assert.equal(conversationNameFromId('public_new_player'), 'New Player');
  assert.equal(conversationNameFromId('public_mexico'), 'Mexico');
  assert.equal(conversationNameFromId('faction-123'), 'Faction');
  assert.equal(conversationNameFromId('company-456'), 'Company');
});

test('findChatContexts discovers and deduplicates chats from both wrappers and textareas', () => {
  const bodyA = makeElement({ name: 'bodyA' });
  const bodyB = makeElement({ name: 'bodyB' });

  const wrapperA = makeElement({
    name: 'wrapperA',
    queries: { [SELECTORS.chatBody]: bodyA }
  });
  const wrapperB = makeElement({
    name: 'wrapperB',
    queries: { [SELECTORS.chatBody]: bodyB }
  });

  const textareaA = makeElement({
    closest: { [SELECTORS.chatWrapper]: wrapperA }
  });

  const root = makeElement({
    queries: {
      [SELECTORS.chatWrapper]: [wrapperA, wrapperB],
      [SELECTORS.chatRootWrapper]: [],
      [SELECTORS.chatTextarea]: [textareaA]
    }
  });

  const contexts = findChatContexts(root);
  assert.equal(contexts.length, 2);
  assert.deepEqual(contexts.map((ctx) => ctx.chat), [wrapperA, wrapperB]);
  assert.deepEqual(contexts.map((ctx) => ctx.body), [bodyA, bodyB]);
});

test('findChatContexts supports current root/id chats that expose a virtualized message list without old chat-body classes', () => {
  const list = makeElement({ name: 'messageList' });
  const currentRootChat = makeElement({
    name: 'currentRootChat',
    queries: { [SELECTORS.messageContainer]: list }
  });

  const root = makeElement({
    queries: {
      [SELECTORS.chatWrapper]: [],
      [SELECTORS.chatRootWrapper]: [currentRootChat],
      [SELECTORS.chatTextarea]: []
    }
  });

  const contexts = findChatContexts(root);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].chat, currentRootChat);
  assert.equal(contexts[0].body, currentRootChat);
  assert.equal(findMessageContainer(contexts[0].body), list);
});

test('findMessageContainer prefers the dedicated virtualized scroll/list wrapper and falls back to chat body', () => {
  const list = makeElement({ name: 'list' });
  const body = makeElement({
    name: 'body',
    queries: { [SELECTORS.messageContainer]: list }
  });

  assert.equal(findMessageContainer(body), list);

  const bodyWithoutList = makeElement({ name: 'bodyWithoutList' });
  assert.equal(findMessageContainer(bodyWithoutList), bodyWithoutList);
});

test('isRecentlyInteracted accepts only interaction inside the configured activity window', () => {
  assert.equal(isRecentlyInteracted(10_000, 15_000, 10_000), true);
  assert.equal(isRecentlyInteracted(10_000, 20_001, 10_000), false);
  assert.equal(isRecentlyInteracted(0, 15_000, 10_000), false);
});
