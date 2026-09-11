const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readDoc(name) {
  return fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
}

test('README does not describe a separate requester/reviver key model', () => {
  const readme = readDoc('README.md');
  assert.doesNotMatch(readme, /recommended requester key/i);
  assert.doesNotMatch(readme, /recommended reviver\/combined key/i);
  assert.doesNotMatch(readme, /separate persistent credential/i);
  assert.match(readme, /one Torn API key/i);
});

test('PRIVACY.md does not describe a separate stored verification key distinct from the identity key', () => {
  const privacy = readDoc('PRIVACY.md');
  assert.doesNotMatch(privacy, /separate\s+\*\*?ReviveRelay Verification\*\*?\s+key/i);
  assert.match(privacy, /same.{0,40}Torn API key/i);
});

test('TORN-API-DISCLOSURE.md does not describe a separate one-time identity key plus a distinct stored verification key', () => {
  const disclosure = readDoc('TORN-API-DISCLOSURE.md');
  assert.doesNotMatch(disclosure, /one-time identity key is not stored\. A separate/i);
  assert.doesNotMatch(disclosure, /reviver key also satisfies requester/i);
  assert.match(disclosure, /same.{0,40}Torn API key/i);
});
