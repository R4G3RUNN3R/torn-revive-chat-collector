const test = require('node:test');
const assert = require('node:assert/strict');
const { SVG_NS, ICON_NAMES, ICON_PATHS, iconMarkup, createIcon } = require('../src/lite/icons');
const { ACCENT, LIGHT, DARK, MOTION, TOKENS_CSS } = require('../src/lite/tokens');
const { createFakeDocument } = require('./helpers/fake-dom');

const SPEC_ICONS = ['heartbeat', 'clock', 'plane', 'user-check', 'check', 'alert', 'refund', 'settings', 'close', 'chevron', 'bell', 'bolt', 'shield', 'cash', 'pill', 'external'];

test('the bundled icon set is exactly the 16 spec icons', () => {
  assert.deepEqual([...ICON_NAMES].sort(), [...SPEC_ICONS].sort());
  assert.equal(Object.isFrozen(ICON_PATHS), true);
});

test('every icon string is static, currentColor, 24-unit and script-free', () => {
  for (const name of ICON_NAMES) {
    for (const size of [16, 20]) {
      const svg = iconMarkup(name, size);
      assert.match(svg, /^<svg [^>]*viewBox="0 0 24 24"/);
      assert.match(svg, /stroke="currentColor"/);
      assert.match(svg, new RegExp(`width="${size}" height="${size}"`));
      assert.match(svg, /aria-hidden="true"/);
      assert.doesNotMatch(svg, /<script|on\w+=|javascript:|href=/i);
      for (const d of ICON_PATHS[name]) assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/);
    }
  }
});

test('unknown icon names and sizes fall back safely', () => {
  assert.match(iconMarkup('<img onerror=1>', 99), /data-rr-icon="pill"/);
  assert.match(iconMarkup('check', 99), /width="16"/);
});

test('createIcon builds SVG nodes without parsing markup', () => {
  const document = createFakeDocument();
  const svg = createIcon(document, 'clock', 20);
  assert.equal(svg.namespaceURI, SVG_NS);
  assert.equal(svg.localName, 'svg');
  assert.equal(svg.getAttribute('stroke'), 'currentColor');
  assert.equal(svg.getAttribute('width'), '20');
  assert.equal(svg.getAttribute('data-rr-icon'), 'clock');
  assert.equal(svg.childNodes.length, ICON_PATHS.clock.length);
  assert.deepEqual(svg.childNodes.map(path => path.getAttribute('d')), [...ICON_PATHS.clock]);
  assert.equal(svg.childNodes.every(path => path.namespaceURI === SVG_NS), true);
});

test('tokens: brand accent, every tone in light and dark, motion 120–250 ms', () => {
  assert.equal(ACCENT, '#a4161a');
  assert.equal(LIGHT.accent, '#a4161a');
  assert.notEqual(DARK.accent, '#a4161a');
  for (const tone of ['neutral', 'waiting', 'action', 'progress', 'success', 'attention']) {
    assert.ok(LIGHT[`tone-${tone}`], tone);
    assert.ok(DARK[`tone-${tone}`], tone);
    assert.match(TOKENS_CSS, new RegExp(`--rr-tone-${tone}:`));
  }
  assert.deepEqual(MOTION, { fast: '120ms', slow: '250ms' });
  assert.match(TOKENS_CSS, /:host\(\[data-theme="dark"\]\)/);
  assert.match(TOKENS_CSS, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(TOKENS_CSS, /--rr-tone-attention:#a4161a|--rr-tone-attention:#e5484d/);
});

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('tokens: accent and every tone reach WCAG AA (4.5:1) on both surfaces in both themes', () => {
  for (const [theme, set] of [['light', LIGHT], ['dark', DARK]]) {
    const colours = ['accent', ...['neutral', 'waiting', 'action', 'progress', 'success', 'attention'].map(t => `tone-${t}`)];
    for (const name of colours) {
      for (const surface of ['surface', 'surface-raised']) {
        assert.match(set[name], /^#[0-9a-f]{6}$/i, `${theme} ${name}`);
        const ratio = contrast(set[name], set[surface]);
        assert.ok(ratio >= 4.5, `${theme} ${name} ${set[name]} on ${surface} ${set[surface]} = ${ratio.toFixed(2)}`);
      }
    }
  }
});
