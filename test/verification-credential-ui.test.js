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

test('free requester request creation is not blocked by credential state while later acceptance remains evidence-gated', () => {
  const requestStart=source.indexOf('async function requestReviveFromSidebar()');
  const requestEnd=source.indexOf('async function cancelActiveRequest()',requestStart);
  const requestFn=requestStart>=0 && requestEnd>requestStart ? source.slice(requestStart,requestEnd) : '';
  assert.ok(requestFn.length>0);
  assert.match(requestFn,/if \(!state\.sessionToken \|\| !validation\.ok \|\| state\.submittingRequest \|\| state\.activeRequest\) return/);
  assert.doesNotMatch(requestFn,/if \([^\n]*(?:verificationCredential|hasCredentialCapability)/);
  assert.match(requestFn,/hasCredentialCapability\(['"]requester['"]\)/);
  assert.match(source,/hasCredentialCapability\(['"]reviver['"]\)/);
  assert.match(source,/REQUESTER_VERIFICATION_REQUIRED/);
  assert.match(source,/acceptMarketplaceRequest/);
});

test('credential UI uses clear Reviver Verification actions without redisplaying plaintext', () => {
  assert.match(source, /Connect Torn API key|Replace verification key/i);
  assert.match(source, /Revoke verification key/i);
  assert.match(source, /revokeVerificationCredential\(/);
});
