const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pkg=require('../package.json');

test('build produces ReviveRelay 0.6.8 review artifact with permanent review distribution update URLs',()=>{
  assert.equal(pkg.version,'0.6.8');
  const file='dist/review/ReviveRelay-0.6.8.user.js';
  assert.ok(fs.existsSync(file),file);
  const text=fs.readFileSync(file,'utf8');
  assert.equal(text.match(/@version\s+(\S+)/)?.[1],'0.6.8');
  assert.match(text,/ReviveRelay-Build-Commit:\s*[0-9a-f]{40}/);
  assert.match(text,/ReviveRelay-Build-Timestamp:\s*\d{4}-\d{2}-\d{2}T/);
  assert.match(text,/const UPDATE_CHANNEL = 'review'/);
  assert.match(text,/@updateURL\s+https:\/\/reviverelay\.voidsmithindustries\.com\/dist\/review\/ReviveRelay\.meta\.js/);
  assert.match(text,/@downloadURL\s+https:\/\/reviverelay\.voidsmithindustries\.com\/dist\/review\/ReviveRelay\.user\.js/);
  assert.doesNotMatch(text,/@updateURL\s+https:\/\/reviverelay\.voidsmithindustries\.com\/releases\/review\/0\.6\.7\//);
});

test('build stages distribution feed as byte-for-byte copies of the review candidate',()=>{
  const versionedUser=fs.readFileSync(`dist/review/ReviveRelay-${pkg.version}.user.js`);
  const versionedMeta=fs.readFileSync(`dist/review/ReviveRelay-${pkg.version}.meta.js`);
  const distUser=fs.readFileSync('dist/distribution/review/ReviveRelay.user.js');
  const distMeta=fs.readFileSync('dist/distribution/review/ReviveRelay.meta.js');
  assert.deepEqual(distUser,versionedUser);
  assert.deepEqual(distMeta,versionedMeta);
});

test('normal build generates review only while builder exposes isolated review/stable distribution URLs',()=>{
  assert.ok(fs.existsSync(`dist/review/ReviveRelay-${pkg.version}.user.js`));
  assert.equal(fs.existsSync(`dist/stable/ReviveRelay-${pkg.version}.user.js`),false);
  const build=require('../scripts/build');
  assert.equal(typeof build.buildChannelArtifact,'function');
  assert.deepEqual(build.RELEASE_CHANNELS,['review','stable']);
  assert.deepEqual(build.distributionUrls('review'),{
    updateUrl:'https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.meta.js',
    downloadUrl:'https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.user.js'
  });
  assert.deepEqual(build.distributionUrls('stable'),{
    updateUrl:'https://reviverelay.voidsmithindustries.com/dist/stable/ReviveRelay.meta.js',
    downloadUrl:'https://reviverelay.voidsmithindustries.com/dist/stable/ReviveRelay.user.js'
  });
});

test('current-version pinned manifest makes normal builds reproducible',()=>{
  const build=require('../scripts/build');
  assert.equal(typeof build.resolveBuildIdentity,'function');
  const head='a'.repeat(40);
  const pinned='b'.repeat(40);
  const fresh='2026-09-11T18:00:00.000Z';
  const frozen='2026-09-11T17:00:00.000Z';
  assert.deepEqual(build.resolveBuildIdentity({
    version:'0.6.8',
    headCommit:head,
    nowTimestamp:fresh,
    manifest:{version:'0.6.8',artifactSourceCommit:pinned,buildTimestamp:frozen}
  }),{gitCommit:pinned,buildTimestamp:frozen,pinned:true});
  assert.deepEqual(build.resolveBuildIdentity({
    version:'0.6.8',
    headCommit:head,
    nowTimestamp:fresh,
    manifest:{version:'0.6.6',artifactSourceCommit:pinned,buildTimestamp:frozen}
  }),{gitCommit:head,buildTimestamp:fresh,pinned:false});
  assert.throws(()=>build.resolveBuildIdentity({
    version:'0.6.8',headCommit:head,nowTimestamp:fresh,
    manifest:{version:'0.6.8',artifactSourceCommit:'bad',buildTimestamp:frozen}
  }),/pinned build manifest/i);
});
