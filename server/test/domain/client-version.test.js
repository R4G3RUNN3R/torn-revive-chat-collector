const test=require('node:test');const assert=require('node:assert/strict');const {validateReleaseManifest}=require('../../src/domain/client-version');
function manifest(channel='review'){return {latestVersion:'0.6.0',minimumVersion:'0.6.0',buildTimestamp:'2026-09-07T12:00:00.000Z',releaseNotes:'Review.',gitCommit:'0'.repeat(40),releaseChannel:channel,sha256:'a'.repeat(64),apiCompatibility:{minimum:1,current:1},install:{installUrl:`https://reviverelay.voidsmithindustries.com/releases/${channel}/0.6.0/ReviveRelay-0.6.0.user.js`,metaUrl:`https://reviverelay.voidsmithindustries.com/releases/${channel}/0.6.0/ReviveRelay-0.6.0.meta.js`},mandatory:false};}

test('validates exact review/stable channel manifest schema',()=>{for(const channel of ['review','stable']) assert.equal(validateReleaseManifest(manifest(channel)).releaseChannel,channel);});
test('rejects channel-crossing install metadata',()=>{const value=manifest('review'); value.install.installUrl=value.install.installUrl.replace('/review/','/stable/'); assert.throws(()=>validateReleaseManifest(value),/channel|URL/i);});
test('rejects unknown fields and malformed API compatibility',()=>{assert.throws(()=>validateReleaseManifest({...manifest(),extra:true}),/fields/i); assert.throws(()=>validateReleaseManifest({...manifest(),apiCompatibility:{minimum:2,current:1}}),/compatibility/i);});

test('rejects version components above 9 and leading-zero components',()=>{
  for(const invalid of ['0.6.10','10.0.0','0.10.0','0.0.10','0.06.0']){
    const value=manifest();
    value.latestVersion=invalid;
    value.minimumVersion=invalid;
    value.install.installUrl=`https://reviverelay.voidsmithindustries.com/releases/review/${invalid}/ReviveRelay-${invalid}.user.js`;
    value.install.metaUrl=`https://reviverelay.voidsmithindustries.com/releases/review/${invalid}/ReviveRelay-${invalid}.meta.js`;
    assert.throws(()=>validateReleaseManifest(value),/version/i,invalid);
  }
});
