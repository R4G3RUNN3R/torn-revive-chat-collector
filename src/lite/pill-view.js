(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLitePillView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HOST_ID = 'reviverelay-lite-root';
  const SIDEBAR_SELECTORS = Object.freeze([
    '#sidebar',
    '#sidebarroot',
    'nav[aria-label="Primary"]',
    'nav[aria-label="Main"]',
    '[role="navigation"][class*="sidebar"]',
    '[class*="sidebar"] nav'
  ]);
  const MIN_SIDEBAR_WIDTH = 40;

  const DOCK_CSS = [
    ':host{all:initial;display:block;margin:4px 0;font:700 12px/1 Arial,sans-serif;color:var(--rr-text)}',
    ':host([data-rr-placement="launcher"]){position:fixed;z-index:2147483646;right:calc(10px + env(safe-area-inset-right, 0px));bottom:calc(10px + env(safe-area-inset-bottom, 0px));margin:0}',
    '.rr-dock{display:flex;align-items:center;gap:8px;width:100%;min-height:28px;box-sizing:border-box;padding:0 8px;border:1px solid var(--rr-border);border-radius:5px;background:var(--rr-surface-raised);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:opacity var(--rr-motion-fast) ease}',
    '.rr-dock:hover{opacity:.85}',
    '.rr-dock:focus-visible{outline:2px solid var(--rr-accent);outline-offset:1px}',
    '.rr-dock[aria-expanded="true"]{border-color:var(--rr-accent)}',
    '.rr-icon{display:inline-flex;color:var(--rr-accent)}',
    ':host([data-rr-placement="launcher"]) .rr-dock{width:auto;min-width:44px;min-height:44px;justify-content:center;padding:0 12px;border-color:#e06565;border-radius:22px;background:#a4161a;color:#fff;box-shadow:var(--rr-elevation);touch-action:manipulation}',
    ':host([data-rr-placement="launcher"]) .rr-icon,:host([data-rr-placement="launcher"]) .rr-full,:host(:not([data-rr-placement="launcher"])) .rr-short{display:none}',
    '@media (prefers-reduced-motion: reduce){.rr-dock{transition:none}}'
  ].join('\n');

  let current = null;

  const dependency = (globalName, path) => globalThis[globalName] || require(path);

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

  function mountDock({ document, window, onActivate = () => {}, pda = false, sidebarSelectors = SIDEBAR_SELECTORS } = {}) {
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
    style.textContent = `${TOKENS_CSS}\n${DOCK_CSS}`;
    const button = document.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('class', 'rr-dock');
    button.setAttribute('aria-label', 'ReviveRelay');
    button.setAttribute('aria-expanded', 'false');
    const icon = document.createElement('span');
    icon.setAttribute('class', 'rr-icon');
    icon.appendChild(createIcon(document, 'heartbeat', 16));
    const full = document.createElement('span');
    full.setAttribute('class', 'rr-full');
    full.textContent = 'ReviveRelay';
    const short = document.createElement('span');
    short.setAttribute('class', 'rr-short');
    short.textContent = 'RR';
    button.appendChild(icon);
    button.appendChild(full);
    button.appendChild(short);
    shadow.appendChild(style);
    shadow.appendChild(button);

    const last = {};
    let destroyed = false;
    let observer = null;
    let observed = null;

    function patchAttribute(element, key, name, value) {
      if (last[key] === value) return;
      last[key] = value;
      element.setAttribute(name, value);
    }

    function findSidebar() {
      for (const selector of sidebarSelectors) {
        let node = null;
        try { node = document.querySelector(selector); } catch (_) { node = null; }
        if (node) return node;
      }
      return null;
    }

    function useLauncher(sidebar) {
      if (pda || (window && window.flutter_inappwebview) || !sidebar) return true;
      if (typeof sidebar.getBoundingClientRect === 'function' && sidebar.getBoundingClientRect().width < MIN_SIDEBAR_WIDTH) return true;
      return mediaMatches(window, '(pointer: coarse)') && Number(window.innerWidth) <= 900;
    }

    function observe(sidebar) {
      if (observed === sidebar) return;
      if (observer) observer.disconnect();
      observer = null;
      observed = sidebar;
      const Observer = window && window.MutationObserver;
      if (!sidebar || typeof Observer !== 'function') return;
      observer = new Observer(() => {
        if (host.parentNode !== findSidebar()) place();
      });
      observer.observe(sidebar, { childList: true });
      if (sidebar.parentNode) observer.observe(sidebar.parentNode, { childList: true });
    }

    function place() {
      if (destroyed) return null;
      const sidebar = findSidebar();
      const launcher = useLauncher(sidebar);
      const target = launcher ? document.body : sidebar;
      if (!target) return null;
      if (host.parentNode !== target) {
        const native = launcher ? [] : Array.from(target.children || []).filter(node => node !== host);
        target.insertBefore(host, native[1] || native[0] || null);
      }
      const placement = launcher ? 'launcher' : 'sidebar';
      patchAttribute(host, 'placement', 'data-rr-placement', placement);
      observe(launcher ? null : sidebar);
      return placement;
    }

    function refreshTheme() {
      if (destroyed) return;
      patchAttribute(host, 'theme', 'data-theme', detectTheme({ document, window }));
      patchAttribute(host, 'motion', 'data-motion', mediaMatches(window, '(prefers-reduced-motion: reduce)') ? 'reduce' : 'full');
    }

    function activate(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      try { onActivate(); } catch (_) { }
    }

    function onWindowClick(event) {
      const path = event && typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (path.includes(host)) activate(event);
    }

    function setExpanded(open) {
      if (!destroyed) patchAttribute(button, 'expanded', 'aria-expanded', open ? 'true' : 'false');
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      observe(null);
      button.removeEventListener('click', activate);
      if (window && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', place);
        window.removeEventListener('click', onWindowClick, true);
      }
      host.remove();
      if (current === instance) current = null;
    }

    button.addEventListener('click', activate);
    if (window && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', place);
      window.addEventListener('click', onWindowClick, true);
    }
    refreshTheme();
    place();

    const instance = Object.freeze({
      place,
      refreshTheme,
      setExpanded,
      destroy,
      host,
      shadow,
      placement: () => last.placement || null
    });
    current = instance;
    return instance;
  }

  return Object.freeze({ HOST_ID, SIDEBAR_SELECTORS, DOCK_CSS, detectTheme, mountDock });
});
