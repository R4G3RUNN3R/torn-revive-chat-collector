const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SELECTORS,
  findChatContexts,
  findMessageContainer,
  isRecentlyInteracted,
  conversationNameFromId,
  processMessageNode
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

test('processMessageNode leaves a transiently unparseable React node eligible for a later pass', async () => {
  assert.equal(typeof processMessageNode, 'function', 'chat DOM helper must expose processMessageNode');

  const seenNodes = new WeakSet();
  const node = {};
  const saved = [];
  let parseable = false;

  const parseMessage = () => parseable ? { text: 'need a revive please' } : null;
  const save = async (record) => saved.push(record);

  const first = await processMessageNode({ node, chat: {}, seenNodes, parseMessage, save });
  assert.equal(first, false);
  assert.equal(seenNodes.has(node), false);
  assert.equal(saved.length, 0);

  parseable = true;
  const second = await processMessageNode({ node, chat: {}, seenNodes, parseMessage, save });
  assert.equal(second, true);
  assert.equal(seenNodes.has(node), true);
  assert.equal(saved.length, 1);

  const third = await processMessageNode({ node, chat: {}, seenNodes, parseMessage, save });
  assert.equal(third, false);
  assert.equal(saved.length, 1);
});

test('findChatContexts applies acceptChat before returning attachable contexts', () => {
  const publicBody = makeElement({ name: 'publicBody' });
  const factionBody = makeElement({ name: 'factionBody' });
  const privateBody = makeElement({ name: 'privateBody' });

  const publicChat = makeElement({ name: 'publicChat', queries: { [SELECTORS.chatBody]: publicBody } });
  publicChat.id = 'public_global';
  const factionChat = makeElement({ name: 'factionChat', queries: { [SELECTORS.chatBody]: factionBody } });
  factionChat.id = 'faction-123';
  const privateChat = makeElement({ name: 'privateChat', queries: { [SELECTORS.chatBody]: privateBody } });
  privateChat.id = 'private-456';

  const root = makeElement({
    queries: {
      [SELECTORS.chatWrapper]: [publicChat, factionChat, privateChat],
      [SELECTORS.chatRootWrapper]: [],
      [SELECTORS.chatTextarea]: []
    }
  });

  const contexts = findChatContexts(root, {
    acceptChat: (chat) => String(chat.id || '').startsWith('public_')
  });

  assert.deepEqual(contexts.map((context) => context.chat), [publicChat]);
});