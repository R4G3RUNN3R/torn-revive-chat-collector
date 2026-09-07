const test=require('node:test');
const assert=require('node:assert/strict');
const {buildReleaseManifest}=require('../scripts/release-client');

function build(channel='review'){
 return buildReleaseManifest({version:'0.6.0',minimumVersion:'0.6.0',mandatory:false,releaseNotes:'Review candidate.',buildTimestamp:'2026-09-07T12:00:00.000Z',gitCommit:'0'.repeat(40),releaseChannel:channel,sha256:'a'.repeat(64),apiCompatibility:{minimum:1,current:1}});
}
test('release manifest has exact immutable channel-specific schema',()=>{
 const manifest=build('review');
 assert.deepEqual(Object.keys(manifest).sort(),['apiCompatibility','buildTimestamp','gitCommit','install','latestVersion','mandatory','minimumVersion','releaseChannel','releaseNotes','sha256'].sort());
 assert.equal(manifest.releaseChannel,'review');
 assert.equal(manifest.sha256,'a'.repeat(64));
 assert.match(manifest.install.installUrl,/\/releases\/review\/0\.6\.0\/ReviveRelay-0\.6\.0\.user\.js$/);
 assert.match(manifest.install.metaUrl,/\/releases\/review\/0\.6\.0\/ReviveRelay-0\.6\.0\.meta\.js$/);
});
test('review manifest cannot cross into stable URLs and stable cannot cross into review',()=>{
 const review=build('review'); const stable=build('stable');
 assert.doesNotMatch(review.install.installUrl,/\/stable\//);
 assert.doesNotMatch(review.install.metaUrl,/\/stable\//);
 assert.doesNotMatch(stable.install.installUrl,/\/review\//);
 assert.doesNotMatch(stable.install.metaUrl,/\/review\//);
});
