const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs');
test('userscript exposes update status UX and bundles updater dependencies safely',()=>{
  const source=fs.readFileSync('torn-revive-chat-collector.user.js','utf8');
  const artifact=fs.readFileSync('dist/reviverelay-auto.user.js','utf8');
  for(const path of ['src/versioning.js','src/update-manager.js']) assert.match(artifact,new RegExp(`ReviveRelay bundled module: ${path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));
  for(const token of ['rr-update-current','rr-update-channel','rr-update-latest','rr-update-checked','rr-update-check','rr-update-switch','rr-update-banner','ReviveRelayUpdateManager','clientVersion: VERSION','releaseChannel: UPDATE_CHANNEL']) assert.match(source,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(source,/eval\s*\(|new Function\s*\(/);
});
