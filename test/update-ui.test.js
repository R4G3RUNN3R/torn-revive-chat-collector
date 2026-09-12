const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('userscript exposes channel-scoped update status UX and bundles updater dependencies safely',()=>{
  const source=fs.readFileSync('torn-revive-chat-collector.user.js','utf8');
  const version=require('../package.json').version;
  const artifact=fs.readFileSync(`dist/review/ReviveRelay-${version}.user.js`,'utf8');
  for(const path of ['src/versioning.js','src/update-manager.js']) {
    assert.match(artifact,new RegExp(`ReviveRelay bundled module: ${path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));
  }
  for(const token of ['rr-update-current','rr-update-channel','rr-update-latest','rr-update-checked','rr-update-check','rr-update-banner','ReviveRelayUpdateManager','clientVersion: VERSION','releaseChannel: UPDATE_CHANNEL']) {
    assert.match(source,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.doesNotMatch(source,/rr-update-switch|switchUpdateChannel|switchChannel\(/);
  assert.match(artifact,/const UPDATE_CHANNEL = 'review'/);
  assert.doesNotMatch(source,/eval\s*\(|new Function\s*\(/);
});

test('userscript checks the permanent dist metadata feed directly rather than using the API version manifest for update discovery', () => {
  const source=fs.readFileSync('torn-revive-chat-collector.user.js','utf8');
  assert.match(source,/fetchText:\s*async url\s*=>/);
  assert.match(source,/requestTransport\(\{[\s\S]*?method:\s*'GET'[\s\S]*?url,[\s\S]*?Accept:\s*'text\/plain'/);
  assert.match(source,/response\.responseText/);
  assert.doesNotMatch(source,/fetchManifest:\s*\(\)\s*=>\s*state\.api\.getClientVersionManifest\(\)/);
});

test('userscript schedules a persisted 12-hour update check while Torn stays open', () => {
  const source=fs.readFileSync('torn-revive-chat-collector.user.js','utf8');
  assert.match(source,/let updateTimer = null;/);
  assert.match(source,/updateTimer = setInterval\(\(\) => \{[\s\S]*?checkUpdates\(false\)[\s\S]*?\}, UpdateManager\.UPDATE_CHECK_MS\);/);
  assert.match(source,/checkUpdates\(false\)\.catch\(error => captureClientError\(error, 'update\.initial'\)\)/);
});

test('detected updates expose an explicit install button and background notice', () => {
  const source=fs.readFileSync('torn-revive-chat-collector.user.js','utf8');
  assert.match(source,/id="rr-update-open"/);
  assert.match(source,/target\.id === 'rr-update-open'\) return openAvailableUpdate\(\)/);
  assert.match(source,/ReviveRelay .*update available\. Open Settings/);
});
