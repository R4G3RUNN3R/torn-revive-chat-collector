const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECT_SUPPORT_MODULES, LEGACY_PANEL_MODULES } = require('../scripts/client-modules');

// Spec "Performance budgets": bundled userscript ≤ 110 KB unminified (1 KB = 1000 bytes, as in
// the spec's "172 KB" for the 172,402-byte 0.7.3 build). Plan 3a ships the legacy 0.7 panel
// beside the Lite engine (owner decision "Staged: core first"), so the 110 KB budget gates the
// Lite core: the whole bundle minus the legacy panel (MAIN's IIFE and LEGACY_PANEL_MODULES).
// The whole bundle is held to a ratchet ceiling until Plan 3b deletes the panel and moves the
// 110 KB budget onto the whole file.
const LITE_CORE_BUDGET_BYTES = 110000;
const WHOLE_BUNDLE_CEILING_BYTES = 232000;

const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const artifact = fs.readFileSync(path.join(root, 'dist', 'review', `ReviveRelay-${version}.user.js`));
const text = artifact.toString('utf8');

function bundledBlockBytes(relativePath) {
  const start = text.indexOf(`/* ReviveRelay bundled module: ${relativePath} */`);
  const endMarker = `/* ReviveRelay end bundled module: ${relativePath} */`;
  const end = text.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, relativePath);
  return Buffer.byteLength(text.slice(start, end + endMarker.length));
}

function mainBodyBytes() {
  const lastEnd = `/* ReviveRelay end bundled module: ${DIRECT_SUPPORT_MODULES[DIRECT_SUPPORT_MODULES.length - 1]} */`;
  const index = text.indexOf(lastEnd);
  assert.ok(index > 0);
  return Buffer.byteLength(text.slice(index + lastEnd.length));
}

function report() {
  const whole = artifact.length;
  const legacyPanel = mainBodyBytes() + LEGACY_PANEL_MODULES.reduce((sum, modulePath) => sum + bundledBlockBytes(modulePath), 0);
  return { whole, legacyPanel, liteCore: whole - legacyPanel };
}

test('the Lite core of the real built bundle fits the 110 KB unminified budget', () => {
  const sizes = report();
  assert.ok(sizes.liteCore <= LITE_CORE_BUDGET_BYTES, `Lite core ${sizes.liteCore} bytes > ${LITE_CORE_BUDGET_BYTES} (${JSON.stringify(sizes)})`);
});

test('the whole 1.0 bundle stays under the Plan 3a ratchet ceiling', () => {
  const sizes = report();
  assert.ok(sizes.whole <= WHOLE_BUNDLE_CEILING_BYTES, `bundle ${sizes.whole} bytes > ${WHOLE_BUNDLE_CEILING_BYTES} (${JSON.stringify(sizes)})`);
});

test('the bundle is unminified: bundled modules keep their source bytes and MAIN keeps its line structure', () => {
  for (const modulePath of DIRECT_SUPPORT_MODULES) {
    const source = fs.readFileSync(path.join(root, modulePath), 'utf8');
    assert.ok(text.includes(source), modulePath);
  }
  const longest = Math.max(...text.split('\n').map(line => line.length));
  assert.ok(longest < 4000, `longest line ${longest}`);
});

