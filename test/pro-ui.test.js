const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'..','torn-revive-chat-collector.user.js'),'utf8');

test('Pro UI renders server-owned plans and contains no authoritative launch pricing constants',()=>{
  assert.doesNotMatch(source,/PRO_LAUNCH_REFERENCE/);
  for(const text of [
    'Monthly: 10 Xanax or $10,000,000',
    '6 Months: 55 Xanax or $55,000,000',
    'Yearly: 100 Xanax or $100,000,000'
  ]) assert.equal(source.includes(text),false,text);
  assert.match(source,/state\.subscription/);
  assert.match(source,/state\.subscription\?\.plans/);
  const renderer=source.match(/function selectedPlanOptions\(\)\s*\{([\s\S]*?)\n\s*\}/)?.[1]||'';
  assert.ok(renderer.length>0);
  assert.match(renderer,/plan\.label/);
  assert.match(renderer,/plan\.xanax/);
  assert.match(renderer,/formatMoney\(plan\.cash\)/);
});

test('main uses the unified direct API transport for Pro and never embeds receiver credentials',()=>{
  assert.doesNotMatch(source,/ReviveRelayProClient|createProClient|state\.proApi/);
  assert.match(source,/state\.api\.getProStatus\(/);
  assert.match(source,/state\.api\.createProInvoice\(/);
  assert.match(source,/state\.api\.getProInvoice\(/);
  assert.match(source,/state\.api\.startProTrial\(/);
  assert.doesNotMatch(source,/PRO_RECEIVER_API_KEY|receiverApiKey|receiver-secret/);
});

test('free mode and active Pro modes may reach the reviver queue while review/live NONE remains gated',()=>{
  const access=source.match(/function hasReviverSubscriptionAccess\(\)\s*\{([\s\S]*?)\n\s*\}/)?.[1]||'';
  assert.ok(access.length>0);
  assert.match(access,/subscriptionMode\(\)\s*===\s*'free'/);
  assert.match(access,/isProActive\(\)/);
  const start=source.indexOf('async function refreshReviverQueue()');
  const end=source.indexOf('async function refreshCurrentInvoice()',start);
  const queueFn=start>=0 && end>start ? source.slice(start,end) : '';
  assert.ok(queueFn.length>0);
  assert.match(queueFn,/hasReviverSubscriptionAccess\(\)/);
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
