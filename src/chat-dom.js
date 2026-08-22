(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TornReviveChatDom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SELECTORS = Object.freeze({
    chatRoot: '#chatRoot',
    chatTextarea: 'textarea[placeholder="Type your message here..."]',

    // Legacy / Chat 2.0 wrappers still seen by several widely-used scripts.
    chatWrapper: '[class*="group-chat-box__chat-box-wrapper___"], [class*="group-chat-box___"]',
    chatBody: '[class*="chat-box-body___"], [class*="chatBoxBody___"]',

    // Current 2026 chat roots. Examples include #chatRoot [id^="faction-"]
    // with classes beginning/containing "root".
    chatRootWrapper: 'div[class^="root"][id*="-"], div[class*="root"][id*="-"]',
    chatFallbackWrapper: 'div[id*="-"]',

    // Current virtualized message container plus older list/body fallbacks.
    messageContainer: '[class*="scrollWrapper__"], [class^="list"], [class*="list___"]',
    modernBox: '[class*="box__"]',
    modernVirtualItem: '[class*="virtualItem__"]',
    legacyMessage: '[class*="chat-box-message___"], [class*="chatBoxMessage___"]',
    messageItem: '[class*="box__"], [class*="virtualItem__"], [class*="chat-box-message___"], [class*="chatBoxMessage___"]',
    message: '[class*="box__"], [class*="virtualItem__"], [class*="chat-box-message___"], [class*="chatBoxMessage___"]',

    // Current July 2026 extraction classes first, old Chat 2.0 classes second.
    sender: '[class*="senderContainer__"], [class*="chat-box-message__sender___"], [class*="sender_"]',
    messageText: '[class*="body__"], [class*="message__"], [class*="content__"], [class*="chat-box-message__message___"]',
    headerInfo: '[class*="chat-box-header__info___"], [class*="chat-box-header___"], [class*="header__"]',

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
    if (!chat) return null;
    const legacyBody = chat.querySelector?.(SELECTORS.chatBody);
    if (legacyBody) return legacyBody;
    if (chat.querySelector?.(SELECTORS.messageContainer)) return chat;
    return null;
  }

  function findTextareaWrapper(textarea) {
    if (!textarea?.closest) return null;
    return textarea.closest(SELECTORS.chatWrapper)
      || textarea.closest(SELECTORS.chatRootWrapper)
      || textarea.closest(SELECTORS.chatFallbackWrapper);
  }

  function findChatContexts(root) {
    if (!root?.querySelectorAll) return [];

    const candidates = [];
    candidates.push(...root.querySelectorAll(SELECTORS.chatWrapper));
    candidates.push(...root.querySelectorAll(SELECTORS.chatRootWrapper));

    for (const textarea of root.querySelectorAll(SELECTORS.chatTextarea)) {
      const wrapper = findTextareaWrapper(textarea);
      if (wrapper) candidates.push(wrapper);
    }

    return unique(candidates)
      .map((chat) => ({ chat, body: findBody(chat) }))
      .filter((context) => context.body);
  }

  function messageCandidates(container) {
    if (!container?.querySelectorAll) return Array.from(container?.children || []);

    const modernBoxes = Array.from(container.querySelectorAll(SELECTORS.modernBox));
    if (modernBoxes.length) return modernBoxes;

    const virtualItems = Array.from(container.querySelectorAll(SELECTORS.modernVirtualItem));
    if (virtualItems.length) return virtualItems;

    const legacy = Array.from(container.querySelectorAll(SELECTORS.legacyMessage));
    if (legacy.length) return legacy;

    return Array.from(container.children || []);
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
