const test=require('node:test'); const assert=require('node:assert/strict');
const {buildReleaseManifest}=require('../scripts/release-client');
test('release manifest includes immutable release provenance and channel hashes',()=>{
 const manifest=buildReleaseManifest({version:'0.4.0',minimumVersion:'0.3.0',mandatory:false,releaseNotes:'Payment verification improvements.',releasedAt:'2026-08-26T12:00:00.000Z',gitCommit:'0'.repeat(40),autoSha256:'a'.repeat(64),manualSha256:'b'.repeat(64)});
 assert.equal(manifest.latestVersion,'0.4.0'); assert.equal(manifest.minimumVersion,'0.3.0');
 assert.equal(manifest.automatic.sha256,'a'.repeat(64)); assert.equal(manifest.manual.sha256,'b'.repeat(64));
 assert.equal(manifest.mandatory,false);
});
