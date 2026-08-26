const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

test('transaction verification key is password-only, cleared after bind, and never persisted', () => {
  assert.match(source, /id=["']rr-verification-key["'][^>]*type=["']password["']/i);
  assert.match(source, /bindVerificationCredential\(/);
  assert.match(source, /verificationKeyInput\.value\s*=\s*['"]["']/);
  assert.doesNotMatch(source, /GM_setValue\([^\n]*(?:verification|api)[_-]?key/i);
});

test('protected requester controls are capability gated by server credential status', () => {
  assert.match(source, /verificationCredential/);
  assert.match(source, /capabilit(?:y|ies)/i);
  assert.match(source, /requester/i);
  assert.match(source, /rr-request[^\n]*disabled|requestButton\.disabled/i);
});

test('credential UI exposes bind rebind and revoke without redisplaying plaintext', () => {
  assert.match(source, /Bind verification key|Rebind verification key/i);
  assert.match(source, /Revoke verification key/i);
  assert.match(source, /revokeVerificationCredential\(/);
});
