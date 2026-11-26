(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLitePillView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HOST_ID = 'reviverelay-lite-root';
  // Torn header button area, most specific first. Overridable for tests and future Torn markup.
  const HEADER_SLOT_SELECTORS = Object.freeze([
    '#topRoot [class*="header-buttons"]',
    '#header-root [class*="header-buttons"]',
    '.header-wrapper-top .header-navigation.right',
    '.header-wrapper-top .header-navigation'
  ]);
  const MIN_SLOT_WIDTH = 40;

  const PILL_CSS = [
    ':host{all:initial;display:inline-flex;align-items:center;vertical-align:middle;margin:0 4px;font-family:inherit;font-size:inherit;line-height:1;color:var(--rr-text)}',
    ':host([data-rr-placement="launcher"]){position:fixed;z-index:2147483646;right:calc(10px + env(safe-area-inset-right, 0px));bottom:calc(10px + env(safe-area-inset-bottom, 0px));margin:0}',
    '.rr-pill{display:inline-flex;align-items:center;gap:6px;min-height:28px;max-width:280px;padding:0 10px;border:1px solid var(--rr-border);border-radius:999px;background:var(--rr-surface);color:var(--rr-text);font:inherit;font-weight:var(--rr-weight-regular);cursor:pointer;transition:opacity var(--rr-motion-slow) ease,transform var(--rr-motion-fast) ease}',
    ':host([data-rr-placement="launcher"]) .rr-pill{min-height:44px;padding:0 14px;box-shadow:var(--rr-elevation)}',
    '@media (pointer: coarse){:host([data-rr-placement="launcher"]) .rr-pill{min-height:44px}}',
    '.rr-pill:focus-visible{outline:2px solid var(--rr-accent);outline-offset:2px}',
    '.rr-pill[data-tone="neutral"]{--rr-tone:var(--rr-accent)}',
    '.rr-pill[data-tone="waiting"]{--rr-tone:var(--rr-tone-waiting);border-color:var(--rr-tone-waiting)}',
    '.rr-pill[data-tone="action"]{--rr-tone:var(--rr-tone-action);border-color:var(--rr-tone-action)}',
    '.rr-pill[data-tone="progress"]{--rr-tone:var(--rr-tone-progress);border-color:var(--rr-tone-progress)}',
    '.rr-pill[data-tone="success"]{--rr-tone:var(--rr-tone-success);border-color:var(--rr-tone-success)}',
    '.rr-pill[data-tone="attention"]{--rr-tone:var(--rr-tone-attention);border-color:var(--rr-tone-attention)}',
    '.rr-icon{display:inline-flex;color:var(--rr-tone)}',
    '.rr-label{font-weight:var(--rr-weight-strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rr-detail{color:var(--rr-text-muted);white-space:nowrap}',
    '.rr-detail:empty{display:none}',
    '.rr-detail::before{content:"\\00B7\\00A0"}',
    '.rr-sync{display:none;width:6px;height:6px;border-radius:50%;background:var(--rr-text-muted);animation:rr-sync-in var(--rr-motion-slow) ease-out both}',
    '.rr-pill[data-syncing="true"] .rr-sync{display:inline-block}',
    '.rr-pill[data-offline="true"]{border-style:dashed;opacity:.85}',
    '@keyframes rr-sync-in{from{opacity:0}to{opacity:1}}',
    '@media (prefers-reduced-motion: reduce){.rr-pill,.rr-sync{transition:none;animation:none}}',
    ':host([data-motion="reduce"]) .rr-pill,:host([data-motion="reduce"]) .rr-sync{transition:none;animation:none}'
  ].join('\n');

  let current = null;

  function dependency(globalName, path) {
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
    if (typeof require === 'function') return require(path);
    throw new Error(`${globalName} unavailable`);
  }

  function mediaMatches(window, query) {
    try {
      return Boolean(window && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
    } catch (_) {
      return false;
    }
  }

  function detectTheme({ document, window }) {
    const body = document && document.body;
    if (body && body.classList) {
      if (body.classList.contains('dark-mode')) return 'dark';
      if (body.classList.contains('light-mode')) return 'light';
    }
    return mediaMatches(window, '(prefers-color-scheme: dark)') ? 'dark' : 'light';
  }

  function mountPill({ document, window, onActivate = () => {}, headerSelectors = HEADER_SLOT_SELECTORS, minSlotWidth = MIN_SLOT_WIDTH } = {}) {
    if (!document || typeof document.createElement !== 'function') throw new Error('document is required');
    const { createIcon } = dependency('ReviveRelayLiteIcons', './icons');
    const { TOKENS_CSS } = dependency('ReviveRelayLiteTokens', './tokens');

    if (current) current.destroy();
    current = null;
    const stale = typeof document.getElementById === 'function' ? document.getElementById(HOST_ID) : null;
    if (stale) stale.remove();

    const host = document.createElement('div');
    host.setAttribute('id', HOST_ID);
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `${TOKENS_CSS}\n${PILL_CSS}`;
    const button = document.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('class', 'rr-pill');
    button.setAttribute('aria-label', 'ReviveRelay');
    button.setAttribute('part', 'pill');
    const iconSlot = document.createElement('span');
    iconSlot.setAttribute('class', 'rr-icon');
    const label = document.createElement('span');
    label.setAttribute('class', 'rr-label');
    const detail = document.createElement('span');
    detail.setAttribute('class', 'rr-detail');
    const sync = document.createElement('span');
    sync.setAttribute('class', 'rr-sync');
    sync.setAttribute('aria-hidden', 'true');
    button.appendChild(iconSlot);
    button.appendChild(label);
    button.appendChild(detail);
    button.appendChild(sync);
    shadow.appendChild(style);
    shadow.appendChild(button);

    const last = {};
    let destroyed = false;

    function patchAttribute(element, key, name, value) {
      if (last[key] === value) return;
      last[key] = value;
      element.setAttribute(name, value);
    }

    function patchText(element, key, value) {
      if (last[key] === value) return;
      last[key] = value;
      element.textContent = value;
    }

    function findHeaderSlot() {
      for (const selector of headerSelectors) {
        let slot = null;
        try { slot = document.querySelector(selector); } catch (_) { slot = null; }
        if (!slot) continue;
        const width = typeof slot.getBoundingClientRect === 'function' ? slot.getBoundingClientRect().width : minSlotWidth;
        if (width >= minSlotWidth) return slot;
      }
      return null;
    }

    function place() {
      if (destroyed) return null;
      const slot = findHeaderSlot();
      const target = slot || document.body;
      if (!target) return null;
      const placement = slot ? 'header' : 'launcher';
      if (host.parentNode !== target) target.appendChild(host);
      patchAttribute(host, 'placement', 'data-rr-placement', placement);
      return placement;
    }

    function refreshTheme() {
      if (destroyed) return;
      patchAttribute(host, 'theme', 'data-theme', detectTheme({ document, window }));
      patchAttribute(host, 'motion', 'data-motion', mediaMatches(window, '(prefers-reduced-motion: reduce)') ? 'reduce' : 'full');
    }

    function onClick(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      try { onActivate(); } catch (_) { /* activation errors stay with the caller */ }
    }

    function onResize() {
      place();
    }

    function update(view) {
      if (destroyed || !view) return;
      const text = String(view.text || view.label || '');
      patchAttribute(button, 'tone', 'data-tone', String(view.tone || 'neutral'));
      patchAttribute(button, 'syncing', 'data-syncing', view.syncing ? 'true' : 'false');
      patchAttribute(button, 'offline', 'data-offline', view.offline ? 'true' : 'false');
      patchAttribute(button, 'aria', 'aria-label', `ReviveRelay: ${text}${view.syncing ? ' (syncing)' : ''}`);
      patchText(label, 'label', String(view.label || ''));
      patchText(detail, 'detail', String(view.detail || ''));
      const icon = String(view.icon || 'pill');
      if (last.icon !== icon) {
        last.icon = icon;
        const previous = iconSlot.firstChild;
        if (previous) previous.remove();
        iconSlot.appendChild(createIcon(document, icon, 16));
      }
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      button.removeEventListener('click', onClick);
      if (window && typeof window.removeEventListener === 'function') window.removeEventListener('resize', onResize);
      host.remove();
      if (current === instance) current = null;
    }

    button.addEventListener('click', onClick);
    if (window && typeof window.addEventListener === 'function') window.addEventListener('resize', onResize);
    refreshTheme();
    place();

    const instance = Object.freeze({
      update,
      destroy,
      place,
      refreshTheme,
      host,
      shadow,
      placement: () => last.placement || null
    });
    current = instance;
    return instance;
  }

  return Object.freeze({ HOST_ID, HEADER_SLOT_SELECTORS, MIN_SLOT_WIDTH, PILL_CSS, detectTheme, mountPill });
});
