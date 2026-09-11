const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pkg=require('../package.json');

test('build produces exact immutable review 0.6.6 artifact with review metadata',()=>{
  const file=`dist/review/ReviveRelay-${pkg.version}.user.js`;
  assert.ok(fs.existsSync(file),file);
  const text=fs.readFileSync(file,'utf8');
  assert.equal(text.match(/@version\s+(\S+)/)?.[1],'0.6.6');
  assert.match(text,/ReviveRelay-Build-Commit:\s*[0-9a-f]{40}/);
  assert.match(text,/ReviveRelay-Build-Timestamp:\s*\d{4}-\d{2}-\d{2}T/);
  assert.match(text,/const UPDATE_CHANNEL = 'review'/);
  assert.match(text,/const BUILD_TIMESTAMP = '\d{4}-\d{2}-\d{2}T/);
  assert.match(text,/@updateURL\s+https:\/\/reviverelay\.voidsmithindustries\.com\/releases\/review\/0\.6\.6\/ReviveRelay-0\.6\.6\.meta\.js/);
  assert.match(text,/@downloadURL\s+https:\/\/reviverelay\.voidsmithindustries\.com\/releases\/review\/0\.6\.6\/ReviveRelay-0\.6\.6\.user\.js/);
  assert.doesNotMatch(text,/const UPDATE_CHANNEL = '(?:automatic|manual)'/);
  assert.doesNotMatch(text,/@version\s+0\.5\.0/);
});

test('normal build generates review only while builder exposes stable capability',()=>{
  assert.ok(fs.existsSync(`dist/review/ReviveRelay-${pkg.version}.user.js`));
  assert.equal(fs.existsSync(`dist/stable/ReviveRelay-${pkg.version}.user.js`),false);
  const build=require('../scripts/build');
  assert.equal(typeof build.buildChannelArtifact,'function');
  assert.deepEqual(build.RELEASE_CHANNELS,['review','stable']);
});

test('current-version pinned manifest makes normal builds reproducible',()=>{
  const build=require('../scripts/build');
  assert.equal(typeof build.resolveBuildIdentity,'function');
  const head='a'.repeat(40);
  const pinned='b'.repeat(40);
  const fresh='2026-09-11T18:00:00.000Z';
  const frozen='2026-09-11T17:00:00.000Z';
  assert.deepEqual(build.resolveBuildIdentity({
    version:'0.6.6',
    headCommit:head,
    nowTimestamp:fresh,
    manifest:{version:'0.6.6',artifactSourceCommit:pinned,buildTimestamp:frozen}
  }),{gitCommit:pinned,buildTimestamp:frozen,pinned:true});
  assert.deepEqual(build.resolveBuildIdentity({
    version:'0.6.6',
    headCommit:head,
    nowTimestamp:fresh,
    manifest:{version:'0.6.5',artifactSourceCommit:pinned,buildTimestamp:frozen}
  }),{gitCommit:head,buildTimestamp:fresh,pinned:false});
  assert.throws(()=>build.resolveBuildIdentity({
    version:'0.6.6',headCommit:head,nowTimestamp:fresh,
    manifest:{version:'0.6.6',artifactSourceCommit:'bad',buildTimestamp:frozen}
  }),/pinned build manifest/i);
});
