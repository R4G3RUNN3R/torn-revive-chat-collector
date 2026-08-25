const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

test('ReviveRelay onboarding binds a Torn key but persists only the opaque ReviveRelay session', () => {
  assert.match(source, /ReviveRelay/i);
  assert.match(source, /Verify\s*(?:&|&amp;)\s*;?\s*connect/i);
  assert.match(source, /\.bind\(/);
  assert.match(source, /sessionToken/);
  assert.match(source, /GM_setValue\(KEYS\.sessionToken/);
  assert.doesNotMatch(source, /GM_setValue\([^\n]*(?:apiKey|tornKey)/i);
  assert.match(source, /apiKeyInput\.value\s*=\s*['"]{2}/);
  assert.match(source, /getMe\(\)/);
});
