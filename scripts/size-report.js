'use strict';

// Lite core and whole-bundle sizes of a built ReviveRelay artifact (spec decision 14).
// Lite core = the whole file minus the legacy 0.7 panel (MAIN's IIFE and LEGACY_PANEL_MODULES).
const fs = require('node:fs');
const path = require('node:path');
const { DIRECT_SUPPORT_MODULES, LEGACY_PANEL_MODULES } = require('./client-modules');

const root = path.resolve(__dirname, '..');
const LITE_CORE_BUDGET_BYTES = 110000;
const WHOLE_BUNDLE_CEILING_BYTES = 232000;

function blockBytes(text, relativePath) {
  const startMarker = `/* ReviveRelay bundled module: ${relativePath} */`;
  const endMarker = `/* ReviveRelay end bundled module: ${relativePath} */`;
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  if (start < 0 || end < start) throw new Error(`module not bundled: ${relativePath}`);
  return Buffer.byteLength(text.slice(start, end + endMarker.length));
}

function measure(text) {
  const lastEnd = `/* ReviveRelay end bundled module: ${DIRECT_SUPPORT_MODULES[DIRECT_SUPPORT_MODULES.length - 1]} */`;
  const mainStart = text.indexOf(lastEnd);
  if (mainStart < 0) throw new Error('bundle has no module section');
  const main = Buffer.byteLength(text.slice(mainStart + lastEnd.length));
  const modules = {};
  for (const modulePath of DIRECT_SUPPORT_MODULES) modules[modulePath] = blockBytes(text, modulePath);
  const legacyPanel = main + LEGACY_PANEL_MODULES.reduce((sum, modulePath) => sum + modules[modulePath], 0);
  const whole = Buffer.byteLength(text);
  const liteCore = whole - legacyPanel;
  return {
    whole,
    liteCore,
    legacyPanel,
    main,
    liteCoreHeadroom: LITE_CORE_BUDGET_BYTES - liteCore,
    wholeHeadroom: WHOLE_BUNDLE_CEILING_BYTES - whole,
    modules
  };
}

function artifactText(version = require('../package.json').version) {
  return fs.readFileSync(path.join(root, 'dist', 'review', `ReviveRelay-${version}.user.js`), 'utf8');
}

if (require.main === module) console.log(JSON.stringify(measure(artifactText()), null, 2));

module.exports = { LITE_CORE_BUDGET_BYTES, WHOLE_BUNDLE_CEILING_BYTES, measure, artifactText };
