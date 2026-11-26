const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PillView = require('../src/lite/pill-view');
const { HOST_ID, SIDEBAR_SELECTORS, DOCK_CSS, detectTheme, mountDock } = PillView;
const { createFakeDocument, createFakeWindow, countNodes } = require('./helpers/fake-dom');

// 0.7.3's src/sidebar-action.js NAV_SELECTORS (git show e661af8:src/sidebar-action.js), in order.
const SIDEBAR_SELECTORS_073 = [
  '#sidebar',
  '#sidebarroot',
  'nav[aria-label="Primary"]',
  'nav[aria-label="Main"]',
  '[role="navigation"][class*="sidebar"]',
  '[class*="sidebar"] nav'
];

// Records observers so a test can deliver a mutation batch, as the browser does after a DOM change.
function withMutationObserver(window) {
  const observers = [];
  window.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target, options) { this.targets.push([target, options]); }
    disconnect() { this.targets = []; }
  };
  window.flushMutations = () => {
    for (const observer of [...observers]) if (observer.targets.length) observer.callback([], observer);
  };
  window.observers = observers;
  return window;
}

function addSidebar(document, id = 'sidebar', parent = document.body) {
  const sidebar = document.createElement('div');
  sidebar.setAttribute('id', id);
  for (const name of ['user', 'areas', 'lists']) {
    const block = document.createElement('div');
    block.setAttribute('class', `sidebar-${name}`);
    sidebar.appendChild(block);
  }
  parent.appendChild(sidebar);
  return sidebar;
}

function setup({ sidebar = true, media = {}, pda = false, width = 1280 } = {}) {
  const document = createFakeDocument();
  const window = withMutationObserver(createFakeWindow({ media }));
  window.innerWidth = width;
  const side = sidebar ? addSidebar(document) : null;
  const activations = [];
  const view = mountDock({ document, window, pda, onActivate: () => activations.push(1) });
  const button = view.shadow.querySelector('button');
  return { document, window, sidebar: side, view, button, activations };
}

test('the dock uses 0.7.3\'s sidebar targets, in 0.7.3\'s order', () => {
  assert.deepEqual([...SIDEBAR_SELECTORS], SIDEBAR_SELECTORS_073);
});

test('the dock mounts one row in Torn\'s left sidebar, second from the top as 0.7.3 did', () => {
  const { document, sidebar, view } = setup();
  assert.equal(view.host.getAttribute('id'), HOST_ID);
  assert.equal(view.host.parentNode, sidebar);
  assert.equal(sidebar.children[1], view.host);
  assert.equal(sidebar.children.length, 4);
  assert.equal(view.placement(), 'sidebar');
  assert.equal(view.shadow.mode, 'closed');
  assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 1);
});

test('without #sidebar the dock falls back to #sidebarroot (the next 0.7.3 target)', () => {
  const document = createFakeDocument();
  const window = withMutationObserver(createFakeWindow());
  const root = addSidebar(document, 'sidebarroot');
  const view = mountDock({ document, window });
  assert.equal(view.host.parentNode, root);
  assert.equal(view.placement(), 'sidebar');
});

test('the row re-mounts after Torn re-renders the sidebar\'s children, with no timer', () => {
  const { sidebar, view, window } = setup();
  sidebar.removeChild(view.host);
  assert.equal(view.host.isConnected, false);
  window.flushMutations();
  assert.equal(view.host.parentNode, sidebar);
  assert.equal(sidebar.children[1], view.host);
});

test('the row re-mounts after Torn replaces the whole sidebar element', () => {
  const { document, sidebar, view, window } = setup();
  sidebar.remove();
  const replacement = addSidebar(document);
  window.flushMutations();
  assert.equal(view.host.parentNode, replacement);
  assert.equal(replacement.children[1], view.host);
  assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 1);
  // The observer follows the new sidebar and drops the old one.
  const watched = window.observers.flatMap(observer => observer.targets.map(([target]) => target));
  assert.ok(watched.includes(replacement));
  assert.ok(!watched.includes(sidebar));
});

test('a mutation while the row is in place changes nothing (no re-insert loop)', () => {
  const { document, view, window } = setup();
  const before = document.mutations;
  window.flushMutations();
  window.flushMutations();
  assert.equal(document.mutations, before);
  assert.equal(view.placement(), 'sidebar');
});

test('the dock is never placed in Torn\'s header', () => {
  const document = createFakeDocument();
  const window = withMutationObserver(createFakeWindow());
  const header = document.createElement('div');
  header.setAttribute('class', 'header-buttons___qZ3xK');
  document.body.appendChild(header);
  const view = mountDock({ document, window });
  assert.notEqual(view.host.parentNode, header);
  assert.equal(view.placement(), 'launcher');
  assert.equal(PillView.HEADER_SLOT_SELECTORS, undefined);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lite', 'pill-view.js'), 'utf8');
  assert.doesNotMatch(source, /header-buttons|header-navigation|headerSelectors/);
});

test('with no sidebar, the floating bottom-right launcher is used', () => {
  const { document, view } = setup({ sidebar: false });
  assert.equal(view.placement(), 'launcher');
  assert.equal(view.host.parentNode, document.body);
  assert.match(DOCK_CSS, /:host\(\[data-rr-placement="launcher"\]\)\{position:fixed[^}]*right:calc\(10px \+ env\(safe-area-inset-right, 0px\)\)[^}]*bottom:calc\(10px \+ env\(safe-area-inset-bottom, 0px\)\)/);
});

test('a hidden (zero-width) sidebar uses the launcher; a later visible sidebar gets the row on resize', () => {
  const { sidebar, view, window } = setup();
  sidebar.rect.width = 0;
  window.dispatch('resize');
  assert.equal(view.placement(), 'launcher');
  sidebar.rect.width = 172;
  window.dispatch('resize');
  assert.equal(view.placement(), 'sidebar');
  assert.equal(view.host.parentNode, sidebar);
});

test('on a TornPDA runtime the launcher is used even when Torn renders a sidebar', () => {
  const flagged = setup({ pda: true });
  assert.equal(flagged.view.placement(), 'launcher');
  assert.equal(flagged.view.host.parentNode, flagged.document.body);
  const document = createFakeDocument();
  const window = withMutationObserver(createFakeWindow());
  window.flutter_inappwebview = {};
  addSidebar(document);
  const bridged = mountDock({ document, window });
  assert.equal(bridged.placement(), 'launcher');
});

test('a narrow touch screen uses the launcher (0.7.3 recovery-launcher rule)', () => {
  const touch = setup({ media: { '(pointer: coarse)': true }, width: 800 });
  assert.equal(touch.view.placement(), 'launcher');
  const wideTouch = setup({ media: { '(pointer: coarse)': true }, width: 1280 });
  assert.equal(wideTouch.view.placement(), 'sidebar');
});

test('the launcher is a 44 px touch target labelled RR; the sidebar row reads ReviveRelay', () => {
  assert.match(DOCK_CSS, /:host\(\[data-rr-placement="launcher"\]\) \.rr-dock\{[^}]*min-width:44px[^}]*min-height:44px/);
  const { button } = setup();
  assert.equal(button.textContent, 'ReviveRelayRR');
  assert.match(DOCK_CSS, /:host\(\[data-rr-placement="launcher"\]\) \.rr-full,:host\(:not\(\[data-rr-placement="launcher"\]\)\) \.rr-short\{display:none\}/);
});

test('the button has a fixed accessible name and carries aria-expanded, never status', () => {
  const { view, button } = setup();
  assert.equal(button.getAttribute('aria-label'), 'ReviveRelay');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-live'), null);
  assert.equal(view.update, undefined, 'the dock has no status update');
  view.setExpanded(true);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(button.getAttribute('aria-label'), 'ReviveRelay');
  view.setExpanded(false);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('no tone colours or state styling in the dock CSS', () => {
  assert.doesNotMatch(DOCK_CSS, /data-tone|--rr-tone|data-syncing|data-offline|rr-detail|rr-sync/);
});

test('the dock stays within 12 DOM nodes', () => {
  const { view } = setup();
  assert.ok(countNodes(view.host) <= 12, String(countNodes(view.host)));
});

test('click activates and stops propagation so Torn\'s sidebar handlers do not react', () => {
  const { button, activations } = setup();
  let stopped = false;
  let prevented = false;
  button.dispatchEvent({ type: 'click', target: button, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(activations.length, 1);
});

test('a capture-phase window click on the host activates once, before Torn sees it', () => {
  const { window, view, activations } = setup();
  let stopped = false;
  window.dispatch('click', { composedPath: () => [view.host, window], preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(activations.length, 1);
  assert.equal(stopped, true);
  window.dispatch('click', { composedPath: () => [window], preventDefault() {}, stopPropagation() {} });
  assert.equal(activations.length, 1, 'other clicks are ignored');
});

test('destroy removes the host, listeners and observer, and is idempotent', () => {
  const { document, window, view, button } = setup();
  assert.equal(window.listenerCount('resize'), 1);
  assert.equal(window.listenerCount('click'), 1);
  view.destroy();
  view.destroy();
  assert.equal(document.getElementById(HOST_ID), null);
  assert.equal(window.listenerCount('resize'), 0);
  assert.equal(window.listenerCount('click'), 0);
  assert.equal(button.listenerCount('click'), 0);
  assert.ok(window.observers.every(observer => observer.targets.length === 0));
  view.place();
  view.setExpanded(true);
  assert.equal(document.getElementById(HOST_ID), null);
});

test('mounting again replaces the previous dock instead of duplicating it', () => {
  const { document, window, view: first, sidebar } = setup();
  const second = mountDock({ document, window });
  window.dispatch('resize');
  assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 1);
  assert.equal(window.listenerCount('resize'), 1);
  assert.equal(first.host.parentNode, null);
  assert.equal(second.host.parentNode, sidebar);
});

test('theme follows Torn body class, then prefers-color-scheme; reduced motion is flagged', () => {
  const dark = setup({ media: { '(prefers-color-scheme: dark)': true, '(prefers-reduced-motion: reduce)': true } });
  assert.equal(dark.view.host.getAttribute('data-theme'), 'dark');
  assert.equal(dark.view.host.getAttribute('data-motion'), 'reduce');
  dark.document.body.classList.add('light-mode');
  dark.view.refreshTheme();
  assert.equal(dark.view.host.getAttribute('data-theme'), 'light');
  const light = setup();
  assert.equal(light.view.host.getAttribute('data-theme'), 'light');
  light.document.body.classList.add('dark-mode');
  assert.equal(detectTheme({ document: light.document, window: light.window }), 'dark');
});

test('the lite UI source never uses innerHTML', () => {
  for (const file of ['pill-view.js', 'icons.js', 'tokens.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lite', file), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/, file);
  }
});
