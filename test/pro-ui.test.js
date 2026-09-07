const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'..','torn-revive-chat-collector.user.js'),'utf8');

test('Pro UI contains approved trial and launch reference pricing',()=>{
  for(const text of [
    'Start 7-day Reviver Pro trial',
    '10 Xanax', '$10,000,000',
    '55 Xanax', '$55,000,000',
    '100 Xanax', '$100,000,000'
  ]) assert.ok(source.includes(text),text);
});

test('main uses the unified direct API transport for Pro and never embeds receiver credentials',()=>{
  assert.doesNotMatch(source,/ReviveRelayProClient|createProClient|state\.proApi/);
  assert.match(source,/state\.api\.getProStatus\(/);
  assert.match(source,/state\.api\.getProPlans\(/);
  assert.match(source,/state\.api\.createProInvoice\(/);
  assert.match(source,/state\.api\.getProInvoice\(/);
  assert.match(source,/state\.api\.startProTrial\(/);
  assert.doesNotMatch(source,/PRO_RECEIVER_API_KEY|receiverApiKey|receiver-secret/);
});

test('Free users never poll the reviver queue and Trial or Active users may',()=>{
  const start=source.indexOf('async function refreshReviverQueue()');
  const end=source.indexOf('async function refreshCurrentInvoice()',start);
  const queueFn=start>=0 && end>start ? source.slice(start,end) : '';
  assert.ok(queueFn.length>0);
  assert.match(queueFn,/isProActive\(\)/);
  assert.match(queueFn,/state\.api\.getReviverQueue\(/);
  assert.match(source,/state\.proStatus\?\.state === 'TRIAL'|state\.proStatus\?\.state === "TRIAL"/);
  assert.match(source,/state\.proStatus\?\.state === 'ACTIVE'|state\.proStatus\?\.state === "ACTIVE"/);
});

test('certified queue cards render star, certification chip, identity, offer, comment and Accept',()=>{
  assert.match(source,/★/);
  assert.match(source,/CERTIFIED REQUEST/);
  assert.match(source,/requesterName/);
  assert.match(source,/requesterTornId/);
  assert.match(source,/request\.comment/);
  assert.match(source,/request\.offerAmount/);
  assert.match(source,/data-rr-accept/);
});

test('Pro queue notifications are bounded, persisted, Pro-only and never auto-accept',()=>{
  assert.match(source,/@grant\s+GM_notification/);
  assert.match(source,/seenRequestIds:\s*'reviverelay_seen_request_ids'/);
  assert.match(source,/MAX_SEEN_REQUEST_IDS\s*=\s*200/);
  assert.match(source,/GM_notification\(/);
  assert.match(source,/notifyNewQueueRequests/);
  assert.match(source,/activatePanelTab\(['"]reviver['"]/);
  const notifyFn=source.match(/function notifyNewQueueRequests\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/)?.[1]||'';
  assert.ok(notifyFn.length>0);
  assert.doesNotMatch(notifyFn,/acceptRequest|acceptMarketplaceRequest/);
});
