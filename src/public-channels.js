(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TornRevivePublicChannels = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CHANNELS = Object.freeze({
    public_global: Object.freeze({ id: 'public_global', name: 'Global', type: 'global' }),
    public_trade: Object.freeze({ id: 'public_trade', name: 'Trade', type: 'trade' }),
    public_hospital: Object.freeze({ id: 'public_hospital', name: 'Hospital', type: 'hospital' }),
    public_jail: Object.freeze({ id: 'public_jail', name: 'Jail', type: 'jail' }),
    public_new_player: Object.freeze({ id: 'public_new_player', name: 'New Player', type: 'new_player' }),
    public_travel_mexico: Object.freeze({ id: 'public_travel_mexico', name: 'Mexico', type: 'travel' }),
    public_travel_cayman_islands: Object.freeze({ id: 'public_travel_cayman_islands', name: 'Cayman Islands', type: 'travel' }),
    public_travel_canada: Object.freeze({ id: 'public_travel_canada', name: 'Canada', type: 'travel' }),
    public_travel_hawaii: Object.freeze({ id: 'public_travel_hawaii', name: 'Hawaii', type: 'travel' }),
    public_travel_united_kingdom: Object.freeze({ id: 'public_travel_united_kingdom', name: 'United Kingdom', type: 'travel' }),
    public_travel_argentina: Object.freeze({ id: 'public_travel_argentina', name: 'Argentina', type: 'travel' }),
    public_travel_switzerland: Object.freeze({ id: 'public_travel_switzerland', name: 'Switzerland', type: 'travel' }),
    public_travel_japan: Object.freeze({ id: 'public_travel_japan', name: 'Japan', type: 'travel' }),
    public_travel_china: Object.freeze({ id: 'public_travel_china', name: 'China', type: 'travel' }),
    public_travel_uae: Object.freeze({ id: 'public_travel_uae', name: 'UAE', type: 'travel' }),
    public_travel_south_africa: Object.freeze({ id: 'public_travel_south_africa', name: 'South Africa', type: 'travel' })
  });

  const NAME_ALIASES = Object.freeze(Object.values(CHANNELS).reduce((aliases, channel) => {
    aliases[channel.name.toLowerCase()] = channel.id;
    return aliases;
  }, Object.create(null)));

  function canonicalPublicChannel(idOrName) {
    if (typeof idOrName !== 'string') return null;
    const value = idOrName.trim();
    if (!value) return null;

    const direct = CHANNELS[value.toLowerCase()];
    if (direct) return direct;

    const aliasId = NAME_ALIASES[value.toLowerCase()];
    return aliasId ? CHANNELS[aliasId] : null;
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
