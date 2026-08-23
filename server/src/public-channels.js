(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TornRevivePublicChannels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHANNELS = Object.freeze([
    { id: 'public_global', name: 'Global', type: 'global' },
    { id: 'public_trade', name: 'Trade', type: 'trade' },
    { id: 'public_hospital', name: 'Hospital', type: 'hospital' },
    { id: 'public_jail', name: 'Jail', type: 'jail' },
    { id: 'public_new_player', name: 'New Player', type: 'new_player' },
    { id: 'public_travel_mexico', name: 'Mexico', type: 'travel' },
    { id: 'public_travel_cayman_islands', name: 'Cayman Islands', type: 'travel' },
    { id: 'public_travel_canada', name: 'Canada', type: 'travel' },
    { id: 'public_travel_hawaii', name: 'Hawaii', type: 'travel' },
    { id: 'public_travel_united_kingdom', name: 'United Kingdom', type: 'travel' },
    { id: 'public_travel_argentina', name: 'Argentina', type: 'travel' },
    { id: 'public_travel_switzerland', name: 'Switzerland', type: 'travel' },
    { id: 'public_travel_japan', name: 'Japan', type: 'travel' },
    { id: 'public_travel_china', name: 'China', type: 'travel' },
    { id: 'public_travel_uae', name: 'UAE', type: 'travel' },
    { id: 'public_travel_south_africa', name: 'South Africa', type: 'travel' }
  ]);

  const BY_ID = new Map(CHANNELS.map((channel) => [channel.id, channel]));
  const BY_NAME = new Map(CHANNELS.map((channel) => [channel.name.toLowerCase(), channel]));

  function clone(channel) {
    return channel ? { id: channel.id, name: channel.name, type: channel.type } : null;
  }

  function canonicalPublicChannel(idOrName) {
    if (typeof idOrName !== 'string') return null;
    const value = idOrName.trim();
    if (!value) return null;

    const byId = BY_ID.get(value.toLowerCase());
    if (byId) return clone(byId);

    const byName = BY_NAME.get(value.toLowerCase());
    return clone(byName || null);
  }

  function isPublicChannel(idOrName) {
    return canonicalPublicChannel(idOrName) !== null;
  }

  return Object.freeze({
    CHANNELS,
    canonicalPublicChannel,
    isPublicChannel
  });
});
