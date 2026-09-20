const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'..','torn-revive-chat-collector.user.js'),'utf8');

function functionSlice(name,nextName) {
  const prefixes=[`function ${name}`,`async function ${name}`];
  const positions=prefixes.map(prefix=>source.indexOf(prefix)).filter(index=>index>=0);
  const start=positions.length?Math.min(...positions):-1;
  if(start<0) return '';
  const candidates=nextName
    ? [`function ${nextName}`,`async function ${nextName}`].map(prefix=>source.indexOf(prefix,start+1)).filter(index=>index>start)
    : [];
  const end=candidates.length?Math.min(...candidates):source.length;
  return source.slice(start,end);
}

test('Settings includes About & Privacy with required disclosures and document links',()=>{
  const settings=functionSlice('renderSettingsDrawer','renderSummary');
  assert.ok(settings.length>0);
  for(const text of [
    'Version',
    'Release channel',
    'Torn API',
    'Data stored',
    'encrypted at rest',
    'Recommended permissions',
    'Broad/Full Access',
    'Subscription terms',
    'Payment recipient',
    'Diagnostics',
    'Revoke the Torn API key',
    'Delete ReviveRelay account/data'
  ]) assert.match(settings,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),text);
  assert.match(settings,/About &(?:amp;)? Privacy/i);
  assert.match(settings,/state\.subscription\?\.merchant/);
  assert.match(settings,/VERSION/);
  assert.match(settings,/UPDATE_CHANNEL/);
  assert.match(settings,/PRIVACY\.md/i);
  assert.match(settings,/docs\/review/i);
});

test('account deletion explains immediate deletion versus retained minimal billing and security evidence',()=>{
  const deletion=functionSlice('deleteReviveRelayAccount','saveRequestPreset');
  assert.ok(deletion.length>0);
  assert.match(deletion,/immediately/i);
  assert.match(deletion,/verification credential|sessions|preferences|reviver registration/i);
  assert.match(deletion,/minimal/i);
  assert.match(deletion,/billing|payment/i);
  assert.match(deletion,/security|audit|dispute/i);
  assert.match(deletion,/retained/i);
  assert.match(deletion,/window\.confirm/);
  assert.match(deletion,/state\.api\.deleteAccount\(\)/);
  assert.match(deletion,/storage\.set\(KEYS\.sessionToken,\s*''\)/);
  assert.match(deletion,/storage\.set\(KEYS\.requestPreset,\s*null\)/);
  assert.match(deletion,/storage\.set\(KEYS\.clientDiagnosticsEnabled,\s*false\)/);
  assert.match(deletion,/runMutation\('account-delete'/);
});

test('account delete control is disabled while deletion is in flight',()=>{
  assert.match(source,/disabledAttr\('account-delete'\)/);
});

test('Torn API key revoke guidance also tells users to delete the key in Torn API settings',()=>{
  const verification=functionSlice('renderVerificationSettings','renderProPanel');
  assert.ok(verification.length>0);
  assert.match(verification,/Disconnect Torn API key/i);
  assert.match(verification,/delete.*Torn API settings|Torn API settings.*delete/i);
  assert.match(verification,/preferences\.php#tab=api/i);
});

test('About & Privacy repeats diagnostics opt-in state and no Torn password disclosure',()=>{
  const settings=functionSlice('renderSettingsDrawer','renderSummary');
  assert.match(settings,/No Torn password/i);
  assert.match(settings,/diagnostics.*off by default|off by default.*diagnostics/i);
  assert.match(settings,/not sold|unrelated third parties/i);
  assert.match(settings,/plaintext credentials.*never returned|never returned.*plaintext credentials/i);
});


test('account deletion clears the direct client in-memory bound token',()=>{
  const deletion=functionSlice('deleteReviveRelayAccount','saveRequestPreset');
  assert.ok(deletion.length>0);
  assert.match(deletion,/state\.api\.clearBoundToken\(\)/);
});
