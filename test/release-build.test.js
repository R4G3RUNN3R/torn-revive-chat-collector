const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pkg=require('../package.json');

test('build produces exact immutable review 0.6.5 artifact with review metadata',()=>{
  const file=`dist/review/ReviveRelay-${pkg.version}.user.js`;
  assert.ok(fs.existsSync(file),file);
  const text=fs.readFileSync(file,'utf8');
  assert.equal(text.match(/@version\s+(\S+)/)?.[1],'0.6.5');
  assert.match(text,/ReviveRelay-Build-Commit:\s*[0-9a-f]{40}/);
  assert.match(text,/ReviveRelay-Build-Timestamp:\s*\d{4}-\d{2}-\d{2}T/);
  assert.match(text,/const UPDATE_CHANNEL = 'review'/);
  assert.match(text,/const BUILD_TIMESTAMP = '\d{4}-\d{2}-\d{2}T/);
  assert.match(text,/@updateURL\s+https:\/\/reviverelay\.voidsmithindustries\.com\/releases\/review\/0\.6\.5\/ReviveRelay-0\.6\.5\.meta\.js/);
  assert.match(text,/@downloadURL\s+https:\/\/reviverelay\.voidsmithindustries\.com\/releases\/review\/0\.6\.5\/ReviveRelay-0\.6\.5\.user\.js/);
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
