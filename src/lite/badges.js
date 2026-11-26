(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteBadges = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROFILE_PATTERN = /\/profiles\.php\?(?:[^#]*&)?XID=([1-9][0-9]{0,11})(?:[&#]|$)/;
  const PROFILE_SLOTS = Object.freeze(['#profileroot .profile-wrapper .title-black', '.content-title h4']);
  const BADGE_STYLE = 'margin-left:6px;padding:0 6px;border:1px solid #a4161a;border-radius:9px;font-size:11px;color:#a4161a';

  function badgeText(badge) {
    const roles = [badge.requesterVerified && 'requester', badge.reviverVerified && 'reviver'].filter(Boolean);
    return roles.length ? `RR verified ${roles.join(' · ')}` : '';
  }

  function createBadges({ document, window, api, enabled = () => true, slots = PROFILE_SLOTS }) {
    const pending = new Set();

    function slot() {
      for (const selector of slots) {
        let node = null;
        try { node = document.querySelector(selector); } catch (_) { node = null; }
        if (node) return node;
      }
      return null;
    }

    async function scan() {
      if (!enabled() || document.hidden || !api || typeof api.getPlayerBadge !== 'function') return false;
      const match = PROFILE_PATTERN.exec(String(window.location && window.location.href));
      const target = match && slot();
      if (!target || pending.has(match[1])) return false;
      const existing = target.querySelector('[data-rr-badge]');
      if (existing && existing.getAttribute('data-rr-badge') === match[1]) return false;
      pending.add(match[1]);
      try {
        const text = badgeText(await api.getPlayerBadge(match[1]));
        if (existing) existing.remove();
        if (!text || target.querySelector('[data-rr-badge]')) return false;
        const chip = document.createElement('span');
        chip.setAttribute('data-rr-badge', match[1]);
        chip.setAttribute('style', BADGE_STYLE);
        chip.textContent = text;
        target.appendChild(chip);
        return true;
      } catch (_) {
        return false;
      } finally {
        pending.delete(match[1]);
      }
    }

    return Object.freeze({ scan });
  }

  return Object.freeze({ PROFILE_PATTERN, PROFILE_SLOTS, badgeText, createBadges });
});
