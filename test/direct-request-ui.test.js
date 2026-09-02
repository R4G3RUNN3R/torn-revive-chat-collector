const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'..','torn-revive-chat-collector.user.js'),'utf8');

test('main runtime is direct-only and exposes the exact Torn sidebar action',()=>{
  for(const required of [
    'ReviveRelay → Revive Me!',
    'Revive Me preset',
    'CERTIFIED REQUEST'
  ]) assert.match(source,new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));

  for(const forbidden of [
    'Shared public chat requests',
    'Live Capture',
    'Rescan public chats',
    'candidateOutbox',
    'discoverChats(',
    'attachObserver(',
    'handlePublicMessage(',
    '/v1/candidates'
  ]) assert.equal(source.includes(forbidden),false,forbidden);
});

test('sidebar one-click request validates the saved preset and posts only to ReviveRelay request API',()=>{
  assert.match(source,/ReviveRelayRequestPreset/);
  assert.match(source,/requestReviveFromSidebar/);
  assert.match(source,/validatePreset\(state\.preset\)/);
  assert.match(source,/state\.api\.createRequest\(validation\.preset\)/);
  assert.match(source,/submittingRequest/);
  assert.doesNotMatch(source,/requestReviveFromSidebar[\s\S]{0,1600}(?:api\.bind\(|apiKey|Torn API|chat)/i);
});

test('request preset is the only persisted revive request configuration and contains no credential fields',()=>{
  assert.match(source,/requestPreset:\s*'reviverelay_request_preset'/);
  assert.match(source,/GM_setValue\(KEYS\.requestPreset,\s*validation\.preset\)/);
  assert.doesNotMatch(source,/GM_setValue\([^\n]*(?:apiKey|tornKey|verificationKey|PRO_RECEIVER|receiverApiKey)/i);
});

test('requester path no longer requires transaction credential but reviver protected actions remain capability gated',()=>{
  const requestFn=source.match(/async function requestReviveFromSidebar\(\)\s*\{([\s\S]*?)\n\s*\}/)?.[1]||'';
  assert.ok(requestFn.length>0);
  assert.doesNotMatch(requestFn,/verificationCredential|hasCredentialCapability/);
  assert.match(source,/hasCredentialCapability\(['"]reviver['"]\)/);
  assert.match(source,/acceptMarketplaceRequest/);
});
