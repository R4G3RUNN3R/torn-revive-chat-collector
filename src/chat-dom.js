(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TornReviveChatDom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SELECTORS = Object.freeze({
    chatRoot: '#chatRoot',
    chatTextarea: 'textarea[placeholder="Type your message here..."]',
    chatWrapper: '[class*="group-chat-box__chat-box-wrapper___"], [class*="group-chat-box___"], div[id*="-"]',
    chatBody: '[class*="chat-box-body___"], [class*="chatBoxBody___"]',
    messageContainer: '[class^="list"], [class*="list___"]',
    message: '[class*="chat-box-message___"], [class*="chatBoxMessage___"]',
    sender: '[class*="chat-box-message__sender___"], [class*="sender_"]',
    messageText: '[class*="chat-box-message__message___"], [class*="message___"]',
    headerInfo: '[class*="chat-box-header__info___"], [class*="chat-box-header___"]',
    chatList: '[class*="chat-app__chat-list-chat-box-wrapper___"]',
    minimizedItem: '[class*="minimized-menu-item___"]',
    unreadCount: '[class*="message-count___"]'
  });

  function unique(elements) {
    return [...new Set((elements || []).filter(Boolean))];
  }

  function findMessageContainer(body) {
    if (!body) return null;
    return body.querySelector?.(SELECTORS.messageContainer) || body;
  }

  function findBody(chat) {
    return chat?.querySelector?.(SELECTORS.chatBody) || null;
  }

  function findChatContexts(root) {
    if (!root?.querySelectorAll) return [];

    const candidates = [];
    candidates.push(...root.querySelectorAll(SELECTORS.chatWrapper));

    for (const textarea of root.querySelectorAll(SELECTORS.chatTextarea)) {
      const wrapper = textarea.closest?.(SELECTORS.chatWrapper);
      if (wrapper) candidates.push(wrapper);
    }

    return unique(candidates)
      .map((chat) => ({ chat, body: findBody(chat) }))
      .filter((context) => context.body);
  }

  function messageCandidates(container) {
    if (!container) return [];
    const direct = Array.from(container.children || []);
    if (direct.length) return direct;
    return Array.from(container.querySelectorAll?.(SELECTORS.message) || []);
  }

  function isRecentlyInteracted(lastInteractionAt, now = Date.now(), windowMs = 60_000) {
    if (!Number.isFinite(lastInteractionAt) || lastInteractionAt <= 0) return false;
    return now - lastInteractionAt <= windowMs;
  }

  return {
    SELECTORS,
    findChatContexts,
    findMessageContainer,
    messageCandidates,
    isRecentlyInteracted
  };
});
