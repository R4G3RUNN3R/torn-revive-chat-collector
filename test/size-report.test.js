const test = require('node:test');
const assert = require('node:assert/strict');
const { measure, artifactText, LITE_CORE_BUDGET_BYTES, WHOLE_BUNDLE_CEILING_BYTES } = require('../scripts/size-report');
const { DIRECT_SUPPORT_MODULES, LEGACY_PANEL_MODULES } = require('../scripts/client-modules');

test('measure splits a bundle into the Lite core and the legacy panel', () => {
  const block = (modulePath, body) => `/* ReviveRelay bundled module: ${modulePath} */\n${body}\n/* ReviveRelay end bundled module: ${modulePath} */`;
  const text = `// header\n\n${DIRECT_SUPPORT_MODULES.map(modulePath => block(modulePath, LEGACY_PANEL_MODULES.includes(modulePath) ? 'legacy();' : 'core();')).join('\n\n')}\n(function main(){})();\n`;
  const sizes = measure(text);
  assert.equal(sizes.whole, Buffer.byteLength(text));
  assert.equal(sizes.main, Buffer.byteLength('\n(function main(){})();\n'));
  assert.equal(sizes.liteCore + sizes.legacyPanel, sizes.whole);
  assert.equal(sizes.liteCoreHeadroom, LITE_CORE_BUDGET_BYTES - sizes.liteCore);
  assert.equal(Object.keys(sizes.modules).length, DIRECT_SUPPORT_MODULES.length);
});

test('the real build is measured against the unchanged gates', () => {
  const sizes = measure(artifactText());
  assert.equal(LITE_CORE_BUDGET_BYTES, 110000);
  assert.equal(WHOLE_BUNDLE_CEILING_BYTES, 232000);
  assert.ok(sizes.liteCoreHeadroom >= 0, JSON.stringify(sizes));
  assert.ok(sizes.wholeHeadroom >= 0, JSON.stringify(sizes));
});
