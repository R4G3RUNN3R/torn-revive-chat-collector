const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {DIRECT_SUPPORT_MODULES}=require('../scripts/client-modules');

test('legacy Pro client is not a production dependency in 0.6.0',()=>{
  const source=fs.readFileSync('torn-revive-chat-collector.user.js','utf8');
  assert.equal(DIRECT_SUPPORT_MODULES.includes('src/pro-client.js'),false);
  assert.doesNotMatch(source,/ReviveRelayProClient|createProClient|state\.proApi/);
  assert.match(source,/ReviveRelayDirectApiClient/);
  assert.match(source,/state\.api\.getProStatus\(/);
  assert.match(source,/state\.api\.getProPlans\(/);
  assert.match(source,/state\.api\.createProInvoice\(/);
  assert.match(source,/state\.api\.getProInvoice\(/);
  assert.match(source,/state\.api\.startProTrial\(/);
});
