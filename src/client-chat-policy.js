(function (root, factory) {
  const publicChannels = typeof module === 'object' && module.exports
    ? require('./public-channels')
    : root?.TornRevivePublicChannels;
  const api = factory(publicChannels);

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TornReviveClientChatPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PublicChannels) {
  'use strict';

  const RECOGNIZED_NON_PUBLIC_PREFIX = /^(?:faction-|company-|private-|competition-|poker-)/i;

  function candidateIds(chat) {
    if (!chat) return [];
    const values = [
      chat.getAttribute?.('data-channel-id'),
      chat.getAttribute?.('data-chat-id'),
      chat.id
    ];
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
  }

  function resolvePublicChat(chat, options = {}) {
    if (!chat || typeof PublicChannels?.canonicalPublicChannel !== 'function') return null;

    const ids = candidateIds(chat);
    for (const id of ids) {
      const channel = PublicChannels.canonicalPublicChannel(id);
      if (channel) return channel;
    }

    // A semantic Torn chat id that is not on the public allowlist is an
    // explicit rejection. Never let a friendly-looking title override it.
    if (ids.some((id) => id.toLowerCase().startsWith('public_') || RECOGNIZED_NON_PUBLIC_PREFIX.test(id))) {
      return null;
    }

    // Legacy wrappers may have no useful id. Only then may an exact known
    // public display name provide the positive identification.
    const getName = typeof options.getName === 'function' ? options.getName : null;
    if (!ids.length && getName) {
      return PublicChannels.canonicalPublicChannel(String(getName(chat) || '').trim());
    }

    return null;
  }

  function acceptsPublicChat(chat, options = {}) {
    return resolvePublicChat(chat, options) !== null;
  }

  return Object.freeze({
    resolvePublicChat,
    acceptsPublicChat
  });
});