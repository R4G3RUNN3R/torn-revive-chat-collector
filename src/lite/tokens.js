(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteTokens = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACCENT = '#a4161a';
  const ACCENT_DARK = '#fa6a6f';

  const LIGHT = Object.freeze({
    accent: ACCENT,
    surface: '#ffffff',
    'surface-raised': '#f2f2f2',
    text: '#333333',
    'text-muted': '#666666',
    border: '#cccccc',
    'tone-neutral': '#666666',
    'tone-waiting': '#965f0f',
    'tone-action': '#6b46c1',
    'tone-progress': '#2b6cb0',
    'tone-success': '#276749',
    'tone-attention': '#a84a1a',
    elevation: '0 4px 12px rgba(0,0,0,.18)'
  });

  const DARK = Object.freeze({
    accent: ACCENT_DARK,
    surface: '#222222',
    'surface-raised': '#2e2e2e',
    text: '#dddddd',
    'text-muted': '#999999',
    border: '#444444',
    'tone-neutral': '#999999',
    'tone-waiting': '#f6c453',
    'tone-action': '#b794f4',
    'tone-progress': '#63b3ed',
    'tone-success': '#68d391',
    'tone-attention': '#f6ad55',
    elevation: '0 4px 12px rgba(0,0,0,.5)'
  });

  const MOTION = Object.freeze({ fast: '120ms', slow: '250ms' });

  function declarations(set) {
    return Object.entries(set).map(([name, value]) => `--rr-${name}:${value}`).join(';');
  }

  const TOKENS_CSS = [
    `:host{${declarations(LIGHT)};--rr-weight-regular:400;--rr-weight-strong:700;--rr-motion-fast:${MOTION.fast};--rr-motion-slow:${MOTION.slow}}`,
    `:host([data-theme="dark"]){${declarations(DARK)}}`,
    '@media (prefers-reduced-motion: reduce){:host{--rr-motion-fast:0ms;--rr-motion-slow:0ms}}',
    ':host([data-motion="reduce"]){--rr-motion-fast:0ms;--rr-motion-slow:0ms}'
  ].join('\n');

  return Object.freeze({ ACCENT, ACCENT_DARK, LIGHT, DARK, MOTION, TOKENS_CSS });
});
