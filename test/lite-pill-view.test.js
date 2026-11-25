const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HOST_ID, HEADER_SLOT_SELECTORS, PILL_CSS, detectTheme, mountPill } = require('../src/lite/pill-view');
const { derivePill } = require('../src/lite/pill-state');
const { createFakeDocument, createFakeWindow, countNodes } = require('./helpers/fake-dom');

const NOW = Date.parse('2026-11-25T12:00:00.000Z');

function idleSnapshot(online = 3) {
  return {
    stateVersion: '0123456789abcdef',
    me: { tornId: 1, name: 'P', roles: ['requester'], verification: { usable: true, requester: true, reviver: false } },
    activeRequest: null,
    activeTransactions: [],
    revivers: { online },
    queue: null
  };
}

function setup({ header = true, headerWidth = 300, media = {} } = {}) {
  const document = createFakeDocument();
  const window = createFakeWindow({ media });
  let slot = null;
  if (header) {
    slot = document.createElement('div');
    slot.setAttribute('id', 'rr-test-header');
    slot.rect.width = headerWidth;
    document.body.appendChild(slot);
  }
  const activations = [];
  const view = mountPill({ document, window, onActivate: () => activations.push(1), headerSelectors: ['#rr-test-header'] });
  const button = view.shadow.querySelector('.rr-pill');
  return { document, window, slot, view, button, activations };
}

test('mounts one shadow-root host in the header slot', () => {
  const { document, slot, view } = setup();
  assert.equal(view.host.getAttribute('id'), HOST_ID);
  assert.equal(view.host.parentNode, slot);
  assert.equal(view.placement(), 'header');
  assert.equal(view.shadow.mode, 'closed');
  assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 1);
  assert.ok(Array.isArray(HEADER_SLOT_SELECTORS) && HEADER_SLOT_SELECTORS.length > 0);
});

test('falls back to the launcher position when the header slot is missing or too narrow', () => {
  const missing = setup({ header: false });
  assert.equal(missing.view.placement(), 'launcher');
  assert.equal(missing.view.host.parentNode, missing.document.body);
  const narrow = setup({ headerWidth: 0 });
  assert.equal(narrow.view.placement(), 'launcher');
  assert.match(PILL_CSS, /:host\(\[data-rr-placement="launcher"\]\)\{position:fixed/);
});

test('re-checks the slot on resize', () => {
  const { window, slot, view } = setup({ headerWidth: 0 });
  assert.equal(view.placement(), 'launcher');
  slot.rect.width = 300;
  window.dispatch('resize');
  assert.equal(view.placement(), 'header');
  assert.equal(view.host.parentNode, slot);
});

test('renders a view model with textContent and attributes', () => {
  const { view, button } = setup();
  view.update(derivePill(idleSnapshot(), 'live', NOW));
  assert.equal(button.getAttribute('data-tone'), 'neutral');
  assert.equal(button.getAttribute('data-syncing'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'ReviveRelay: Revive me · 3 online');
  assert.equal(button.querySelector('.rr-label').textContent, 'Revive me');
  assert.equal(button.querySelector('.rr-detail').textContent, '3 online');
  assert.equal(button.querySelector('.rr-icon').firstChild.getAttribute('data-rr-icon'), 'heartbeat');
});

test('player names are rendered as text, never parsed as markup', () => {
  const { view, button } = setup();
  const hostile = '<img src=x onerror=alert(1)>';
  view.update({ label: `Pay ${hostile}`, detail: '1:00 left', text: `Pay ${hostile} · 1:00 left`, tone: 'action', icon: 'cash', syncing: false, offline: false });
  const label = button.querySelector('.rr-label');
  assert.equal(label.textContent, `Pay ${hostile}`);
  assert.equal(label.childNodes.length, 1);
  assert.equal(label.childNodes[0].nodeType, 3);
  assert.equal(button.querySelector('img'), null);
});

test('updates patch only what changed', () => {
  const { document, view } = setup();
  const vm = derivePill(idleSnapshot(), 'live', NOW);
  view.update(vm);
  const before = document.mutations;
  view.update(derivePill(idleSnapshot(), 'live', NOW));
  assert.equal(document.mutations, before);
  view.update(derivePill(idleSnapshot(5), 'live', NOW));
  assert.equal(document.mutations, before + 2);
});

test('syncing and offline states are reflected on the pill', () => {
  const { view, button } = setup();
  view.update(derivePill(idleSnapshot(), 'syncing', NOW));
  assert.equal(button.getAttribute('data-syncing'), 'true');
  assert.match(button.getAttribute('aria-label'), /\(syncing\)$/);
  view.update(derivePill(idleSnapshot(), 'offline', NOW));
  assert.equal(button.getAttribute('data-offline'), 'true');
  assert.equal(button.querySelector('.rr-label').textContent, 'Offline');
  assert.equal(button.querySelector('.rr-icon').firstChild.getAttribute('data-rr-icon'), 'alert');
  assert.equal(button.querySelector('.rr-icon').childNodes.length, 1);
});

test('collapsed pill stays within 30 DOM nodes in every icon state', () => {
  const { view } = setup();
  for (const icon of ['heartbeat', 'clock', 'cash', 'check', 'alert', 'refund', 'bolt', 'shield', 'settings', 'pill', 'user-check']) {
    view.update({ label: 'Label', detail: '1:00 left', text: 'Label · 1:00 left', tone: 'waiting', icon, syncing: true, offline: false });
    assert.ok(countNodes(view.host) <= 30, `${icon}: ${countNodes(view.host)} nodes`);
  }
});

test('click activates; destroy removes host and listeners and is idempotent', () => {
  const { document, window, view, button, activations } = setup();
  button.click();
  assert.equal(activations.length, 1);
  assert.equal(window.listenerCount('resize'), 1);
  view.destroy();
  view.destroy();
  assert.equal(document.getElementById(HOST_ID), null);
  assert.equal(window.listenerCount('resize'), 0);
  assert.equal(button.listenerCount('click'), 0);
  view.update(derivePill(idleSnapshot(), 'live', NOW));
});

test('mounting again replaces a leftover host instead of duplicating it', () => {
  const { document, window } = setup();
  mountPill({ document, window, headerSelectors: ['#rr-test-header'] });
  assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 1);
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
  assert.equal(light.view.host.getAttribute('data-motion'), 'full');
  light.document.body.classList.add('dark-mode');
  assert.equal(detectTheme({ document: light.document, window: light.window }), 'dark');
});

test('the lite UI source never uses innerHTML', () => {
  for (const file of ['pill-view.js', 'icons.js', 'tokens.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lite', file), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/, file);
  }
});

test('remounting without destroy tears down the previous instance', () => {
  const { document, window, view: first } = setup();
  const second = mountPill({ document, window, headerSelectors: ['#rr-test-header'] });
  window.dispatch('resize');
  assert.equal(document.querySelectorAll(`#${HOST_ID}`).length, 1);
  assert.equal(window.listenerCount('resize'), 1);
  assert.equal(first.host.parentNode, null);
  const before = document.mutations;
  first.update(derivePill(idleSnapshot(), 'live', NOW));
  assert.equal(document.mutations, before);
  assert.equal(second.host.parentNode.getAttribute('id'), 'rr-test-header');
});

test('motion CSS: only opacity/transform transitions, token durations, no infinite animation', () => {
  assert.doesNotMatch(PILL_CSS, /infinite/);
  assert.doesNotMatch(PILL_CSS, /rr-pulse/);
  const transitions = [...PILL_CSS.matchAll(/transition:([^;}]*)/g)].map(m => m[1]).filter(v => v !== 'none');
  assert.ok(transitions.length > 0);
  for (const value of transitions) {
    for (const part of value.split(',')) {
      assert.match(part.trim(), /^(opacity|transform)\s/, part);
    }
  }
  const durations = [...PILL_CSS.matchAll(/(?:transition|animation)(?:-duration)?:[^;}]*/g)].join(' ').match(/\b\d+(?:\.\d+)?m?s\b/g) || [];
  for (const d of durations) {
    const ms = d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000;
    assert.ok(ms === 0 || (ms >= 120 && ms <= 250), d);
  }
  assert.match(PILL_CSS, /prefers-reduced-motion: reduce/);
  assert.match(PILL_CSS, /data-motion="reduce"/);
});

test('button has a default aria-label before the first update', () => {
  const { button } = setup();
  assert.equal(button.getAttribute('aria-label'), 'ReviveRelay');
});

test('coarse-pointer 44px target applies to the launcher placement only', () => {
  const match = PILL_CSS.match(/@media \(pointer: coarse\)\{([^@]*)\}/);
  assert.ok(match, 'coarse-pointer rule present');
  assert.match(match[1], /:host\(\[data-rr-placement="launcher"\]\) \.rr-pill\{min-height:44px\}/);
  assert.doesNotMatch(match[1].replace(/:host\(\[data-rr-placement="launcher"\]\) \.rr-pill/, ''), /\.rr-pill\{min-height/);
});

test('click stops propagation so Torn header handlers do not react', () => {
  const { button, activations } = setup();
  let stopped = false;
  let prevented = false;
  button.dispatchEvent({ type: 'click', target: button, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(activations.length, 1);
});
