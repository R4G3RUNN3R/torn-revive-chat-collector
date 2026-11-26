(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteIcons = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEW_BOX = '0 0 24 24';

  // Static, trusted path data (24 × 24 grid, 2 px round strokes, currentColor).
  const ICON_PATHS = Object.freeze({
    heartbeat: Object.freeze(['M3 12h4l2-5 4 10 2-5h6']),
    clock: Object.freeze(['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 7v5l3 2']),
    plane: Object.freeze(['M3 11l18-7-7 18-3-8-8-3z']),
    'user-check': Object.freeze(['M9 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8z', 'M2 21v-1a6 6 0 0 1 12 0v1', 'M16 11l2 2 4-4']),
    check: Object.freeze(['M5 12l5 5 9-10']),
    alert: Object.freeze(['M12 3l10 18H2L12 3z', 'M12 10v4', 'M12 17.5v.5']),
    refund: Object.freeze(['M4 9h12a4 4 0 0 1 0 8h-6', 'M8 5L4 9l4 4']),
    settings: Object.freeze(['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1']),
    close: Object.freeze(['M6 6l12 12M18 6L6 18']),
    chevron: Object.freeze(['M9 6l6 6-6 6']),
    bell: Object.freeze(['M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2z', 'M10 21h4']),
    bolt: Object.freeze(['M13 2L4 14h7l-1 8 9-12h-7l1-8z']),
    shield: Object.freeze(['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z']),
    cash: Object.freeze(['M2 6h20v12H2z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z']),
    pill: Object.freeze(['M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7l7-7z', 'M7 7l10 10']),
    external: Object.freeze(['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'])
  });
  const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS));
  const SIZES = Object.freeze([16, 20]);

  function resolveName(name) {
    return Object.prototype.hasOwnProperty.call(ICON_PATHS, name) ? name : 'pill';
  }

  function resolveSize(size) {
    return SIZES.includes(Number(size)) ? Number(size) : 16;
  }

  function svgAttributes(name, size) {
    return [
      ['xmlns', SVG_NS],
      ['viewBox', VIEW_BOX],
      ['width', String(size)],
      ['height', String(size)],
      ['fill', 'none'],
      ['stroke', 'currentColor'],
      ['stroke-width', '2'],
      ['stroke-linecap', 'round'],
      ['stroke-linejoin', 'round'],
      ['aria-hidden', 'true'],
      ['focusable', 'false'],
      ['data-rr-icon', name]
    ];
  }

  // Static SVG string for a bundled icon. Only ever built from ICON_PATHS, never from data.
  function iconMarkup(name, size = 16) {
    const key = resolveName(name);
    const px = resolveSize(size);
    const attrs = svgAttributes(key, px).map(([attr, value]) => `${attr}="${value}"`).join(' ');
    const paths = ICON_PATHS[key].map(d => `<path d="${d}"/>`).join('');
    return `<svg ${attrs}>${paths}</svg>`;
  }

  // Builds the same icon as DOM nodes; no HTML string is ever parsed.
  function createIcon(document, name, size = 16) {
    const key = resolveName(name);
    const px = resolveSize(size);
    const svg = document.createElementNS(SVG_NS, 'svg');
    for (const [attr, value] of svgAttributes(key, px)) {
      if (attr !== 'xmlns') svg.setAttribute(attr, value);
    }
    for (const d of ICON_PATHS[key]) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }

  return Object.freeze({ SVG_NS, ICON_NAMES, ICON_PATHS, SIZES, iconMarkup, createIcon });
});
